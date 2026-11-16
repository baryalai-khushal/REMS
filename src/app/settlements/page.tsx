import { requireUser } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { SettlementContent } from "@/components/settlement-content";
export default async function Settlements({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(); const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  return <AppShell user={user}><p className="eyebrow">Personal payments</p><h1>My settlements</h1><p className="lead">Your initial balance, confirmed payments, and outstanding amount.</p><SettlementContent params={params} room={false} /></AppShell>;
}
