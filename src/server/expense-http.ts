import "server-only";
import { ExpenseError } from "../lib/expense-input";
import { logFailure } from "./http";

export const expenseJSON = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function expenseFailure(error: unknown) {
  if (error instanceof ExpenseError) return expenseJSON({ error: error.message, fields: error.fields }, error.status);
  logFailure("Expense operation", error);
  return expenseJSON({ error: "Expense service is temporarily unavailable. Please try again with the same submission." }, 503);
}
