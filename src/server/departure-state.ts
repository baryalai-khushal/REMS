import "server-only";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { checkedAllocations, reviewDigest, type AllocationData } from "./allocation-data";
import { ALLOCATION_VERSION, amountToMinor } from "./allocation-engine";
import { signedMinor } from "./settlement-engine";
import { ExpenseError } from "../lib/expense-input";
import type { BalanceRow } from "../lib/balance-types";

export function cutoffCalculation(data: AllocationData, through: string) {
  const expenses = data.expenses.filter((e) => e.expenseDate <= through);
  const ids = new Set(expenses.map((e) => e.id));
  const cutoff: AllocationData = {
    ...data, periodStatus: "open", expenses,
    // Leaving on or after the cutoff has identical eligibility through that date.
    members: data.members.map((m) => ({ ...m, leavesOn: m.leavesOn && m.leavesOn < through ? m.leavesOn : null })),
    freezes: data.freezes.filter((f) => f.throughDate <= through),
    frozen: data.frozen.filter((f) => ids.has(f.expenseId)),
  };
  const allocations = checkedAllocations(cutoff);
  return { data: cutoff, allocations, digest: reviewDigest(cutoff, allocations) };
}

export async function saveAllocationFreeze(connection: PoolConnection, data: AllocationData, allocations: ReturnType<typeof checkedAllocations>, through: string, kind: "departure" | "month_end", actorId: number) {
  const existing = data.freezes.find((f) => f.kind === kind && f.throughDate === through);
  let freezeId = existing?.id;
  if (freezeId === undefined) {
    const [insert] = await connection.execute<ResultSetHeader>("INSERT INTO rems_allocation_freezes (period_key, through_date, kind, algorithm_version, finalized_by) VALUES (?, ?, ?, ?, ?)", [data.period, through, kind, ALLOCATION_VERSION, actorId]);
    freezeId = insert.insertId;
  }
  for (const allocation of allocations.allocations) {
    if (data.frozen.some((f) => f.expenseId === allocation.expenseId)) continue;
    const expense = data.expenses.find((e) => e.id === allocation.expenseId)!;
    await connection.execute("INSERT INTO rems_finalized_expenses (expense_id, freeze_id, expense_version, source_hash) VALUES (?, ?, ?, ?)", [expense.id, freezeId, expense.version, allocation.sourceHash]);
    for (const share of allocation.shares) await connection.execute("INSERT INTO rems_finalized_shares (expense_id, user_id, share_minor) VALUES (?, ?, ?)", [expense.id, share.userId, share.minor]);
  }
  return freezeId;
}

export async function departureBases(connection: PoolConnection, data: AllocationData) {
  const [departures] = await connection.execute<RowDataPacket[]>("SELECT * FROM rems_departures WHERE period_key = ? ORDER BY leaves_on, user_id", [data.period]);
  const bases = new Map<number, BalanceRow[]>();
  let latest: { freezeId: number; through: string; allocations: ReturnType<typeof checkedAllocations> } | undefined;
  for (const departure of departures) {
    const member = data.members.find((m) => m.userId === departure.user_id);
    const freeze = data.freezes.find((f) => f.id === departure.freeze_id);
    if (!member || member.leavesOn !== departure.leaves_on || !freeze || freeze.kind !== "departure" || freeze.throughDate !== departure.leaves_on) throw new ExpenseError("Departure membership and finalized history disagree.", 409);
    const value = cutoffCalculation(data, departure.leaves_on);
    if (value.digest !== departure.source_digest) throw new ExpenseError("Finalized departure expenses or participation changed.", 409);
    const [snapshots] = await connection.execute<RowDataPacket[]>(
      "SELECT user_id, username_at_review, CAST(spending_minor AS CHAR) AS spending, CAST(share_minor AS CHAR) AS share, CAST(initial_minor AS CHAR) AS initial_balance FROM rems_cutoff_balances WHERE freeze_id = ? ORDER BY user_id", [freeze.id],
    );
    if (snapshots.length !== value.allocations.participants.length || snapshots.some((s) => {
      const p = value.allocations.participants.find((p) => p.userId === s.user_id);
      return !p || p.username !== s.username_at_review || BigInt(s.spending) !== amountToMinor(p.spending) || BigInt(s.share) !== amountToMinor(p.allocatedShare) || BigInt(s.initial_balance) !== signedMinor(p.initialBalance);
    })) throw new ExpenseError("Finalized departure balances are inconsistent.", 409);
    bases.set(freeze.id, value.allocations.participants);
    latest = { freezeId: freeze.id, through: departure.leaves_on, allocations: value.allocations };
  }
  return { departures, bases, latest };
}
