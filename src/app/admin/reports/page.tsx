import { requireAdmin } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { ReportContent } from "@/components/report-content";
export const dynamic = "force-dynamic";
export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin(), params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  return <AppShell user={user}><div className="report-page-heading"><p className="eyebrow">Room records</p><h1>Monthly reports</h1><p className="lead">Review an A4 document and download editable Word tables.</p></div><ReportContent params={params} admin /></AppShell>;
}
