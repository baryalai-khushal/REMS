import "server-only";
import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { calculateAllocations, type AllocationExpense, type Freeze, type FrozenExpense, type Member } from "./allocation-engine";
import { ExpenseError } from "../lib/expense-input";
import { dateString, monthDays } from "../lib/shamsi";

export async function loadAllocationData(connection: PoolConnection, key: number) {
  const [rosters] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_participation_rosters WHERE period_key = ?", [key]);
  const [periods] = await connection.execute<RowDataPacket[]>("SELECT status FROM rems_accounting_periods WHERE period_key = ?", [key]);
  const [memberRows] = await connection.execute<RowDataPacket[]>(
    `SELECT m.user_id, u.username, m.starts_on, m.leaves_on FROM rems_period_participants p
     JOIN rems_memberships m ON m.user_id = p.user_id JOIN rems_users u ON u.id = m.user_id
     WHERE p.period_key = ? ORDER BY m.user_id`, [key],
  );
  const members: Member[] = memberRows.map((m) => ({ userId: m.user_id, username: m.username, startsOn: m.starts_on, leavesOn: m.leaves_on }));
  const [expenseRows] = await connection.execute<RowDataPacket[]>(
    "SELECT id, user_id, amount, expense_date, version, deleted_at FROM rems_expenses WHERE period_key = ? ORDER BY expense_date, id", [key],
  );
  const expenses: AllocationExpense[] = expenseRows.map((e) => ({ id: e.id, userId: e.user_id, amount: e.amount, expenseDate: e.expense_date, version: e.version, deletedAt: e.deleted_at }));
  const [freezeRows] = await connection.execute<RowDataPacket[]>("SELECT id, through_date, kind, algorithm_version FROM rems_allocation_freezes WHERE period_key = ? ORDER BY through_date, id", [key]);
  const freezes: Freeze[] = freezeRows.map((f) => ({ id: f.id, throughDate: f.through_date, kind: f.kind, algorithmVersion: f.algorithm_version }));
  const [frozenRows] = await connection.execute<RowDataPacket[]>(
    `SELECT f.expense_id, f.freeze_id, f.expense_version, f.source_hash FROM rems_finalized_expenses f
     JOIN rems_allocation_freezes b ON b.id = f.freeze_id JOIN rems_expenses e ON e.id = f.expense_id
     WHERE b.period_key = ? OR e.period_key = ? ORDER BY f.expense_id`, [key, key],
  );
  const [shareRows] = await connection.execute<RowDataPacket[]>(
    `SELECT s.expense_id, s.user_id, CAST(s.share_minor AS CHAR) AS share_minor FROM rems_finalized_shares s
     JOIN rems_finalized_expenses f ON f.expense_id = s.expense_id JOIN rems_allocation_freezes b ON b.id = f.freeze_id
     JOIN rems_expenses e ON e.id = f.expense_id WHERE b.period_key = ? OR e.period_key = ?`, [key, key],
  );
  const frozen: FrozenExpense[] = frozenRows.map((f) => ({
    expenseId: f.expense_id, freezeId: f.freeze_id, expenseVersion: f.expense_version, sourceHash: f.source_hash,
    shares: shareRows.filter((s) => s.expense_id === f.expense_id).map((s) => ({ userId: s.user_id, minor: s.share_minor })),
  }));
  return { period: key, confirmed: rosters.length === 1, periodStatus: periods[0]?.status as string | undefined, members, expenses, freezes, frozen };
}
export type AllocationData = Awaited<ReturnType<typeof loadAllocationData>>;
export function checkedAllocations(data: AllocationData) {
  if (!data.confirmed) throw new ExpenseError("Roommates must be confirmed", 409);
  if (!data.periodStatus) throw new ExpenseError("This accounting month has not been enabled by closure of the preceding month.", 409);
  return calculateAllocations(data);
}
export function reviewDigest(data: AllocationData, result: ReturnType<typeof calculateAllocations>) {
  // Excludes lifecycle fields, which change when the same reviewed sources are frozen.
  const year = Math.floor(data.period / 100), month = data.period % 100;
  const end = dateString({ year, month, day: monthDays(year, month) });
  const members = data.members.map((m) => ({ ...m, leavesOn: m.leavesOn && m.leavesOn > end ? null : m.leavesOn }));
  return createHash("sha256").update(JSON.stringify({ period: data.period, members, expenses: data.expenses, participants: result.participants, allocations: result.allocations, totals: result.totals })).digest("hex");
}
