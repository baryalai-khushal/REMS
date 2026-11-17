import assert from "node:assert/strict";
import { test } from "node:test";
import type { BalanceRow } from "../src/lib/balance-types";
import type { LedgerEntry } from "../src/lib/settlement-types";
import { calculateLedger } from "../src/server/settlement-engine";

function person(userId: number, balance: string): BalanceRow {
  return { userId, username: `roommate.${userId}`, spending: "0.00", allocatedShare: "0.00", initialBalance: balance, amount: balance.replace("-", ""), direction: balance.startsWith("-") ? "To pay" : "To receive" };
}
const payment = (id: number, userId: number, direction: "collection" | "payout", amount: string, basisFreezeId: number): LedgerEntry => ({ id, userId, username: `roommate.${userId}`, direction, kind: "payment", amount, paymentDate: "1405-08-19", note: "Actual payment", reversalOf: null, recordedBy: 9, recordedAt: "2026-11-10 12:00:00", basisFreezeId });

test("reviewed cutoff payments survive a continuing roommate changing from debtor to creditor", () => {
  const first = [person(1, "-500.00"), person(2, "500.00")];
  const later = [person(1, "250.00"), person(2, "-250.00")];
  const bases = new Map([[1, first], [2, later]]);
  const history = [payment(1, 1, "collection", "500.00", 1), payment(2, 2, "payout", "500.00", 1)];
  const saved = JSON.stringify(history);
  const current = calculateLedger(later, history, bases);
  assert.deepEqual(current.participants.map((p) => p.outstanding), ["750.00", "-750.00"]);
  assert.equal(current.cash, "0.00"); assert.equal(JSON.stringify(history), saved);
  const complete = calculateLedger(later, [...history, payment(3, 2, "collection", "750.00", 2), payment(4, 1, "payout", "750.00", 2)], bases);
  assert.equal(complete.cash, "0.00"); assert.ok(complete.participants.every((p) => p.outstanding === "0.00"));
  assert.equal(complete.collections, "1250.00"); assert.equal(complete.payouts, "1250.00");
  assert.throws(() => calculateLedger(later, history), /no valid reviewed allocation basis/);
  assert.throws(() => calculateLedger(later, [...history, payment(3, 1, "payout", "0.01", 2)], bases), /available fund cash/);
  assert.throws(() => calculateLedger(later, [...history, payment(3, 2, "collection", "750.01", 2)], bases), /overcollects/);
});
