import type { SettlementPerson } from "./settlement-types";

export type ReportExpense = { id: number; date: string; category: string; description: string; amount: string; paidBy?: string };
export type ReportParticipant = SettlementPerson & { leavesOn: string | null; deactivated: boolean };
export type ReportPayment = { id: number; date: string; direction: "collection" | "payout"; amount: string; reversalOf: number | null; reversed: boolean };
export type MonthlyReport = {
  scope: "room" | "person"; year: number; month: number; period: number;
  status: "open" | "settling" | "closed" | "untracked"; statusLabel: string;
  rosterConfirmed: boolean; financialMessage?: string;
  subject?: { userId: number; username: string; leavesOn: string | null; deactivated: boolean };
  expenses: ReportExpense[]; spending: string;
  personal?: ReportParticipant; participants?: ReportParticipant[];
  fund?: { collections: string; payouts: string; cash: string };
  history?: ReportPayment[]; snapshot: string;
};
export type ReportSelection = {
  year: number; month: number; scope: "room" | "person" | ""; userId?: number;
  candidates?: { id: number; username: string; deactivated: boolean }[];
  report: MonthlyReport | null;
};
