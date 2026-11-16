import { expenseHistory, mutateExpense } from "@/server/expenses";
import { expenseFailure, expenseJSON } from "@/server/expense-http";
import { failure, readForm, sameOrigin } from "@/server/http";

export async function GET(request: Request) {
  try { return expenseJSON(await expenseHistory(new URL(request.url).searchParams)); }
  catch (error) { return expenseFailure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return failure("Invalid request origin.", 403);
  let form: URLSearchParams;
  try { form = await readForm(request); } catch { return failure("Invalid form.", 400); }
  try {
    const result = await mutateExpense("create", form);
    return expenseJSON(result, result.replayed ? 200 : 201);
  } catch (error) { return expenseFailure(error); }
}
