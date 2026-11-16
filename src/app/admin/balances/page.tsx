import { requireAdmin } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { BalancePreviewContent } from "@/components/balance-preview";

export default async function RoomBalances({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  return <AppShell user={user}><p className="eyebrow">Administration</p><h1>Room balance preview</h1><p className="lead">Every historical participant, including roommates with no personal spending.</p><BalancePreviewContent params={params} room /></AppShell>;
}
