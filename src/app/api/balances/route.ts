import { monthlyBalancePreview } from "@/server/balances";
import { expenseFailure, expenseJSON } from "@/server/expense-http";

export async function GET(request: Request) {
  try { return expenseJSON(await monthlyBalancePreview(new URL(request.url).searchParams)); }
  catch (error) { return expenseFailure(error); }
}
