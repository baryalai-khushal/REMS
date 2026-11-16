import { settlementView, mutateSettlement } from "@/server/settlements";
import { expenseFailure, expenseJSON } from "@/server/expense-http";
import { failure, readForm, sameOrigin } from "@/server/http";
export async function GET(request: Request) {
  try { return expenseJSON(await settlementView(new URL(request.url).searchParams, true)); }
  catch (error) { return expenseFailure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return failure("Invalid request origin.", 403);
  let form: URLSearchParams;
  try { form = await readForm(request); } catch { return failure("Invalid form.", 400); }
  try { return expenseJSON(await mutateSettlement(form)); }
  catch (error) { return expenseFailure(error); }
}
