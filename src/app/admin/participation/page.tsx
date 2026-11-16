import { requireAdmin } from "@/server/auth";
import { initialRosterReview } from "@/server/participation";
import { AppShell } from "@/components/app-shell";
import { ParticipationSetup } from "@/components/participation-setup";
import { BalanceMonthFilter } from "@/components/balance-month-filter";
import { monthFilter, ExpenseError } from "@/lib/expense-input";
import { formatPeriod, todayShamsi } from "@/lib/shamsi";
export default async function Participation({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin(); const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  let selection, review;
  try {
    selection = monthFilter(params); review = await initialRosterReview(selection.key);
  } catch (error) {
    if (!(error instanceof ExpenseError)) throw error;
    return <AppShell user={user}><BalanceMonthFilter {...todayShamsi()} room action="/admin/participation" /><p className="notice notice-error">{error.message}</p></AppShell>;
  }
  const { year, month, key } = selection;
  return <AppShell user={user}><p className="eyebrow">Historical participation</p><h1>Confirm roommates</h1><p className="lead">{formatPeriod(key)} · Accounts and room membership are separate.</p><section className="card"><BalanceMonthFilter year={year} month={month} room action="/admin/participation" /></section><ParticipationSetup key={key} {...review} /></AppShell>;
}
