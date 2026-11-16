import "server-only";
import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { currentUser } from "./auth";
import { db } from "./database";
import { lockAccounting } from "./periods";
import { checkedAllocations, reviewDigest } from "./allocation-data";
import { cutoffCalculation, saveAllocationFreeze } from "./departure-state";
import { calculateLedger, signedMinor } from "./settlement-engine";
import { readMonth } from "./settlements";
import { amountToMinor } from "./allocation-engine";
import { ExpenseError, positiveId } from "../lib/expense-input";
import { parseShamsiDate, periodKey } from "../lib/shamsi";

async function admin() {
  const user = await currentUser();
  if (!user) throw new ExpenseError("Authentication required.", 401);
  if (user.role !== "admin") throw new ExpenseError("Admin access required.", 403);
  return user;
}
function leavingDate(value: string) {
  const date = parseShamsiDate(value);
  if (!date) throw new ExpenseError("Choose a real Hijri Shamsi leaving date.");
  return periodKey(date);
}
async function reviewInTransaction(connection: PoolConnection, userId: number, leavesOn: string) {
  const key = leavingDate(leavesOn);
  const [users] = await connection.execute<RowDataPacket[]>("SELECT id, username, role, deactivated_at FROM rems_users WHERE id = ?", [userId]);
  if (!users.length) throw new ExpenseError("Roommate not found.", 404);
  if (users[0].role === "admin") throw new ExpenseError("The sole admin cannot be deactivated through this workflow.", 409);
  const [records] = await connection.execute<RowDataPacket[]>("SELECT * FROM rems_departures WHERE user_id = ?", [userId]);
  const current = await readMonth(connection, key);
  const member = current.data.members.find((m) => m.userId === userId);
  if (!member || leavesOn < member.startsOn) throw new ExpenseError("The leaving date is outside confirmed participation.", 409);
  if (records.length) {
    if (records[0].leaves_on !== leavesOn) throw new ExpenseError("The finalized leaving date cannot be changed.", 409);
    const cutoff = cutoffCalculation(current.data, leavesOn);
    const ledger = calculateLedger(cutoff.allocations.participants, current.history, current.bases);
    return { key, username: users[0].username as string, finalized: true, deactivated: users[0].deactivated_at !== null,
      person: ledger.participants.find((p) => p.userId === userId)!, ledger, current, cutoff, review: records[0].source_digest as string, laterExpenseCount: 0 };
  }
  if (users[0].deactivated_at !== null || member.leavesOn !== null) throw new ExpenseError("Existing account or membership departure state requires recovery review.", 409);
  if (current.data.periodStatus !== "open") throw new ExpenseError("Choose an open accounting month; settling or closed history cannot be changed.", 409);
  if (current.data.freezes.some((f) => f.kind === "month_end")) throw new ExpenseError("Month-end finalized history conflicts with introducing a departure. Recovery review is required.", 409);
  if (current.data.freezes.some((f) => f.throughDate > leavesOn)) throw new ExpenseError("This date precedes finalized allocations. Choose a date on or after the latest finalized cutoff.", 409);
  const [laterOwn] = await connection.execute<RowDataPacket[]>("SELECT id FROM rems_expenses WHERE user_id = ? AND expense_date > ? AND deleted_at IS NULL LIMIT 1", [userId, leavesOn]);
  if (laterOwn.length) throw new ExpenseError("This roommate has expenses after the leaving date. Resolve those entries through permitted expense edits/deletions or choose the correct later date; no records will be discarded.", 409);
  const [futureRoster] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_period_participants WHERE user_id = ? AND period_key > ? LIMIT 1", [userId, key]);
  if (futureRoster.length) throw new ExpenseError("A later confirmed roster includes this roommate. That conflicting historical state requires recovery review.", 409);
  const proposed = { ...current.data, members: current.data.members.map((m) => m.userId === userId ? { ...m, leavesOn } : m) };
  const complete = checkedAllocations(proposed);
  const cutoff = cutoffCalculation(proposed, leavesOn);
  const ledger = calculateLedger(cutoff.allocations.participants, current.history, current.bases);
  const review = createHash("sha256").update(JSON.stringify({ userId, leavesOn, complete: reviewDigest(proposed, complete), cutoff: cutoff.digest, history: current.history })).digest("hex");
  return { key, username: users[0].username as string, finalized: false, deactivated: false,
    person: ledger.participants.find((p) => p.userId === userId)!, ledger, current, cutoff, review,
    laterExpenseCount: proposed.expenses.filter((e) => e.deletedAt === null && e.expenseDate > leavesOn).length };
}

export async function departureView(params: URLSearchParams) {
  await admin();
  const connection = await db().getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT u.id, u.username, u.role, u.deactivated_at, m.leaves_on FROM rems_users u
       JOIN rems_memberships m ON m.user_id = u.id ORDER BY u.id`,
    );
    const candidates = rows.map((r) => ({ id: r.id as number, username: r.username as string, role: r.role as string, leavesOn: r.leaves_on as string | null, active: r.deactivated_at === null }));
    if (!params.get("userId")) { await connection.commit(); return { candidates }; }
    const userId = positiveId(params.get("userId")!, "roommate");
    const leavesOn = params.get("leavesOn") ?? candidates.find((c) => c.id === userId)?.leavesOn ?? "";
    const result = await reviewInTransaction(connection, userId, leavesOn);
    const reviewedExpenses = result.cutoff.data.expenses.filter((e) => e.deletedAt === null).map((e) => ({ id: e.id, date: e.expenseDate, amount: e.amount, payerId: e.userId }));
    const [priorPeriods] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_accounting_periods WHERE period_key < ? ORDER BY period_key", [result.key]);
    const priorObligations: { period: number; verified: boolean; outstanding?: string; message?: string }[] = [];
    for (const period of priorPeriods) {
      try {
        const prior = await readMonth(connection, period.period_key);
        const person = prior.fullLedger.participants.find((p) => p.userId === userId);
        priorObligations.push({ period: period.period_key, verified: prior.data.periodStatus !== "open", outstanding: person?.outstanding ?? "0.00", message: prior.data.periodStatus === "open" ? "Earlier expenses still require finalization." : undefined });
      } catch (error) { if (!(error instanceof ExpenseError)) throw error; priorObligations.push({ period: period.period_key, verified: false, message: error.message }); }
    }
    await connection.commit();
    return { candidates, userId, username: result.username, leavesOn, period: result.key,
      finalized: result.finalized, deactivated: result.deactivated, person: result.person,
      participants: result.ledger.participants, fundCash: result.ledger.cash, reviewDigest: result.review,
      expenseCount: reviewedExpenses.length, expenses: reviewedExpenses, allocations: result.cutoff.allocations.allocations,
      priorObligations, laterExpenseCount: result.laterExpenseCount };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function mutateDeparture(form: URLSearchParams) {
  const actor = await admin(), userId = positiveId(form.get("userId") ?? "", "roommate");
  const action = form.get("action"), requestKey = form.get("requestKey") ?? "";
  if (action !== "finalize" && action !== "deactivate") throw new ExpenseError("Invalid departure action.");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestKey)) throw new ExpenseError("A valid submission key is required.");
  const leavesOn = action === "finalize" ? form.get("leavesOn") ?? "" : undefined;
  if (leavesOn !== undefined) leavingDate(leavesOn);
  if (action === "finalize" && form.get("expensesComplete") !== "confirm") throw new ExpenseError("Explicitly confirm that all expenses through the inclusive leaving date are complete.");
  if (action === "deactivate" && form.get("acknowledge") !== "deactivate") throw new ExpenseError("Explicit deactivation confirmation is required.");
  const payloadHash = createHash("sha256").update(JSON.stringify({ operation: "departure", action, userId, leavesOn, review: action === "finalize" ? form.get("reviewDigest") : undefined })).digest("hex");
  const connection = await db().getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'"); await connection.beginTransaction(); await lockAccounting(connection);
    const [accounts] = await connection.execute<RowDataPacket[]>("SELECT role, deactivated_at FROM rems_users WHERE id = ? FOR UPDATE", [userId]);
    if (!accounts.length) throw new ExpenseError("Roommate not found.", 404);
    if (accounts[0].role === "admin") throw new ExpenseError("The sole admin cannot be deactivated.", 409);
    const [retry] = await connection.execute<RowDataPacket[]>("SELECT payload_hash, result FROM rems_settlement_requests WHERE actor_id = ? AND request_key = ?", [actor.id, requestKey]);
    if (retry.length) {
      if (retry[0].payload_hash !== payloadHash) throw new ExpenseError("This retry key belongs to another operation.", 409);
      await connection.commit(); return { ...retry[0].result, replayed: true };
    }
    const [existing] = await connection.execute<RowDataPacket[]>("SELECT * FROM rems_departures WHERE user_id = ? FOR UPDATE", [userId]);
    let key: number, result: { finalized: boolean; deactivated: boolean; userId: number };
    if (action === "finalize") {
      const review = await reviewInTransaction(connection, userId, leavesOn!); key = review.key;
      if (!review.finalized) {
        if (review.review !== form.get("reviewDigest")) throw new ExpenseError("Expenses, participation, or payments changed after review. Review the departure again.", 409);
        const freezeId = await saveAllocationFreeze(connection, review.cutoff.data, review.cutoff.allocations, leavesOn!, "departure", actor.id);
        const [saved] = await connection.execute<RowDataPacket[]>("SELECT user_id FROM rems_cutoff_balances WHERE freeze_id = ?", [freezeId]);
        if (!saved.length) for (const p of review.cutoff.allocations.participants) await connection.execute(
          "INSERT INTO rems_cutoff_balances (freeze_id, user_id, username_at_review, spending_minor, share_minor, initial_minor) VALUES (?, ?, ?, ?, ?, ?)",
          [freezeId, p.userId, p.username, String(amountToMinor(p.spending)), String(amountToMinor(p.allocatedShare)), String(signedMinor(p.initialBalance))],
        );
        await connection.execute("UPDATE rems_memberships SET leaves_on = ? WHERE user_id = ?", [leavesOn!, userId]);
        await connection.execute("INSERT INTO rems_departures (user_id, period_key, leaves_on, freeze_id, source_digest, finalized_by) VALUES (?, ?, ?, ?, ?, ?)", [userId, key, leavesOn!, freezeId, review.cutoff.digest, actor.id]);
        await readMonth(connection, key, true);
      }
      result = { userId, finalized: true, deactivated: review.deactivated };
    } else {
      if (!existing.length) throw new ExpenseError("Finalize the departure calculation before deactivation.", 409);
      key = existing[0].period_key;
      const month = await readMonth(connection, key, true);
      if (month.fullLedger.participants.find((p) => p.userId === userId)?.outstanding !== "0.00") throw new ExpenseError("This roommate still owes money or is owed money. Record actual payments until the outstanding balance is exactly zero.", 409);
      const [earlier] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_accounting_periods WHERE period_key < ? ORDER BY period_key FOR UPDATE", [key]);
      for (const period of earlier) {
        let prior;
        try { prior = await readMonth(connection, period.period_key, true); }
        catch (error) { if (error instanceof ExpenseError) throw new ExpenseError(`Earlier tracked month ${period.period_key} cannot be verified: ${error.message}`, 409); throw error; }
        if (prior.data.periodStatus === "open" || (prior.fullLedger.participants.some((p) => p.userId === userId) && prior.fullLedger.participants.find((p) => p.userId === userId)!.outstanding !== "0.00")) throw new ExpenseError("An earlier tracked month has unfinished allocations or an unresolved balance for this roommate. Resolve it before deactivation.", 409);
      }
      if (accounts[0].deactivated_at === null) {
        await connection.execute("UPDATE rems_users SET deactivated_at = CURRENT_TIMESTAMP(3), deactivated_by = ? WHERE id = ?", [actor.id, userId]);
        await connection.execute("UPDATE rems_departures SET deactivated_at = CURRENT_TIMESTAMP(3), deactivated_by = ? WHERE user_id = ?", [actor.id, userId]);
        await connection.execute("DELETE FROM rems_sessions WHERE user_id = ?", [userId]);
      }
      result = { userId, finalized: true, deactivated: true };
    }
    await connection.execute("INSERT INTO rems_settlement_requests (actor_id, request_key, period_key, payload_hash, result) VALUES (?, ?, ?, ?, ?)", [actor.id, requestKey, key, payloadHash, JSON.stringify(result)]);
    await connection.commit(); return { ...result, replayed: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
