import { requireUser } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { BalancePreviewContent } from "@/components/balance-preview";

export default async function Balances({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  return <AppShell user={user}><p className="eyebrow">Monthly allocation</p><h1>My balance preview</h1><p className="lead">Your spending and allocated share for the selected Shamsi month.</p><BalancePreviewContent params={params} room={false} /></AppShell>;
}
