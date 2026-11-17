import "server-only";
import { ExpenseError } from "../lib/expense-input";
import { logFailure } from "./http";
export const reportHeaders = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export function reportFailure(error: unknown) {
  if (error instanceof ExpenseError) return Response.json({ error: error.message }, { status: error.status, headers: reportHeaders });
  logFailure("Report read", error);
  return Response.json({ error: "The report could not be prepared. Please try again." }, { status: 503, headers: reportHeaders });
}
