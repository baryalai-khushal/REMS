import "server-only";
import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { currentUser } from "./auth";
import { db } from "./database";
import { lockAccounting } from "./periods";
import { ExpenseError, positiveId } from "../lib/expense-input";
import { INITIAL_PERIOD, INITIAL_START } from "./allocation-engine";
import { dateString, monthDays, parseShamsiDate, periodKey } from "../lib/shamsi";

async function admin() {
  const user = await currentUser();
  if (!user) throw new ExpenseError("Authentication required.", 401);
  if (user.role !== "admin") throw new ExpenseError("Admin access required.", 403);
  return user;
}
function checkPeriod(key: number) {
  const date = parseShamsiDate(`${String(Math.floor(key / 100)).padStart(4, "0")}-${String(key % 100).padStart(2, "0")}-01`);
  if (!date || key < INITIAL_PERIOD) throw new ExpenseError("Choose a supported Shamsi accounting month.");
}
async function rosterReview(connection: PoolConnection, key: number) {
  checkPeriod(key);
  const [users] = await connection.execute<RowDataPacket[]>("SELECT id, username FROM rems_users ORDER BY id");
  const [expenses] = await connection.execute<RowDataPacket[]>("SELECT id, user_id, amount, expense_date, version FROM rems_expenses WHERE deleted_at IS NULL AND period_key = ? ORDER BY id", [key]);
  const [memberships] = await connection.execute<RowDataPacket[]>("SELECT user_id, starts_on, leaves_on FROM rems_memberships ORDER BY user_id");
  const start = dateString({ year: Math.floor(key / 100), month: key % 100, day: 1 });
  const end = dateString({ year: Math.floor(key / 100), month: key % 100, day: monthDays(Math.floor(key / 100), key % 100) });
  const continuing = memberships.filter((m) => m.starts_on <= end && (m.leaves_on === null || m.leaves_on >= start)).map((m) => Number(m.user_id));
  const candidates = users.filter((u) => key === INITIAL_PERIOD || continuing.includes(u.id));
  const [confirmation] = await connection.execute<RowDataPacket[]>("SELECT confirmed_at FROM rems_participation_rosters WHERE period_key = ?", [key]);
  const [members] = await connection.execute<RowDataPacket[]>("SELECT user_id FROM rems_period_participants WHERE period_key = ? ORDER BY user_id", [key]);
  return {
    period: key, confirmed: confirmation.length > 0, confirmedAt: confirmation[0]?.confirmed_at as string | undefined,
    members: members.map((row) => Number(row.user_id)),
    candidates: candidates.map((u) => ({ id: Number(u.id), username: String(u.username), expenseCount: expenses.filter((e) => e.user_id === u.id).length })),
    revision: createHash("sha256").update(JSON.stringify({ key, users, expenses, memberships })).digest("hex"), expenses,
  };
}
export async function initialRosterReview(key = INITIAL_PERIOD) {
  await admin();
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const { expenses, ...review } = await rosterReview(connection, key);
    void expenses;
    await connection.commit(); return review;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
export async function confirmInitialRoster(form: URLSearchParams) {
  const actor = await admin();
  const key = Number(form.get("period")); checkPeriod(key);
  if (form.get("acknowledge") !== "confirm") throw new ExpenseError("Explicitly confirm the participating roommates for the selected month.");
  const ids = form.getAll("participantId").map((value) => positiveId(value, "participant")).sort((a, b) => a - b);
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new ExpenseError("Select between 1 and 100 distinct participating roommates.");
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    if (await lockAccounting(connection) !== INITIAL_PERIOD) throw new ExpenseError("Initialize Aqrab 1405 before confirming roommates.", 409);
    const review = await rosterReview(connection, key);
    if (review.confirmed) {
      if (review.members.join(",") !== ids.join(",")) throw new ExpenseError("Roommates are already confirmed. Membership changes are not supported.", 409);
      await connection.commit(); return { confirmed: true, replayed: true };
    }
    const [periods] = await connection.execute<RowDataPacket[]>("SELECT status FROM rems_accounting_periods WHERE period_key = ? FOR UPDATE", [key]);
    if (periods[0]?.status !== "open") throw new ExpenseError("Roommates can only be confirmed for an enabled open month.", 409);
    const [earlier] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_accounting_periods WHERE period_key < ? AND status <> 'closed' FOR UPDATE", [key]);
    if (earlier.length) throw new ExpenseError("The preceding months must be settled and closed first.", 409);
    if (review.revision !== form.get("revision")) throw new ExpenseError("Accounts, participation, or expenses changed since review. Reload and review again.", 409);
    if (ids.some((id) => !review.candidates.some((u) => u.id === id))) throw new ExpenseError("A selected account is not eligible for this roster.");
    if (key !== INITIAL_PERIOD && review.candidates.map((u) => u.id).join(",") !== ids.join(",")) throw new ExpenseError("Confirm the same eligible continuing participants. Use Departures for a leaving roommate; arrivals and absences remain unsupported.", 409);
    if (review.expenses.some((e) => !ids.includes(e.user_id) || e.expense_date < INITIAL_START)) throw new ExpenseError("Every existing non-deleted expense payer must be included in the historical roster.", 409);
    await connection.execute("INSERT INTO rems_participation_rosters (period_key, confirmed_by) VALUES (?, ?)", [key, actor.id]);
    for (const id of ids) {
      if (key === INITIAL_PERIOD) await connection.execute("INSERT INTO rems_memberships (user_id, roster_period, starts_on) VALUES (?, ?, ?)", [id, INITIAL_PERIOD, INITIAL_START]);
      await connection.execute("INSERT INTO rems_period_participants (period_key, user_id) VALUES (?, ?)", [key, id]);
    }
    await connection.commit(); return { confirmed: true, replayed: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
export async function guardExpenseParticipation(connection: PoolConnection, userId: number, expenseDate: string) {
  const [initial] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_participation_rosters WHERE period_key = ?", [INITIAL_PERIOD]);
  if (!initial.length) return; // Preserve initial expense entry while the admin prepares its roster.
  const key = periodKey(parseShamsiDate(expenseDate)!);
  const [members] = await connection.execute<RowDataPacket[]>(
    `SELECT m.user_id FROM rems_memberships m JOIN rems_period_participants p ON p.user_id = m.user_id
     WHERE p.period_key = ? AND m.user_id = ? AND m.starts_on <= ? AND (m.leaves_on IS NULL OR m.leaves_on >= ?) FOR SHARE`, [key, userId, expenseDate, expenseDate],
  );
  if (!members.length) throw new ExpenseError("Roommates must be confirmed for this month, and you must be a participant on this expense date.", 409);
}
