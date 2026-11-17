import assert from "node:assert/strict";
import { test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { reportFilename, wordReport } from "../src/server/report-word";
import { reportDocument } from "../src/lib/report-document";
import type { MonthlyReport } from "../src/lib/report-types";

function sample(): MonthlyReport {
  return { scope: "person", year: 1405, month: 8, period: 140508, status: "open", statusLabel: "Open — participation unconfirmed", rosterConfirmed: false,
    subject: { userId: 9, username: "احمد / café", leavesOn: null, deactivated: false },
    expenses: [{ id: 1, date: "1405-08-30", category: "Other", description: "نان & چای <shared> ☕\nSecond line", amount: "0.10" }], spending: "0.10", financialMessage: "Roommates must be confirmed. Shares are unavailable.", snapshot: "a".repeat(64) };
}
test("Word preserves Unicode names and descriptions as editable escaped text with safe filenames", async () => {
  const report = sample(), bytes = await wordReport(report), zip = unzipSync(bytes);
  const xml = strFromU8(zip["word/document.xml"]);
  assert.match(xml, /احمد/); assert.match(xml, /café/); assert.match(xml, /نان &amp; چای &lt;shared&gt; ☕/);
  assert.match(xml, /Second line/); assert.match(xml, /Roommates must be confirmed/);
  assert.match(strFromU8(zip["word/settings.xml"]), /w:updateFields/);
  assert.equal(reportDocument(report).tables[1].rows.length, 1); // No invented share/balance.
  assert.match(reportFilename(report), /^REMS-person-9-[\w.-]+-1405-08\.docx$/);
  assert.ok(!Object.keys(zip).some((key) => key.includes("/media/")));
});
test("preview and Word replace XML-forbidden text without dropping valid Unicode or altering money", async () => {
  const report = sample(); report.expenses[0].description = "text\u0001\u0000 café ☕\nnext";
  const view = reportDocument(report), xml = strFromU8(unzipSync(await wordReport(report))["word/document.xml"]);
  assert.equal(view.tables[0].rows[0][3], "text�� café ☕\nnext");
  assert.ok(!xml.includes("\u0000") && !xml.includes("\u0001")); assert.match(xml, /text�� café ☕/);
  assert.equal(report.spending, "0.10"); assert.equal(report.expenses[0].description, "text\u0001\u0000 café ☕\nnext");
});
