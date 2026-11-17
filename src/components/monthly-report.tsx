import type { MonthlyReport } from "@/lib/report-types";
import { reportDocument } from "@/lib/report-document";

export function MonthlyReportDocument({ report }: { report: MonthlyReport }) {
  const view = reportDocument(report);
  return <article className="report-document" aria-label={`${view.title} · ${view.subject} · ${view.period}`}>
    <header className="report-masthead"><p className="report-brand">REMS</p><p>Room Expense Management System</p><h2>{view.title}</h2><p className="report-period">{view.period} · {view.subject}</p><p className="report-status">{view.status}</p></header>
    <div className="report-notes">{view.notes.map((note) => <p key={note}>{note}</p>)}</div>
    {view.tables.map((table) => <section className="report-section" key={table.title}>
      <h3>{table.title}</h3><div className="report-table-wrap"><table aria-label={table.title}>
        <colgroup>{table.widths.map((width, index) => <col key={index} style={{ width: `${width / 9866 * 100}%` }} />)}</colgroup>
        <thead><tr>{table.headers.map((text, index) => <th key={index} scope="col" className={table.numeric.includes(index) ? "report-amount" : undefined}>{text}</th>)}</tr></thead>
        <tbody>{table.rows.length ? table.rows.map((row, i) => <tr key={i}>{row.map((text, column) => <td key={column} className={table.numeric.includes(column) ? "report-amount" : undefined}>{text}</td>)}</tr>) : <tr><td colSpan={table.headers.length} className="report-empty">{table.empty}</td></tr>}</tbody>
      </table></div>
    </section>)}
    <footer className="report-footer"><span>REMS · Kabul · {view.period}</span><span>Snapshot reference: {report.snapshot}</span><small>Page numbering appears in supported print previews and in Word.</small></footer>
  </article>;
}
