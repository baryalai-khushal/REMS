import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { ownExpense } from "@/server/expenses";
import { periodAvailability } from "@/server/periods";
import { ExpenseError, formatAFN } from "@/lib/expense-input";
import { formatShamsi } from "@/lib/shamsi";
import { AppShell } from "@/components/app-shell";
import { DeleteExpense } from "@/components/delete-expense";

export default async function ConfirmDelete({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  let expense;
  try { expense = await ownExpense((await params).id); }
  catch (error) { if (error instanceof ExpenseError && [400, 404].includes(error.status)) notFound(); throw error; }
  const availability = await periodAvailability(expense.periodKey);
  return <AppShell user={user}><p className="eyebrow">Personal spending</p><h1>Delete this expense?</h1><p className="lead">It will be removed from personal spending. Its audit history will remain.</p><section className="card narrow"><h2>{formatAFN(expense.amount)}</h2><p>{formatShamsi(expense.expenseDate)} · {expense.category}</p><p className="description-cell">{expense.description || "No description"}</p>{!availability.allowed && <p className="notice notice-error">{availability.message}</p>}<DeleteExpense id={expense.id} version={expense.version} requestKey={randomUUID()} periodKey={expense.periodKey} allowed={availability.allowed} /></section></AppShell>;
}
