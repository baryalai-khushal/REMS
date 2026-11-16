import Link from "next/link";
import { monthlyBalancePreview } from "@/server/balances";
import { ExpenseError, formatAFN } from "@/lib/expense-input";
import { formatPeriod, todayShamsi } from "@/lib/shamsi";
import type { BalancePreview, BalanceRow } from "@/lib/balance-types";
import { BalanceMonthFilter } from "./balance-month-filter";

function BalanceLabel({ person }: { person: BalanceRow }) {
  const style = person.direction === "To receive" ? "balance-receive" : person.direction === "To pay" ? "balance-pay" : "balance-zero";
  return <span className={`balance-label ${style}`}>{person.direction}{person.direction !== "Balanced" && ` · ${formatAFN(person.amount)}`}</span>;
}

export async function BalancePreviewContent({ params, room }: { params: URLSearchParams; room: boolean }) {
  let preview: BalancePreview;
  try { preview = await monthlyBalancePreview(params, room); }
  catch (error) {
    if (!(error instanceof ExpenseError) || ![400, 409].includes(error.status)) throw error;
    const today = todayShamsi();
    return <><section className="card"><BalanceMonthFilter year={today.year} month={today.month} room={room} /></section><p className="notice notice-error" role="alert">{error.message}</p></>;
  }
  return <>
    <section className="card"><BalanceMonthFilter year={preview.year} month={preview.month} room={room} /></section>
    <p className="eyebrow balance-period">{formatPeriod(preview.year * 100 + preview.month)}</p>
    <p className={`notice ${preview.status === "preview" ? "" : "notice-error"}`} role="status">{preview.message}</p>
    {preview.status === "unconfirmed" && room && <Link className="button-link" href="/admin/participation">Review and confirm roommates</Link>}
    {preview.personal && <div className="card-grid">
      <section className="card"><h2>Your spending</h2><p className="balance-value">{formatAFN(preview.personal.spending)}</p></section>
      <section className="card"><h2>Your allocated share</h2><p className="balance-value">{formatAFN(preview.personal.allocatedShare)}</p></section>
      <section className="card"><h2>Your initial balance</h2><BalanceLabel person={preview.personal} /><p className="help-text">Spending minus allocated share. {preview.provisional ? "Provisional while the month is open." : "Frozen when settlement began."} Use My settlements for confirmed payments and your outstanding balance.</p></section>
    </div>}
    {preview.participants && preview.totals && <section className="card history-card"><div className="table-scroll"><table>
      <caption className="sr-only">{preview.provisional ? "Provisional" : "Frozen"} monthly allocations for every participant</caption>
      <thead><tr><th>Participant</th><th className="amount-cell">Spending</th><th className="amount-cell">Allocated share</th><th>Initial balance</th></tr></thead>
      <tbody>{preview.participants.map((person) => <tr key={person.userId}><td>{person.username}</td><td className="amount-cell nowrap">{formatAFN(person.spending)}</td><td className="amount-cell nowrap">{formatAFN(person.allocatedShare)}</td><td><BalanceLabel person={person} /></td></tr>)}</tbody>
      <tfoot><tr><th>Room totals</th><td className="amount-cell nowrap">{formatAFN(preview.totals.spending)}</td><td className="amount-cell nowrap">{formatAFN(preview.totals.allocatedShare)}</td><td>Balanced · {formatAFN(preview.totals.initialBalance)}</td></tr></tfoot>
    </table></div>{!preview.participants.length && <p className="empty-state">No confirmed roommates participated in this month.</p>}</section>}
    {preview.status === "preview" && <p className="help-text">Positive means To receive; negative means To pay; zero means Balanced. Open-month previews update after expense changes. Collections and payouts are not included.</p>}
  </>;
}
