import "server-only";
import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { currentUser } from "./auth";
import { db } from "./database";
import { guardPeriod, lockAccounting, followingPeriod } from "./periods";
import { loadAllocationData, checkedAllocations, reviewDigest } from "./allocation-data";
import { ALLOCATION_VERSION, amountToMinor } from "./allocation-engine";
import { calculateLedger, signedMinor } from "./settlement-engine";
import { ExpenseError, monthFilter, parseAmount, positiveId } from "../lib/expense-input";
import { dateString, monthDays, parseShamsiDate, todayShamsi } from "../lib/shamsi";
import type { LedgerEntry, SettlementView } from "../lib/settlement-types";
import { departureBases } from "./departure-state";

const ZERO = BigInt(0);
async function actor(admin = false) {
  const user = await currentUser();
  if (!user) throw new ExpenseError("Authentication required.", 401);
  if (admin && user.role !== "admin") throw new ExpenseError("Admin access required.", 403);
  return user;
}

export async function readMonth(connection: PoolConnection, key: number, lock = false) {
  const data = await loadAllocationData(connection, key);
  const allocations = checkedAllocations(data);
  const digest = reviewDigest(data, allocations);
  const departure = await departureBases(connection, data);
  const bases = departure.bases;
  const [headers] = await connection.execute<RowDataPacket[]>(`SELECT * FROM rems_month_settlements WHERE period_key = ?${lock ? " FOR UPDATE" : ""}`, [key]);
  if (data.periodStatus === "open" && headers.length) throw new ExpenseError("An open month has conflicting settlement metadata.", 409);
  if (data.periodStatus !== "open") {
    const header = headers[0];
    if (!header || header.review_digest !== digest || !data.freezes.some((f) => f.id === header.freeze_id && f.kind === "month_end")) throw new ExpenseError("Frozen settlement sources no longer match the reviewed allocations.", 409);
    if ((data.periodStatus === "closed") !== (header.closed_at !== null && header.closed_by !== null)) throw new ExpenseError("The closure audit and period state disagree.", 409);
    const [snapshots] = await connection.execute<RowDataPacket[]>(
      `SELECT user_id, username_at_review, CAST(spending_minor AS CHAR) AS spending, CAST(share_minor AS CHAR) AS share,
       CAST(initial_minor AS CHAR) AS initial_balance FROM rems_settlement_participants WHERE period_key = ? ORDER BY user_id${lock ? " FOR UPDATE" : ""}`, [key],
    );
    if (snapshots.length !== allocations.participants.length || snapshots.some((s) => {
      const p = allocations.participants.find((person) => person.userId === s.user_id);
      return !p || s.username_at_review !== p.username || BigInt(s.spending) !== amountToMinor(p.spending) || BigInt(s.share) !== amountToMinor(p.allocatedShare) || BigInt(s.initial_balance) !== signedMinor(p.initialBalance);
    })) throw new ExpenseError("Frozen initial balances are inconsistent with reviewed expenses and participation.", 409);
    bases.set(header.freeze_id, allocations.participants);
  }
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT l.*, COALESCE(p.username_at_review, u.username) AS username_at_review FROM rems_settlement_ledger l
     JOIN rems_users u ON u.id = l.user_id LEFT JOIN rems_settlement_participants p
     ON p.period_key = l.period_key AND p.user_id = l.user_id WHERE l.period_key = ? ORDER BY l.id${lock ? " FOR UPDATE" : ""}`, [key],
  );
  const history: LedgerEntry[] = rows.map((e) => ({ id: e.id, userId: e.user_id, username: e.username_at_review, direction: e.direction, kind: e.entry_kind, amount: e.amount, paymentDate: e.payment_date, note: e.note, reversalOf: e.reversal_of, recordedBy: e.recorded_by, recordedAt: e.recorded_at, basisFreezeId: e.basis_freeze_id }));
  if (data.periodStatus === "open" && history.length && !departure.latest) throw new ExpenseError("An open month unexpectedly contains unreviewed payments.", 409);
  const fundAllocations = data.periodStatus === "open" && departure.latest ? departure.latest.allocations : allocations;
  const ledger = calculateLedger(fundAllocations.participants, history, bases);
  const fullLedger = calculateLedger(allocations.participants, history, bases);
  for (const d of departure.departures) {
    if (d.deactivated_at !== null && fullLedger.participants.find((p) => p.userId === d.user_id)?.outstanding !== "0.00") throw new ExpenseError("A deactivated roommate's finalized balance would be reopened.", 409);
  }
  if (data.periodStatus === "closed" && (ledger.cash !== "0.00" || ledger.participants.some((p) => p.outstanding !== "0.00"))) throw new ExpenseError("Closed month balances are not zero.", 409);
  return { data, allocations, digest, header: headers[0], history, ledger, fullLedger, bases, departure, fundAllocations,
    basisFreezeId: headers[0]?.freeze_id ?? departure.latest?.freezeId,
    reviewThrough: data.periodStatus === "open" ? departure.latest?.through : undefined };
}

export async function settlementView(params: URLSearchParams, room = false): Promise<SettlementView> {
  const user = await actor(room);
  const { year, month, key } = monthFilter(params);
  const connection = await db().getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.beginTransaction();
    const [rosters] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_participation_rosters WHERE period_key = ?", [key]);
    if (!rosters.length) { await connection.commit(); return { year, month, period: key, status: "unconfirmed", message: "Roommates must be confirmed" }; }
    const value = await readMonth(connection, key);
    await connection.commit();
    const common = { year, month, period: key, status: value.data.periodStatus as "open" | "settling" | "closed", reviewThrough: value.reviewThrough, departureFunding: Boolean(value.reviewThrough) };
    if (!room) return { ...common, personal: value.ledger.participants.find((p) => p.userId === user.id), history: value.history.filter((e) => e.userId === user.id), message: value.ledger.participants.some((p) => p.userId === user.id) ? undefined : "You are not a participant in this month." };
    return { ...common, reviewDigest: value.digest, participants: value.ledger.participants, history: value.history,
      monthEndReview: value.reviewThrough ? { participants: value.fullLedger.participants, totals: value.allocations.totals } : undefined,
      totals: { ...value.fundAllocations.totals, collections: value.ledger.collections, payouts: value.ledger.payouts, cash: value.ledger.cash, remainingToCollect: value.ledger.remainingToCollect, remainingToPay: value.ledger.remainingToPay } };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function mutateSettlement(form: URLSearchParams) {
  const user = await actor(true);
  const { key } = monthFilter(form);
  const action = form.get("action");
  if (!["begin", "payment", "reverse", "close"].includes(action ?? "")) throw new ExpenseError("Invalid settlement action.");
  const requestKey = form.get("requestKey") ?? "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestKey)) throw new ExpenseError("A valid submission key is required.");
  let payment: { userId: number; amount: string; direction: "collection" | "payout"; date: string; note: string } | undefined;
  let reversalId: number | undefined, reason: string | undefined;
  if (action === "payment") {
    const amount = parseAmount(form.get("amount") ?? ""), date = form.get("paymentDate") ?? "", direction = form.get("direction");
    if (!amount || !parseShamsiDate(date) || date > dateString(todayShamsi()) || !["collection", "payout"].includes(direction ?? "")) throw new ExpenseError("Use a positive exact AFN amount, a real Shamsi payment date no later than today in Kabul, and a valid direction.");
    if (form.get("actualPayment") !== "confirm") throw new ExpenseError("Confirm only money actually received or paid.");
    const note = (form.get("note") ?? "").trim();
    if ([...note].length > 200) throw new ExpenseError("The note must be at most 200 characters.");
    payment = { userId: positiveId(form.get("userId") ?? "", "participant"), amount, direction: direction as "collection" | "payout", date, note };
  }
  if (action === "reverse") {
    reversalId = positiveId(form.get("entryId") ?? "", "ledger entry"); reason = (form.get("reason") ?? "").trim();
    if (!reason || [...reason].length > 200 || form.get("acknowledge") !== "correction") throw new ExpenseError("A reversal requires a reason of 1–200 characters and confirmation that this corrects an erroneous record, rather than recording another real payment.");
  }
  if ((action === "begin" || action === "close") && form.get("acknowledge") !== action) throw new ExpenseError("Explicit confirmation is required.");
  const payloadHash = createHash("sha256").update(JSON.stringify({ key, action, payment, reversalId, reason, review: action === "begin" ? form.get("reviewDigest") : undefined })).digest("hex");
  const connection = await db().getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.beginTransaction();
    const first = await lockAccounting(connection);
    const [periods] = await connection.execute<RowDataPacket[]>("SELECT status FROM rems_accounting_periods WHERE period_key = ? FOR UPDATE", [key]);
    if (!periods.length) throw new ExpenseError("The accounting month is not enabled.", 409);
    const [requests] = await connection.execute<RowDataPacket[]>("SELECT payload_hash, result FROM rems_settlement_requests WHERE actor_id = ? AND request_key = ?", [user.id, requestKey]);
    if (requests.length) {
      if (requests[0].payload_hash !== payloadHash) throw new ExpenseError("This retry key was already used for another operation.", 409);
      await connection.commit(); return { ...requests[0].result, replayed: true };
    }
    const value = await readMonth(connection, key, true);
    let result: { status: string; entryId?: number; nextPeriod?: number };
    if (action === "begin") {
      if (form.get("reviewDigest") !== value.digest) throw new ExpenseError("Expenses or participation changed after review. Review the new totals before beginning settlement.", 409);
      if (value.data.periodStatus === "open") {
        await guardPeriod(connection, first, key);
        if (value.data.freezes.some((f) => f.kind === "month_end")) throw new ExpenseError("A pre-existing month-end freeze requires recovery review before settlement can begin.", 409);
        const through = dateString({ year: Math.floor(key / 100), month: key % 100, day: monthDays(Math.floor(key / 100), key % 100) });
        const [freeze] = await connection.execute<ResultSetHeader>("INSERT INTO rems_allocation_freezes (period_key, through_date, kind, algorithm_version, finalized_by) VALUES (?, ?, 'month_end', ?, ?)", [key, through, ALLOCATION_VERSION, user.id]);
        for (const allocation of value.allocations.allocations) {
          if (value.data.frozen.some((f) => f.expenseId === allocation.expenseId)) continue;
          const expense = value.data.expenses.find((e) => e.id === allocation.expenseId)!;
          await connection.execute("INSERT INTO rems_finalized_expenses (expense_id, freeze_id, expense_version, source_hash) VALUES (?, ?, ?, ?)", [expense.id, freeze.insertId, expense.version, allocation.sourceHash]);
          for (const share of allocation.shares) await connection.execute("INSERT INTO rems_finalized_shares (expense_id, user_id, share_minor) VALUES (?, ?, ?)", [expense.id, share.userId, share.minor]);
        }
        await connection.execute("INSERT INTO rems_month_settlements (period_key, freeze_id, review_digest, begun_by) VALUES (?, ?, ?, ?)", [key, freeze.insertId, value.digest, user.id]);
        for (const p of value.allocations.participants) await connection.execute("INSERT INTO rems_settlement_participants (period_key, user_id, username_at_review, spending_minor, share_minor, initial_minor) VALUES (?, ?, ?, ?, ?, ?)", [key, p.userId, p.username, String(amountToMinor(p.spending)), String(amountToMinor(p.allocatedShare)), String(signedMinor(p.initialBalance))]);
        await connection.execute("UPDATE rems_accounting_periods SET status = 'settling' WHERE period_key = ?", [key]);
        await readMonth(connection, key, true);
      }
      result = { status: value.data.periodStatus === "closed" ? "closed" : "settling" };
    } else if (action === "close") {
      if (value.data.periodStatus === "open") throw new ExpenseError("Begin settlement before closing the month.", 409);
      if (value.ledger.cash !== "0.00" || value.ledger.participants.some((p) => p.outstanding !== "0.00")) throw new ExpenseError("Every participant and fund cash must be exactly zero before closure.", 409);
      const next = followingPeriod(key);
      if (value.data.periodStatus !== "closed") {
        const [earlier] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_accounting_periods WHERE period_key < ? AND status <> 'closed' FOR UPDATE", [key]);
        if (earlier.length) throw new ExpenseError("An earlier accounting month remains unclosed.", 409);
        const [future] = await connection.execute<RowDataPacket[]>("SELECT status FROM rems_accounting_periods WHERE period_key = ? FOR UPDATE", [next]);
        const [existing] = await connection.execute<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM rems_expenses WHERE period_key = ?) + (SELECT COUNT(*) FROM rems_participation_rosters WHERE period_key = ?) AS records", [next, next]);
        if (existing[0].records > 0 || (future.length && future[0].status !== "open")) throw new ExpenseError("The next month has conflicting historical state; closure requires recovery review.", 409);
        if (!future.length) await connection.execute("INSERT INTO rems_accounting_periods (period_key, status) VALUES (?, 'open')", [next]);
        await connection.execute("UPDATE rems_month_settlements SET closed_by = ?, closed_at = CURRENT_TIMESTAMP(3) WHERE period_key = ?", [user.id, key]);
        await connection.execute("UPDATE rems_accounting_periods SET status = 'closed' WHERE period_key = ?", [key]);
      }
      result = { status: "closed", nextPeriod: next };
    } else {
      if (value.data.periodStatus !== "settling" && !(value.data.periodStatus === "open" && value.departure.latest)) throw new ExpenseError("Payments require monthly settlement or a finalized departure cutoff.", 409);
      let entry: Omit<LedgerEntry, "id" | "recordedAt">;
      if (payment) {
        const person = value.ledger.participants.find((p) => p.userId === payment.userId);
        if (!person) throw new ExpenseError("Participant not found in the reviewed month.", 400);
        const outstanding = signedMinor(person.outstanding), amount = amountToMinor(payment.amount);
        if ((payment.direction === "collection" && (outstanding >= ZERO || amount > -outstanding)) || (payment.direction === "payout" && (outstanding <= ZERO || amount > outstanding))) throw new ExpenseError("The payment is in the wrong direction or exceeds the outstanding amount.", 409);
        if (payment.direction === "payout" && amount > amountToMinor(value.ledger.cash)) throw new ExpenseError("Insufficient confirmed fund cash for this payout.", 409);
        entry = { userId: person.userId, username: person.username, direction: payment.direction, kind: "payment", amount: payment.amount, paymentDate: payment.date, note: payment.note, reversalOf: null, recordedBy: user.id, basisFreezeId: value.basisFreezeId };
      } else {
        const original = value.history.find((e) => e.id === reversalId);
        if (!original || original.kind !== "payment") throw new ExpenseError("The original payment was not found in this month.", 404);
        const [protectedDeparture] = await connection.execute<RowDataPacket[]>("SELECT user_id FROM rems_departures WHERE user_id = ?", [original.userId]);
        if (protectedDeparture.length) throw new ExpenseError("Ordinary reversals cannot reopen a finalized departing roommate's balance. A separate recovery review is required.", 409);
        if (value.history.some((e) => e.reversalOf === original.id)) throw new ExpenseError("This payment is already reversed.", 409);
        entry = { ...original, kind: "reversal", note: reason!, reversalOf: original.id, recordedBy: user.id };
      }
      // Validate the proposed resulting ledger before inserting; original rows remain untouched.
      calculateLedger(value.fundAllocations.participants, [...value.history, { ...entry, id: (value.history.at(-1)?.id ?? 0) + 1, recordedAt: "pending" }], value.bases);
      const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO rems_settlement_ledger (period_key, user_id, direction, entry_kind, amount, payment_date, note, reversal_of, recorded_by, basis_freeze_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [key, entry.userId, entry.direction, entry.kind, entry.amount, entry.paymentDate, entry.note, entry.reversalOf, user.id, entry.basisFreezeId ?? null]);
      await readMonth(connection, key, true);
      result = { status: value.data.periodStatus!, entryId: insert.insertId };
    }
    await connection.execute("INSERT INTO rems_settlement_requests (actor_id, request_key, period_key, payload_hash, result) VALUES (?, ?, ?, ?, ?)", [user.id, requestKey, key, payloadHash, JSON.stringify(result)]);
    await connection.commit(); return { ...result, replayed: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
