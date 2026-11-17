import "server-only";
import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, PageNumber, PageOrientation, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";
import type { MonthlyReport } from "../lib/report-types";
import { reportDocument, type ReportTable } from "../lib/report-document";

function paragraph(text: string, bold = false, numeric = false) {
  return new Paragraph({ children: [new TextRun({ text, bold })], alignment: numeric ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 40 }, keepLines: true, widowControl: true });
}
function table(value: ReportTable) {
  const rows = value.rows.length ? value.rows : [[value.empty, ...value.headers.slice(1).map(() => "")]];
  return new Table({
    width: { size: 9866, type: WidthType.DXA }, columnWidths: value.widths, layout: TableLayoutType.FIXED,
    borders: { top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5CF" }, bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5CF" }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "DFE5E1" }, insideVertical: { style: BorderStyle.NONE } },
    rows: [value.headers, ...rows].map((row, rowIndex) => new TableRow({ tableHeader: rowIndex === 0, cantSplit: true, keepNext: rowIndex === 0,
      children: row.map((text, column) => new TableCell({
        width: { size: value.widths[column], type: WidthType.DXA }, margins: { top: 90, bottom: 90, left: 75, right: 75 },
        ...(rowIndex === 0 ? { shading: { fill: "EFF3F0" } } : {}),
        children: text.split(/\r?\n/).map((line) => paragraph(line, rowIndex === 0, value.numeric.includes(column))),
      })),
    })),
  });
}
export async function wordReport(report: MonthlyReport) {
  const view = reportDocument(report);
  const doc = new Document({
    creator: "REMS", title: `${view.title} — ${view.subject} — ${view.period}`, description: `Snapshot ${report.snapshot}`,
    features: { updateFields: true },
    styles: { default: { document: { run: { font: "Arial", size: 20, color: "24372E" }, paragraph: { spacing: { after: 100 } } } },
      paragraphStyles: [{ id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 36, bold: true }, paragraph: { keepNext: true, spacing: { before: 160, after: 140 } } }, { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true }, paragraph: { keepNext: true, spacing: { before: 240, after: 120 } } }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, margin: { top: 1020, right: 1020, bottom: 1020, left: 1020, header: 400, footer: 400 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: `REMS · ${view.period} · ${view.subject}`, size: 16, color: "62746C" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "REMS · Page ", size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), new TextRun({ text: " of ", size: 16 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 })] })] }) },
      children: [
        new Paragraph({ children: [new TextRun({ text: "REMS", bold: true, size: 32 })], keepNext: true }),
        new Paragraph({ text: "Room Expense Management System", keepNext: true }),
        new Paragraph({ text: view.title, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: `${view.period} · ${view.subject}`, keepNext: true }),
        new Paragraph({ text: view.status, keepNext: true }),
        ...view.notes.map((text) => paragraph(text)),
        ...view.tables.flatMap((value) => [new Paragraph({ text: value.title, heading: HeadingLevel.HEADING_2 }), table(value)]),
        paragraph(`Snapshot reference: ${report.snapshot}`),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
export function reportFilename(report: MonthlyReport) {
  const name = report.scope === "room" ? "entire-room" : `person-${report.subject!.userId}-${report.subject!.username.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32)}`;
  return `REMS-${name}-${report.year}-${String(report.month).padStart(2, "0")}.docx`;
}
