import "server-only";
import { ExpenseError } from "../lib/expense-input";
import type { BalanceRow } from "../lib/balance-types";
import type { LedgerEntry, SettlementPerson } from "../lib/settlement-types";
import { amountToMinor, minorToAmount } from "./allocation-engine";
import { parseShamsiDate } from "../lib/shamsi";

const ZERO = BigInt(0);
export function signedMinor(amount: string) { return amount.startsWith("-") ? -amountToMinor(amount.slice(1)) : amountToMinor(amount); }
function invalid(message: string): never { throw new ExpenseError(`Settlement invariants failed: ${message}`, 409); }

// Each actual payment is checked against its immutable review basis and the payments
// preceding it. Current balances may legitimately change direction as later expenses accrue.
export function calculateLedger(people: BalanceRow[], ledger: LedgerEntry[], bases = new Map<number, BalanceRow[]>()) {
  const sums = new Map(people.map((p) => [p.userId, { collections: ZERO, payouts: ZERO }]));
  const byId = new Map(ledger.map((entry) => [entry.id, entry]));
  const reversed = new Set<number>();
  if (byId.size !== ledger.length || sums.size !== people.length) invalid("duplicate participants or ledger entries.");
  for (const entry of ledger) {
    if (!sums.has(entry.userId) || !parseShamsiDate(entry.paymentDate) || amountToMinor(entry.amount) <= ZERO) invalid("an entry has an invalid participant, date, or amount.");
    if (entry.kind === "reversal") {
      const original = entry.reversalOf === null ? undefined : byId.get(entry.reversalOf);
      if (!original || original.kind !== "payment" || original.id >= entry.id || reversed.has(original.id) || original.userId !== entry.userId || original.direction !== entry.direction || original.amount !== entry.amount || original.paymentDate !== entry.paymentDate || !entry.note.trim()) invalid("invalid or duplicate reversal.");
      reversed.add(original.id);
    } else if (entry.kind !== "payment" || entry.reversalOf !== null) invalid("invalid ledger entry kind.");
  }
  let cash = ZERO;
  // A correction removes an erroneous payment's effect. Dependent payments must
  // still be valid without it; correction entries remain visible in the audit ledger.
  for (const entry of [...ledger].sort((a, b) => a.id - b.id)) {
    if (entry.kind === "reversal" || reversed.has(entry.id)) continue;
    const basis = entry.basisFreezeId == null ? people : bases.get(entry.basisFreezeId);
    const person = basis?.find((p) => p.userId === entry.userId);
    if (!person) invalid("a payment has no valid reviewed allocation basis.");
    const sum = sums.get(entry.userId)!, amount = amountToMinor(entry.amount);
    const outstanding = signedMinor(person.initialBalance) + sum.collections - sum.payouts;
    if (entry.direction === "collection") {
      if (outstanding >= ZERO || amount > -outstanding) invalid("an entry overcollects or has the wrong direction.");
      sum.collections += amount; cash += amount;
    } else if (entry.direction === "payout") {
      if (outstanding <= ZERO || amount > outstanding) invalid("an entry overpays or has the wrong direction.");
      sum.payouts += amount; cash -= amount;
    } else invalid("a payment has the wrong direction.");
    if (cash < ZERO) invalid("payouts or corrections exceed available fund cash; reverse dependent erroneous payouts first.");
  }
  let collected = ZERO, paid = ZERO, remainingToCollect = ZERO, remainingToPay = ZERO, outstandingSum = ZERO;
  const participants: SettlementPerson[] = people.map((person) => {
    const { collections, payouts } = sums.get(person.userId)!;
    const outstanding = signedMinor(person.initialBalance) + collections - payouts;
    collected += collections; paid += payouts; outstandingSum += outstanding;
    if (outstanding < ZERO) remainingToCollect -= outstanding; else remainingToPay += outstanding;
    return { ...person, collections: minorToAmount(collections), payouts: minorToAmount(payouts), outstanding: minorToAmount(outstanding), remainingAmount: minorToAmount(outstanding < ZERO ? -outstanding : outstanding), remainingDirection: outstanding > ZERO ? "To receive" : outstanding < ZERO ? "To pay" : "Balanced" };
  });
  if (outstandingSum !== cash || people.reduce((sum, p) => sum + signedMinor(p.initialBalance), ZERO) !== ZERO) invalid("ledger and room balances do not reconcile.");
  return { participants, collections: minorToAmount(collected), payouts: minorToAmount(paid), cash: minorToAmount(cash), remainingToCollect: minorToAmount(remainingToCollect), remainingToPay: minorToAmount(remainingToPay) };
}
