import { parseShamsiDate, periodKey, todayShamsi, validMonth } from "./shamsi";

export const CATEGORIES = ["Breakfast", "Lunch", "Dinner", "Other"] as const;
export type ExpenseInput = { amount: string; expenseDate: string; category: typeof CATEGORIES[number]; description: string; periodKey: number };
export type Expense = ExpenseInput & { id: number; userId: number; username?: string; version: number; createdAt: string; updatedAt: string; deletedAt: string | null };
export class ExpenseError extends Error {
  constructor(message: string, public status = 400, public fields: Record<string, string> = {}) { super(message); }
}

export function parseAmount(raw: string): string | null {
  const value = raw.trim();
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const amount = `${whole}.${fraction.padEnd(2, "0")}`;
  return amount === "0.00" ? null : amount;
}
export function formatAFN(amount: string) {
  const [whole, fraction = "00"] = amount.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")} AFN`;
}
export function validateExpense(form: URLSearchParams): ExpenseInput {
  const amount = parseAmount(form.get("amount") ?? "");
  const expenseDate = form.get("expenseDate") ?? "";
  const date = parseShamsiDate(expenseDate);
  const category = form.get("category") ?? "";
  const description = (form.get("description") ?? "").trim();
  const fields: Record<string, string> = {};
  if (!amount) fields.amount = "Enter a positive AFN amount with at most 12 whole digits and 2 decimal places.";
  if (!date) fields.expenseDate = "Choose a real Hijri Shamsi date, including a valid day for Hoot.";
  if (!CATEGORIES.includes(category as ExpenseInput["category"])) fields.category = "Choose Breakfast, Lunch, Dinner, or Other.";
  if ([...description].length > 100) fields.description = "Use at most 100 characters.";
  if (Object.keys(fields).length) throw new ExpenseError("Check the highlighted expense fields.", 400, fields);
  return { amount: amount!, expenseDate, periodKey: periodKey(date!), category: category as ExpenseInput["category"], description };
}
export function positiveId(raw: string, label = "ID") {
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 4294967295) throw new ExpenseError(`Invalid ${label}.`);
  return Number(raw);
}
export function monthFilter(params: URLSearchParams) {
  const today = todayShamsi();
  const year = params.has("year") ? Number(params.get("year")) : today.year;
  const month = params.has("month") ? Number(params.get("month")) : today.month;
  if (!validMonth(year, month)) throw new ExpenseError("Choose a valid Shamsi year and month.");
  return { year, month, key: periodKey({ year, month }) };
}
