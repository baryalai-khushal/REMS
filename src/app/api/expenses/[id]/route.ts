import { mutateExpense, ownExpense } from "@/server/expenses";
import { expenseFailure, expenseJSON } from "@/server/expense-http";
import { failure, readForm, sameOrigin } from "@/server/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return expenseJSON(await ownExpense((await context.params).id)); }
  catch (error) { return expenseFailure(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return failure("Invalid request origin.", 403);
  let form: URLSearchParams;
  try { form = await readForm(request); } catch { return failure("Invalid form.", 400); }
  const action = form.get("action");
  if (action !== "update" && action !== "delete") return failure("Invalid expense action.", 400);
  try { return expenseJSON(await mutateExpense(action, form, (await context.params).id)); }
  catch (error) { return expenseFailure(error); }
}
