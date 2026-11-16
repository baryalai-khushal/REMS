import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { departureView } from "@/server/departures";
import { minorToAmount } from "@/server/allocation-engine";
import { ExpenseError, formatAFN } from "@/lib/expense-input";
import { dateString, formatPeriod, formatShamsi, parseShamsiDate, todayShamsi } from "@/lib/shamsi";
import { AppShell } from "@/components/app-shell";
import { DepartureSelector } from "@/components/departure-selector";
import { SettlementAction } from "@/components/settlement-action";

export default async function Departures({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin(); const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  let view: Awaited<ReturnType<typeof departureView>>, errorMessage = "";
  try { view = await departureView(params); }
  catch (error) { if (!(error instanceof ExpenseError)) throw error; errorMessage = error.message; view = await departureView(new URLSearchParams()); }
  const selectedDate = params.get("leavesOn") ?? ("leavesOn" in view ? view.leavesOn : undefined) ?? dateString(todayShamsi());
  return <AppShell user={user}><p className="eyebrow">Leaving the room</p><h1>Roommate departures</h1><p className="lead">Review an inclusive cutoff, record real payments, and deactivate only at zero.</p>
    <section className="card expense-editor"><DepartureSelector candidates={view.candidates} selected={params.get("userId") ?? ""} date={parseShamsiDate(selectedDate) ? selectedDate : dateString(todayShamsi())} /></section>
    {errorMessage && <p className="notice notice-error" role="alert">{errorMessage}</p>}
    {"person" in view && view.person && <>
      <section className="card settlement-summary"><h2>{view.username} · through {formatShamsi(view.leavesOn)}, inclusive</h2>
        <p className="notice">{view.deactivated ? "Account deactivated. Historical financial records are preserved." : view.finalized ? "Departure calculation finalized. The account remains active until actual payments settle the balance and deactivation is confirmed." : "Review only. No account, membership, or payment has been changed."}</p>
        <dl className="details"><div><dt>Spending</dt><dd>{formatAFN(view.person.spending)}</dd></div><div><dt>Allocated share</dt><dd>{formatAFN(view.person.allocatedShare)}</dd></div><div><dt>Earlier confirmed collections</dt><dd>{formatAFN(view.person.collections)}</dd></div><div><dt>Earlier confirmed payouts</dt><dd>{formatAFN(view.person.payouts)}</dd></div><div><dt>Outstanding</dt><dd>{view.person.remainingDirection} · {formatAFN(view.person.remainingAmount)}</dd></div><div><dt>Room fund cash held</dt><dd>{formatAFN(view.fundCash)}</dd></div></dl>
        {view.laterExpenseCount > 0 && <p className="notice">{view.laterExpenseCount} later expenses by continuing roommates remain recorded and provisional. They will use the remaining eligible roommates; their expense records are preserved.</p>}
      </section>
      <section className="card settlement-summary"><h2>Reviewed expenses and allocations through the cutoff</h2><p>{view.expenseCount} non-deleted expenses. No amounts after the cutoff are included below.</p><div className="table-scroll"><table><thead><tr><th>Expense</th><th>Shamsi date</th><th>Amount</th><th>Allocated shares</th></tr></thead><tbody>{view.expenses.map((e) => <tr key={e.id}><td>#{e.id} · {view.candidates.find((c) => c.id === e.payerId)?.username}</td><td>{formatShamsi(e.date)}</td><td>{formatAFN(e.amount)}</td><td>{view.allocations.find((a) => a.expenseId === e.id)?.shares.map((s) => <div key={s.userId}>{view.candidates.find((c) => c.id === s.userId)?.username} · {formatAFN(minorToAmount(BigInt(s.minor)))}</div>)}</td></tr>)}</tbody></table></div></section>
      {view.priorObligations.length > 0 && <section className="card settlement-summary"><h2>Earlier tracked months</h2>{view.priorObligations.map((p) => <p key={p.period}>{formatPeriod(p.period)} · {p.verified ? `Verified outstanding ${formatAFN(p.outstanding!)}` : p.message ?? "Unresolved review"}</p>)}</section>}
      {!view.finalized && <section className="card narrow settlement-summary"><h2>Finalize the departure calculation</h2><p>This preserves historical shares and blocks backdated changes through this date. It does not put the entire month into settlement or record a payment.</p><SettlementAction endpoint="/api/admin/departures" values={{ action: "finalize", userId: String(view.userId), leavesOn: view.leavesOn, reviewDigest: view.reviewDigest }} requestKey={randomUUID()} label="Finalize departure cutoff" confirmationName="expensesComplete" confirmationValue="confirm" confirmation="I confirm all expenses through this inclusive leaving date are complete and I reviewed the allocations." /></section>}
      {view.finalized && !view.deactivated && <section className="card narrow settlement-summary"><h2>Settle and deactivate</h2><p><Link className="text-link" href={`/admin/settlements?year=${Math.floor(view.period / 100)}&month=${view.period % 100}`}>Record actual collections and payouts through the room fund</Link>. Partial payments are supported; no payment is created by deactivation.</p><SettlementAction endpoint="/api/admin/departures" values={{ action: "deactivate", userId: String(view.userId) }} requestKey={randomUUID()} label="Deactivate settled account" confirmationValue="deactivate" confirmation="Deactivate this fully settled roommate and invalidate all their sessions." disabled={view.person.outstanding !== "0.00" || view.priorObligations.some((p) => !p.verified || p.outstanding !== "0.00")} /></section>}
    </>}
  </AppShell>;
}
