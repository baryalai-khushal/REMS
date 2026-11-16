import { requireAdmin } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { SettlementContent } from "@/components/settlement-content";
export default async function Settlements({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin(); const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  return <AppShell user={user}><p className="eyebrow">Room fund administration</p><h1>Monthly settlement</h1><p className="lead">Review, record actual receipts and payouts, and validate closure.</p><SettlementContent params={params} room /></AppShell>;
}
