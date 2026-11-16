import { settlementView } from "@/server/settlements";
import { expenseFailure, expenseJSON } from "@/server/expense-http";
export async function GET(request: Request) {
  try { return expenseJSON(await settlementView(new URL(request.url).searchParams)); }
  catch (error) { return expenseFailure(error); }
}
