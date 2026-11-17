import Link from "next/link";
import { monthlyReport } from "@/server/reports";
import { ExpenseError } from "@/lib/expense-input";
import { ReportSelector, PrintReport } from "./report-selector";
import { MonthlyReportDocument } from "./monthly-report";

export async function ReportContent({ params, admin }: { params: URLSearchParams; admin: boolean }) {
  let selection;
  try { selection = await monthlyReport(params, admin ? "admin" : "personal"); }
  catch (error) {
    if (!(error instanceof ExpenseError) || ![400, 404, 409].includes(error.status)) throw error;
    return <div className="report-controls"><p className="notice notice-error" role="alert">{error.message}</p><Link href={admin ? "/admin/reports" : "/reports"} className="text-link">Choose report again</Link></div>;
  }
  const report = selection.report;
  const download = new URLSearchParams({ scope: selection.scope, year: String(selection.year), month: String(selection.month), ...(report?.subject ? { userId: String(report.subject.userId) } : {}), ...(report ? { snapshot: report.snapshot } : {}) });
  return <>
    <section className="report-controls" aria-label="Report selection"><ReportSelector key={`${selection.year}:${selection.month}:${selection.scope}:${selection.userId}`} selection={selection} admin={admin} />
      {report ? <div className="report-actions"><PrintReport />{admin && <a className="button-link" href={`/api/admin/reports/word?${download}`}>Download Word (.docx)</a>}<p>Only the selected month is shown. Refresh after changes before downloading.</p></div> : <p className="help-text">Choose Entire Room or Individual Person, then select the Shamsi period.</p>}
    </section>
    {report && <MonthlyReportDocument report={report} />}
  </>;
}
