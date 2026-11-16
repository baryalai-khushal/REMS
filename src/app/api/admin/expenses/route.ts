import { expenseHistory } from "@/server/expenses";
import { expenseFailure, expenseJSON } from "@/server/expense-http";

export async function GET(request: Request) {
  try { return expenseJSON(await expenseHistory(new URL(request.url).searchParams, true)); }
  catch (error) { return expenseFailure(error); }
}
