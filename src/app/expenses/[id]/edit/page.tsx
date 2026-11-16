import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { ownExpense } from "@/server/expenses";
import { periodAvailability } from "@/server/periods";
import { ExpenseError } from "@/lib/expense-input";
import { AppShell } from "@/components/app-shell";
import { ExpenseForm } from "@/components/expense-form";

export default async function EditExpense({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  let expense;
  try { expense = await ownExpense((await params).id); }
  catch (error) { if (error instanceof ExpenseError && [400, 404].includes(error.status)) notFound(); throw error; }
  return <AppShell user={user}><p className="eyebrow">Personal spending</p><h1>Edit Expense</h1><p className="lead">Update your expense while its accounting month is open.</p><section className="card expense-editor"><ExpenseForm initial={expense} today={expense.expenseDate} requestKey={randomUUID()} availability={await periodAvailability(expense.periodKey)} /></section></AppShell>;
}
