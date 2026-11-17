import type { MonthlyReport } from "./report-types";
import { formatAFN } from "./expense-input";
import { formatPeriod, formatShamsi } from "./shamsi";

export type ReportTable = { title: string; headers: string[]; rows: string[][]; widths: number[]; numeric: number[]; empty: string };
// XML 1.0 cannot represent control characters or lone surrogates. Both renderers
// show a replacement glyph, preserving valid Unicode text and line breaks.
const documentText = (text: string) => text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "\uFFFD");
export function reportBalance(value: string) {
  return value === "0.00" ? `Balanced · ${formatAFN(value)}` : `${value.startsWith("-") ? "To pay" : "To receive"}\n${formatAFN(value.replace("-", ""))}`;
}

// One presentation model keeps the editable Word tables and HTML preview in agreement.
export function reportDocument(report: MonthlyReport) {
  const room = report.scope === "room";
  const tables: ReportTable[] = [{
    title: "Expenses", headers: ["No.", "Shamsi date", ...(room ? ["Paid by"] : []), "Category", "Description", "Amount (AFN)"],
    rows: report.expenses.map((e, i) => [String(i + 1), formatShamsi(e.date), ...(room ? [e.paidBy ?? ""] : []), e.category, e.description || "—", formatAFN(e.amount)]),
    widths: room ? [550, 1350, 1450, 1050, 3866, 1600] : [550, 1420, 1050, 5246, 1600],
    numeric: [room ? 5 : 4], empty: "No non-deleted expenses recorded for this month.",
  }];
  const summary: string[][] = [[room ? "Total room expenses" : "Total personal spending", formatAFN(report.spending)]];
  if (report.personal) {
    const p = report.personal;
    summary.push(["Actual allocated monthly share", formatAFN(p.allocatedShare)], ["Initial balance", reportBalance(p.initialBalance)],
      ["Net confirmed payments into the fund", formatAFN(p.collections)], ["Net confirmed payments received from the fund", formatAFN(p.payouts)], ["Remaining balance", reportBalance(p.outstanding)]);
  }
  if (report.fund) summary.push(["Net confirmed fund collections", formatAFN(report.fund.collections)], ["Net confirmed fund distributions", formatAFN(report.fund.payouts)], ["Fund cash held", formatAFN(report.fund.cash)]);
  tables.push({ title: "Financial summary", headers: ["Description", "Amount / direction"], rows: summary, widths: [6000, 3866], numeric: [1], empty: "" });
  if (room && report.participants) tables.push({
    title: "Participant summary", headers: ["Roommate", "Spending", "Allocated share", "Initial balance", "Net collections", "Net payouts", "Remaining balance"],
    rows: report.participants.map((p) => [`${p.username}${p.leavesOn ? `\nLeft ${formatShamsi(p.leavesOn)} (inclusive)` : ""}${p.deactivated ? "\nAccount deactivated" : ""}`, formatAFN(p.spending), formatAFN(p.allocatedShare), reportBalance(p.initialBalance), formatAFN(p.collections), formatAFN(p.payouts), reportBalance(p.outstanding)]),
    widths: [1600, 1200, 1200, 1500, 1300, 1300, 1766], numeric: [1, 2, 3, 4, 5, 6], empty: "No participants in this month.",
  });
  if (!room) tables.push({
    title: "Personal settlement history", headers: ["Entry", "Payment date", "Direction", "Amount (AFN)", "Audit reference"],
    rows: (report.history ?? []).map((p) => [`#${p.id}`, formatShamsi(p.date), p.direction === "collection" ? "Into the fund" : "Received from fund", formatAFN(p.amount), p.reversalOf !== null ? `Reversal of #${p.reversalOf}` : p.reversed ? "Original payment — reversed" : "Confirmed payment"]),
    widths: [700, 1700, 2300, 1800, 3366], numeric: [3], empty: "No confirmed payments recorded for this month.",
  });
  return {
    title: "Monthly Expense Report", period: formatPeriod(report.period),
    subject: room ? "Entire Room" : documentText(report.subject?.username ?? "Individual Person"),
    status: report.statusLabel,
    notes: [
      ...(report.financialMessage ? [report.financialMessage] : []),
      ...(report.subject?.leavesOn ? [`Leaving date: ${formatShamsi(report.subject.leavesOn)}, inclusive. Historical participation is preserved.`] : []),
      ...(report.status === "open" && report.rosterConfirmed ? ["Monthly figures are provisional. Finalized departure allocations and confirmed payments are preserved; subsequent permitted expenses can change continuing roommates’ figures."] : []),
      "Fund payments are separate from expense spending. Net payment totals exclude reversed entries; the history preserves originals and linked corrections.",
    ], tables: tables.map((table) => ({ ...table, rows: table.rows.map((row) => row.map(documentText)) })),
  };
}
