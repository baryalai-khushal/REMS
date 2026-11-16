import type { BalanceRow } from "./balance-types";
export type LedgerEntry = {
  id: number; userId: number; username: string; direction: "collection" | "payout";
  kind: "payment" | "reversal"; amount: string; paymentDate: string; note: string;
  reversalOf: number | null; recordedBy: number; recordedAt: string;
  basisFreezeId?: number | null;
};
export type SettlementPerson = BalanceRow & {
  collections: string; payouts: string; outstanding: string;
  remainingAmount: string; remainingDirection: "To receive" | "To pay" | "Balanced";
};
export type SettlementView = {
  year: number; month: number; period: number; status: "open" | "settling" | "closed" | "unconfirmed";
  message?: string; reviewDigest?: string; participants?: SettlementPerson[]; personal?: SettlementPerson;
  history?: LedgerEntry[];
  reviewThrough?: string; departureFunding?: boolean;
  monthEndReview?: { participants: SettlementPerson[]; totals: { spending: string; allocatedShare: string; initialBalance: string } };
  totals?: { spending: string; allocatedShare: string; initialBalance: string; collections: string; payouts: string; cash: string; remainingToCollect: string; remainingToPay: string };
};
