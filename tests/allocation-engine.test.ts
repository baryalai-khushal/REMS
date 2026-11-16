import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALLOCATION_VERSION, INITIAL_START, amountToMinor, calculateAllocations,
  type AllocationExpense, type Member, type FrozenExpense,
} from "../src/server/allocation-engine";

const members = (count: number): Member[] => Array.from({ length: count }, (_, i) => ({ userId: i + 1, username: `person.${i + 1}`, startsOn: INITIAL_START, leavesOn: null }));
const expenses = (amounts: string[]): AllocationExpense[] => amounts.map((amount, i) => ({
  id: i + 1, userId: i + 1, amount, expenseDate: "1405-08-19", version: 1, deletedAt: null,
}));
const calculate = (count: number, amounts: string[]) => calculateAllocations({ period: 140508, members: members(count), expenses: expenses(amounts) });

test("two payers spending 2000/1000 have equal shares and +500/-500 balances", () => {
  const result = calculate(2, ["2000.00", "1000.00"]);
  assert.deepEqual(result.participants.map((p) => p.allocatedShare), ["1500.00", "1500.00"]);
  assert.deepEqual(result.participants.map((p) => p.initialBalance), ["500.00", "-500.00"]);
  assert.deepEqual(result.participants.map((p) => p.direction), ["To receive", "To pay"]);
  assert.deepEqual(result.totals, { spending: "3000.00", allocatedShare: "3000.00", initialBalance: "0.00" });
});

test("five-payer SRS example conserves all spending and balances", () => {
  const result = calculate(5, ["2000.00", "1000.00", "500.00", "1000.00", "3000.00"]);
  assert.deepEqual(result.participants.map((p) => p.allocatedShare), Array(5).fill("1500.00"));
  assert.deepEqual(result.participants.map((p) => p.initialBalance), ["500.00", "-500.00", "-1000.00", "-500.00", "1500.00"]);
  assert.equal(result.totals.initialBalance, "0.00");
});

test("zero-spending participants receive shares; empty months are balanced", () => {
  const result = calculate(3, ["30.00"]);
  assert.equal(result.participants.length, 3);
  assert.deepEqual(result.participants.map((p) => p.spending), ["30.00", "0.00", "0.00"]);
  assert.deepEqual(result.participants.map((p) => p.initialBalance), ["20.00", "-10.00", "-10.00"]);
  const empty = calculate(3, []);
  assert.ok(empty.participants.every((p) => p.direction === "Balanced" && p.allocatedShare === "0.00"));
});

test("rounding rotates each cent and unchanged membership stays within one minor unit", () => {
  const small = Array.from({ length: 5 }, (_, i) => ({ ...expenses(["0.01"])[0], id: i + 1 }));
  const first = calculateAllocations({ period: 140508, members: members(5), expenses: small });
  assert.deepEqual(first.participants.map((p) => p.allocatedShare), Array(5).fill("0.01"));
  assert.equal(new Set(first.allocations.map((a) => a.shares.find((s) => s.minor === "1")!.userId)).size, 5);
  const many = Array.from({ length: 1001 }, (_, i) => ({ ...small[0], id: i + 1, amount: ["0.01", "0.02", "0.07"][i % 3] }));
  const result = calculateAllocations({ period: 140508, members: members(5), expenses: many });
  const shares = result.participants.map((p) => amountToMinor(p.allocatedShare)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  assert.ok(shares.at(-1)! - shares[0] <= BigInt(1));
  for (let i = 0; i < many.length; i++) {
    assert.equal(result.allocations[i].shares.reduce((sum, share) => sum + BigInt(share.minor), BigInt(0)), amountToMinor(many[i].amount));
  }
  assert.deepEqual(calculateAllocations({ period: 140508, members: [...members(5)].reverse(), expenses: [...many].reverse() }), result);
  const nextMonth = calculateAllocations({ period: 140509, members: members(5), expenses: [{ ...small[0], expenseDate: "1405-09-01" }] });
  assert.notEqual(nextMonth.allocations[0].shares.find((s) => s.minor === "1")!.userId, first.allocations[0].shares.find((s) => s.minor === "1")!.userId);
});

test("edits and soft deletion change provisional balances using exact arithmetic", () => {
  const records = expenses(["2000.00", "1000.00"]);
  const updated = calculateAllocations({ period: 140508, members: members(2), expenses: [{ ...records[0], version: 2, amount: "1000.00" }, records[1]] });
  assert.ok(updated.participants.every((p) => p.direction === "Balanced"));
  const deleted = calculateAllocations({ period: 140508, members: members(2), expenses: [{ ...records[0], version: 3, deletedAt: "2026-11-10 10:00:00" }, records[1]] });
  assert.deepEqual(deleted.participants.map((p) => p.initialBalance), ["-500.00", "500.00"]);
  assert.equal(deleted.totals.spending, "1000.00");
});

test("leaving date is inclusive and earlier allocations and snapshots remain unchanged", () => {
  const allMembers = members(3);
  const earlier: AllocationExpense[] = [
    { ...expenses(["0.01"])[0], expenseDate: "1405-08-19" },
    { ...expenses(["0.04"])[0], id: 2, expenseDate: "1405-08-20" },
  ];
  const original = calculateAllocations({ period: 140508, members: allMembers, expenses: earlier });
  const withDeparture = allMembers.map((m) => m.userId === 3 ? { ...m, leavesOn: "1405-08-20" } : m);
  const records = [...earlier, { ...earlier[0], id: 3, amount: "0.04", expenseDate: "1405-08-21" }];
  const frozen: FrozenExpense[] = original.allocations.map((a) => ({ ...a, expenseVersion: 1, freezeId: 1 }));
  const saved = JSON.stringify(frozen);
  const result = calculateAllocations({
    period: 140508, members: withDeparture, expenses: records, frozen,
    freezes: [{ id: 1, throughDate: "1405-08-20", kind: "departure", algorithmVersion: ALLOCATION_VERSION }],
  });
  assert.deepEqual(result.allocations.slice(0, 2), original.allocations);
  assert.deepEqual(result.allocations[1].shares.map((s) => s.userId), [1, 2, 3]);
  assert.deepEqual(result.allocations[2].shares.map((s) => s.userId), [1, 2]);
  assert.equal(result.participants[2].allocatedShare, original.participants[2].allocatedShare);
  assert.equal(JSON.stringify(frozen), saved);
  assert.equal(result.totals.initialBalance, "0.00");
});

test("unsafe or incomplete finalized history fails instead of guessing or replacing it", () => {
  const input = { period: 140508, members: members(2), expenses: expenses(["1.01"]) };
  const original = calculateAllocations(input);
  const frozen: FrozenExpense[] = original.allocations.map((a) => ({ ...a, expenseVersion: 1, freezeId: 1 }));
  const freeze = { id: 1, throughDate: "1405-08-20", kind: "departure" as const, algorithmVersion: ALLOCATION_VERSION };
  assert.throws(() => calculateAllocations({ ...input, periodStatus: "settling" }), /no complete reviewed/);
  assert.throws(() => calculateAllocations({ ...input, freezes: [freeze] }), /no saved allocation/);
  assert.throws(() => calculateAllocations({ ...input, frozen, freezes: [freeze], expenses: [{ ...input.expenses[0], version: 2 }] }), /finalized expense/);
  assert.throws(() => calculateAllocations({ ...input, frozen, freezes: [freeze], expenses: [{ ...input.expenses[0], deletedAt: "deleted" }] }), /finalized expense was deleted/);
  assert.throws(() => calculateAllocations({ ...input, frozen, freezes: [freeze], members: members(3) }), /historical participants changed/);
  assert.throws(() => calculateAllocations({ ...input, frozen: frozen.map((f) => ({ ...f, shares: [{ userId: 1, minor: "101" }] })), freezes: [freeze] }), /incomplete/);
  assert.throws(() => calculateAllocations({ ...input, members: [{ ...members(1)[0], startsOn: "1405-08-02" }] }), /arrivals/);
  const monthEnd = { ...freeze, kind: "month_end" as const, throughDate: "1405-08-30" };
  assert.deepEqual(calculateAllocations({ ...input, frozen, freezes: [monthEnd], periodStatus: "closed" }).participants, original.participants);
});
