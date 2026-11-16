import { currentUser } from "@/server/auth";
import { periodAvailability } from "@/server/periods";
import { monthFilter } from "@/lib/expense-input";
import { expenseFailure, expenseJSON } from "@/server/expense-http";
import { failure } from "@/server/http";

export async function GET(request: Request) {
  try {
    if (!await currentUser()) return failure("Authentication required.", 401);
    const { key } = monthFilter(new URL(request.url).searchParams);
    return expenseJSON(await periodAvailability(key));
  } catch (error) { return expenseFailure(error); }
}
