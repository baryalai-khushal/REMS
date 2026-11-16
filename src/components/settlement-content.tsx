import { randomUUID } from "node:crypto";
import Link from "next/link";
import { settlementView } from "@/server/settlements";
import { followingPeriod } from "@/server/periods";
import { ExpenseError, formatAFN } from "@/lib/expense-input";
import { dateString, formatPeriod, formatShamsi, todayShamsi } from "@/lib/shamsi";
import type { SettlementView, SettlementPerson } from "@/lib/settlement-types";
import { BalanceMonthFilter } from "./balance-month-filter";
import { SettlementAction } from "./settlement-action";
import { SettlementPayment } from "./settlement-payment";

function direction(person: SettlementPerson) {
  return <span className={`balance-label ${person.remainingDirection === "To pay" ? "balance-pay" : person.remainingDirection === "To receive" ? "balance-receive" : "balance-zero"}`}>{person.remainingDirection} · {formatAFN(person.remainingAmount)}</span>;
}
function recordedTime(value: string) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return `${formatShamsi(dateString(todayShamsi(date)))} ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kabul", hour: "2-digit", minute: "2-digit" }).format(date)} Kabul`;
}
export async function SettlementContent({ params, room }: { params: URLSearchParams; room: boolean }) {
  const action = room ? "/admin/settlements" : "/settlements";
  let view: SettlementView;
  try { view = await settlementView(params, room); }
  catch (error) {
    if (!(error instanceof ExpenseError) || ![400, 409].includes(error.status)) throw error;
    const today = todayShamsi();
    return <><BalanceMonthFilter {...today} room={room} action={action} /><p className="notice notice-error" role="alert">{error.message}</p></>;
  }
  const { year, month } = view, values = { year: String(year), month: String(month) };
  const people = room ? view.participants ?? [] : view.personal ? [view.personal] : [];
  const history = view.history ?? [], reversed = new Set(history.filter((e) => e.reversalOf !== null).map((e) => e.reversalOf));
  return <>
    <section className="card"><BalanceMonthFilter year={year} month={month} room={room} action={action} /></section>
    <p className="eyebrow balance-period">{formatPeriod(view.period)} · {view.status}</p>
    {view.message && <p className="notice" role="status">{view.message}</p>}
    {view.status === "unconfirmed" && room && <Link className="button-link" href={`/admin/participation?year=${year}&month=${month}`}>Review and confirm roommates</Link>}
    {view.status === "open" && <p className="notice">Review the provisional spending and allocations below. Beginning settlement freezes expense changes; it does not record a payment.</p>}
    {view.reviewThrough && <p className="notice">Departure fund review through {formatShamsi(view.reviewThrough)}, inclusive. Payments below use this frozen cutoff. Later expenses remain open and are included in the separate month-end review.</p>}
    {view.status === "closed" && <p className="notice">This month is closed. All outstanding balances and fund cash are zero. Historical records are read-only.</p>}
    {people.length > 0 && <section className="card history-card"><div className="table-scroll"><table><caption className="sr-only">Initial and outstanding settlement balances</caption><thead><tr><th>Participant</th><th>Spending</th><th>Share</th><th>Initial balance</th><th>Confirmed collections</th><th>Confirmed payouts</th><th>Outstanding</th></tr></thead><tbody>
      {people.map((p) => <tr key={p.userId}><td>{p.username}</td><td>{formatAFN(p.spending)}</td><td>{formatAFN(p.allocatedShare)}</td><td>{p.direction} · {formatAFN(p.amount)}</td><td>{formatAFN(p.collections)}</td><td>{formatAFN(p.payouts)}</td><td>{direction(p)}</td></tr>)}
    </tbody>{view.totals && <tfoot><tr><th>Room totals</th><td>{formatAFN(view.totals.spending)}</td><td>{formatAFN(view.totals.allocatedShare)}</td><td>Balanced · {formatAFN(view.totals.initialBalance)}</td><td>{formatAFN(view.totals.collections)}</td><td>{formatAFN(view.totals.payouts)}</td><td>See fund cash</td></tr></tfoot>}</table></div></section>}
    {view.totals && <div className="card-grid settlement-summary"><section className="card"><h2>Fund cash held</h2><p className="balance-value">{formatAFN(view.totals.cash)}</p><p className="help-text">Confirmed collections minus confirmed payouts. Separate from the admin&apos;s personal money.</p></section><section className="card"><h2>Remaining to collect</h2><p className="balance-value">{formatAFN(view.totals.remainingToCollect)}</p></section><section className="card"><h2>Remaining to distribute</h2><p className="balance-value">{formatAFN(view.totals.remainingToPay)}</p></section></div>}
    {view.monthEndReview && <section className="card history-card settlement-summary"><h2>Full month-end review</h2><p>Includes later expenses and all previously confirmed cutoff payments. Spending and shares: {formatAFN(view.monthEndReview.totals.spending)}.</p><div className="table-scroll"><table><thead><tr><th>Participant</th><th>Spending</th><th>Share</th><th>Initial balance</th><th>Outstanding after earlier payments</th></tr></thead><tbody>{view.monthEndReview.participants.map((p) => <tr key={p.userId}><td>{p.username}</td><td>{formatAFN(p.spending)}</td><td>{formatAFN(p.allocatedShare)}</td><td>{p.direction} · {formatAFN(p.amount)}</td><td>{direction(p)}</td></tr>)}</tbody></table></div></section>}
    {room && view.status === "open" && <section className="card narrow"><h2>Begin monthly settlement</h2><p>Confirm the {view.monthEndReview ? "full month-end review" : "reviewed totals"} above. Any expense change after this review will require a new review.</p><SettlementAction values={{ ...values, action: "begin", reviewDigest: view.reviewDigest! }} requestKey={randomUUID()} label="Begin settlement" confirmationValue="begin" confirmation="I reviewed all participants, full-month spending, shares, and initial balances." /></section>}
    {room && (view.status === "settling" || view.departureFunding) && <div className="admin-grid settlement-summary">{(["To pay", "To receive"] as const).map((label) => <section key={label}><h2>{label === "To pay" ? "Collect from roommates" : "Pay roommates"}</h2>{people.filter((p) => p.remainingDirection === label).map((p) => <section className="card settlement-person" key={`${p.userId}:${p.outstanding}`}><h3>{p.username}</h3><p>{direction(p)}</p><SettlementPayment {...{ year, month }} userId={p.userId} direction={label === "To pay" ? "collection" : "payout"} requestKey={randomUUID()} today={dateString(todayShamsi())} /></section>)}{!people.some((p) => p.remainingDirection === label) && <p className="muted">No remaining {label === "To pay" ? "collections" : "payouts"}.</p>}</section>)}</div>}
    {history.length > 0 && <section className="card settlement-summary"><h2>Confirmed payment history</h2><p className="muted">Reversals correct erroneous records. They do not represent another receipt, payout, or physical refund.</p>{history.map((entry) => <article className="ledger-entry" key={entry.id}>
      <h3>#{entry.id} · {entry.username} · {entry.kind === "reversal" ? `Reversal of #${entry.reversalOf}` : entry.direction === "collection" ? "Receipt" : "Payout"} · {formatAFN(entry.amount)}</h3>
      <p>Actual payment date: {formatShamsi(entry.paymentDate)}<br />Recorded: {recordedTime(entry.recordedAt)} · Admin #{entry.recordedBy}{reversed.has(entry.id) && <strong> · Reversed</strong>}</p>{entry.note && <p className="description-cell">{entry.note}</p>}
      {room && (view.status === "settling" || view.departureFunding) && entry.kind === "payment" && !reversed.has(entry.id) && <details><summary>Correct an erroneous record</summary><p>This appends a linked reversal. It does not move real money. Finalized departing roommates are protected from ordinary reversals; dependent incorrect payouts may need correction first.</p><SettlementAction values={{ ...values, action: "reverse", entryId: String(entry.id) }} requestKey={randomUUID()} label="Record reversal" confirmationValue="correction" confirmation="This corrects an erroneous entry; it is not another real payment."><label>Reason (required)<textarea name="reason" required maxLength={200} rows={2} /></label></SettlementAction></details>}
    </article>)}</section>}
    {!history.length && view.status !== "unconfirmed" && <p className="help-text">No confirmed payments recorded for this month.</p>}
    {room && view.status === "settling" && <section className="card narrow settlement-summary"><h2>Close this month</h2><p>Every participant&apos;s outstanding balance and fund cash must be exactly zero. Closure enables only the immediately following month.</p><SettlementAction values={{ ...values, action: "close" }} requestKey={randomUUID()} label="Validate and close month" confirmationValue="close" confirmation="All real payments have been recorded and I request validated closure." disabled={view.totals?.cash !== "0.00" || people.some((p) => p.outstanding !== "0.00")} /></section>}
    {room && view.status === "closed" && <p className="notice"><Link href={`/admin/participation?year=${Math.floor(followingPeriod(view.period) / 100)}&month=${followingPeriod(view.period) % 100}`}>Confirm continuing participants for {formatPeriod(followingPeriod(view.period))}</Link> before entering new-month expenses.</p>}
  </>;
}
