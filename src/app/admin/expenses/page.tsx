import { requireAdmin } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { ExpenseHistory } from "@/components/expense-history";

export default async function ExpenseReview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin();
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === "string") params.set(key, value);
  return <AppShell user={user}><p className="eyebrow">Administration</p><h1>Expense review</h1><p className="lead">Review recorded spending by roommate and Shamsi month.</p><ExpenseHistory params={params} review /></AppShell>;
}
