import "server-only";
import { createHash } from "node:crypto";
import { ExpenseError } from "../lib/expense-input";
import { dateString, monthDays, parseShamsiDate, periodKey } from "../lib/shamsi";
import type { BalanceRow } from "../lib/balance-types";

export const ALLOCATION_VERSION = "equal-minor-v1";
export const INITIAL_PERIOD = 140508;
export const INITIAL_START = "1405-08-01";
const ZERO = BigInt(0);
const ONE = BigInt(1);
const HUNDRED = BigInt(100);
export type Member = { userId: number; username: string; startsOn: string; leavesOn: string | null };
export type AllocationExpense = { id: number; userId: number; amount: string; expenseDate: string; version: number; deletedAt: string | null };
export type Freeze = { id: number; throughDate: string; kind: "departure" | "month_end"; algorithmVersion: string };
export type FrozenExpense = { expenseId: number; freezeId: number; expenseVersion: number; sourceHash: string; shares: { userId: number; minor: string }[] };

function unsafe(message: string): never {
  throw new ExpenseError(`Allocations cannot be calculated safely: ${message}`, 409);
}
export function amountToMinor(value: string) {
  if (!/^\d+\.\d{2}$/.test(value)) return unsafe("an amount is not an exact decimal.");
  return BigInt(value.replace(".", ""));
}
export function minorToAmount(value: bigint) {
  const absolute = value < ZERO ? -value : value;
  return `${value < ZERO ? "-" : ""}${absolute / HUNDRED}.${String(absolute % HUNDRED).padStart(2, "0")}`;
}
export function eligibleOn(member: Member, date: string) {
  return member.startsOn <= date && (member.leavesOn === null || member.leavesOn >= date);
}
export function allocationSourceHash(expense: AllocationExpense, ids: number[]) {
  return createHash("sha256").update(JSON.stringify({
    algorithm: ALLOCATION_VERSION, id: expense.id, userId: expense.userId, amount: expense.amount,
    date: expense.expenseDate, version: expense.version, participants: [...ids].sort((a, b) => a - b),
  })).digest("hex");
}

// Pure server-side engine, shared by previews and future settlement/report services.
// No database writes or finalization operations are performed here.
export function calculateAllocations(input: {
  period: number; members: Member[]; expenses: AllocationExpense[];
  freezes?: Freeze[]; frozen?: FrozenExpense[]; periodStatus?: string;
}) {
  const { period, expenses, members, freezes = [], frozen = [], periodStatus = "open" } = input;
  const year = Math.floor(period / 100), month = period % 100;
  const start = dateString({ year, month, day: 1 });
  const end = dateString({ year, month, day: monthDays(year, month) });
  if (!parseShamsiDate(start) || period < INITIAL_PERIOD) unsafe("the accounting month is unsupported.");
  if (!["open", "settling", "closed"].includes(periodStatus)) unsafe("the accounting period state is unknown.");
  if (!members.length || new Set(members.map((m) => m.userId)).size !== members.length) unsafe("the confirmed roster is empty or duplicated.");
  for (const member of members) {
    if (!Number.isInteger(member.userId) || member.userId < 1) unsafe("a membership has an invalid account reference.");
    if (member.startsOn !== INITIAL_START) unsafe("mid-month arrivals and membership changes are not supported.");
    if (member.leavesOn && (!parseShamsiDate(member.leavesOn) || member.leavesOn < member.startsOn)) unsafe("a leaving date is invalid.");
  }
  for (const freeze of freezes) {
    const date = parseShamsiDate(freeze.throughDate);
    if (!date || periodKey(date) !== period || freeze.algorithmVersion !== ALLOCATION_VERSION || !["departure", "month_end"].includes(freeze.kind)) unsafe("a finalized boundary is invalid or uses an unsupported algorithm.");
    if (freeze.kind === "month_end" && freeze.throughDate !== end) unsafe("a month-end freeze does not cover the complete month.");
  }
  if (periodStatus !== "open" && !freezes.some((f) => f.kind === "month_end" && f.throughDate === end)) unsafe("this period is not open and has no complete reviewed allocation snapshot.");
  const through = freezes.map((f) => f.throughDate).sort().at(-1);
  const snapshots = new Map(frozen.map((f) => [f.expenseId, f]));
  if (snapshots.size !== frozen.length || new Set(expenses.map((e) => e.id)).size !== expenses.length) unsafe("duplicate expense or snapshot records exist.");
  const people = members.filter((m) => m.startsOn <= end && (m.leavesOn === null || m.leavesOn >= start)).sort((a, b) => a.userId - b.userId);
  const balances = new Map(people.map((m) => [m.userId, { member: m, spending: ZERO, share: ZERO }]));
  const cursors = new Map<string, number>();
  const allocations: { expenseId: number; sourceHash: string; shares: { userId: number; minor: string }[] }[] = [];
  let total = ZERO;

  for (const expense of [...expenses].sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.id - b.id)) {
    const date = parseShamsiDate(expense.expenseDate);
    if (!date || periodKey(date) !== period) unsafe("an expense belongs to a different or invalid month.");
    const snapshot = snapshots.get(expense.id);
    if (expense.deletedAt !== null) {
      if (snapshot) unsafe("a finalized expense was deleted.");
      continue;
    }
    const eligible = people.filter((m) => eligibleOn(m, expense.expenseDate));
    if (!eligible.length || !eligible.some((m) => m.userId === expense.userId)) unsafe("an expense payer is outside the confirmed participation dates.");
    const amount = amountToMinor(expense.amount);
    if (amount <= ZERO) unsafe("an expense has a nonpositive amount.");
    const ids = eligible.map((m) => m.userId);
    const cohort = ids.join(",");
    const divisor = BigInt(ids.length), base = amount / divisor, remainder = Number(amount % divisor);
    const cursor = cursors.get(cohort) ?? period % ids.length;
    const shares = ids.map((userId) => ({ userId, minor: base }));
    for (let index = 0; index < remainder; index++) shares[(cursor + index) % ids.length].minor += ONE;
    cursors.set(cohort, (cursor + remainder) % ids.length);
    const sourceHash = allocationSourceHash(expense, ids);

    if (through && expense.expenseDate <= through && !snapshot) unsafe("an expense inside a finalized date range has no saved allocation.");
    if (snapshot) {
      const freeze = freezes.find((f) => f.id === snapshot.freezeId);
      if (!freeze || expense.expenseDate > freeze.throughDate || snapshot.expenseVersion !== expense.version || snapshot.sourceHash !== sourceHash) unsafe("a finalized expense or its historical participants changed.");
      if (snapshot.shares.length !== shares.length || new Set(snapshot.shares.map((s) => s.userId)).size !== shares.length) unsafe("a finalized allocation is incomplete.");
      for (const share of shares) {
        const stored = snapshot.shares.find((s) => s.userId === share.userId);
        if (!stored || !/^\d+$/.test(stored.minor) || BigInt(stored.minor) !== share.minor) unsafe("a finalized share is inconsistent with the reviewed calculation.");
        // Consume the saved value. A preview never overwrites a finalized allocation.
        share.minor = BigInt(stored.minor);
      }
    }
    if (shares.reduce((sum, share) => sum + share.minor, ZERO) !== amount) unsafe("expense allocations do not sum to the exact expense amount.");
    total += amount;
    balances.get(expense.userId)!.spending += amount;
    for (const share of shares) balances.get(share.userId)!.share += share.minor;
    allocations.push({ expenseId: expense.id, sourceHash, shares: shares.map((s) => ({ userId: s.userId, minor: String(s.minor) })) });
  }
  if (frozen.some((f) => !expenses.some((e) => e.id === f.expenseId))) unsafe("a saved allocation references a missing expense.");
  const participants: BalanceRow[] = [...balances.values()].map(({ member, spending, share }) => {
    const balance = spending - share;
    return {
      userId: member.userId, username: member.username, spending: minorToAmount(spending), allocatedShare: minorToAmount(share),
      initialBalance: minorToAmount(balance), amount: minorToAmount(balance < ZERO ? -balance : balance),
      direction: balance > ZERO ? "To receive" : balance < ZERO ? "To pay" : "Balanced",
    };
  });
  const allocated = [...balances.values()].reduce((sum, row) => sum + row.share, ZERO);
  const balanceTotal = [...balances.values()].reduce((sum, row) => sum + row.spending - row.share, ZERO);
  if (allocated !== total || balanceTotal !== ZERO) unsafe("room totals are inconsistent.");
  return { participants, allocations, totals: { spending: minorToAmount(total), allocatedShare: minorToAmount(allocated), initialBalance: minorToAmount(balanceTotal) } };
}
