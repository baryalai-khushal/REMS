import { requireUser } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { ReportContent } from "@/components/report-content";
export const dynamic = "force-dynamic";
export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(), params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  return <AppShell user={user}><div className="report-page-heading"><p className="eyebrow">Personal records</p><h1>My monthly report</h1><p className="lead">Your expenses, allocated share, and confirmed fund payments.</p></div><ReportContent params={params} admin={false} /></AppShell>;
}
