export type BalanceRow = {
  userId: number; username: string; spending: string; allocatedShare: string;
  initialBalance: string; amount: string; direction: "To receive" | "To pay" | "Balanced";
};
export type BalancePreview = {
  year: number; month: number; status: "unconfirmed" | "not-participating" | "preview";
  message: string; provisional: boolean;
  personal?: BalanceRow;
  participants?: BalanceRow[];
  totals?: { spending: string; allocatedShare: string; initialBalance: string };
};
