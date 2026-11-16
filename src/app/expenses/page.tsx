import Link from "next/link";
import { requireUser } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { ExpenseHistory } from "@/components/expense-history";

export default async function Expenses({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === "string") params.set(key, value);
  return <AppShell user={user}><div className="page-heading"><div><p className="eyebrow">Personal history</p><h1>My Expenses</h1><p className="lead">Your spending, one Shamsi month at a time.</p></div><Link className="button-link" href="/expenses/new">Add expense</Link></div><ExpenseHistory params={params} /></AppShell>;
}
