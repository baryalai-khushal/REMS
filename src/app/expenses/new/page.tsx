import { randomUUID } from "node:crypto";
import { requireUser } from "@/server/auth";
import { periodAvailability } from "@/server/periods";
import { dateString, periodKey, todayShamsi } from "@/lib/shamsi";
import { AppShell } from "@/components/app-shell";
import { ExpenseForm } from "@/components/expense-form";

export default async function NewExpense() {
  const user = await requireUser();
  const today = todayShamsi();
  return <AppShell user={user}><p className="eyebrow">Personal spending</p><h1>Add Expense</h1><p className="lead">Record an expense you paid for the room.</p><section className="card expense-editor"><ExpenseForm today={dateString(today)} requestKey={randomUUID()} availability={await periodAvailability(periodKey(today))} /></section></AppShell>;
}
