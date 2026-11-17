import "../scripts/env";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import mysql, { type Connection, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { unzipSync, strFromU8 } from "fflate";
import { chromium } from "playwright";
import { databaseConfig, db } from "../src/server/database";
import { hashPassword } from "../src/server/password";
import { initializePeriod } from "../src/server/periods";
import { migrate } from "../scripts/migrations";
import { amountToMinor } from "../src/server/allocation-engine";
import { reportDocument } from "../src/lib/report-document";
import type { MonthlyReport, ReportSelection } from "../src/lib/report-types";
import { dateString, todayShamsi } from "../src/lib/shamsi";

const databaseName = `rems_test_${randomBytes(8).toString("hex")}`;
const cookies: string[] = [], ids: number[] = [];
let root: Connection, sql: Connection, server: ChildProcess | undefined;
let created = false, origin = "", output = "", expenseA = 0;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const period = "year=1405&month=8", roomQuery = `${period}&scope=room`;
const personalQuery = (person: number) => `${period}&scope=person&userId=${ids[person]}`;
before(async () => {
  root = await mysql.createConnection({ ...databaseConfig(), database: undefined });
  await root.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`); created = true;
  process.env.DB_NAME = databaseName; process.env.REMS_TEST_DATABASE = "1";
  await migrate(); await initializePeriod(1405, 8); sql = await mysql.createConnection(databaseConfig());
  const passwordHash = await hashPassword(randomBytes(6).toString("base64"));
  for (const [index, username] of ["admin", "roommate.a", "roommate.b", "roommate.c"].entries()) {
    const [user] = await sql.execute<ResultSetHeader>("INSERT INTO rems_users (username,password_hash,role) VALUES (?,?,?)", [username, passwordHash, index === 0 ? "admin" : "roommate"]);
    ids.push(user.insertId); const token = randomBytes(32).toString("hex"); cookies.push(`rems_session=${token}`);
    await sql.execute("INSERT INTO rems_sessions (token_hash,user_id,expires_at) VALUES (?,?,TIMESTAMPADD(DAY,7,CURRENT_TIMESTAMP(3)))", [hash(token), user.insertId]);
  }
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as { port: number }).port; await new Promise<void>((resolve) => listener.close(() => resolve())); origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", APP_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout?.on("data", (value) => { output = (output + value).slice(-10000); }); server.stderr?.on("data", (value) => { output = (output + value).slice(-10000); });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Report test server exited: ${output}`);
    try { if ((await request("/login")).ok) return; } catch { /* Startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Report test server did not start: ${output}`);
}, { timeout: 60000 });
after(async () => {
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  await db().end(); await sql?.end();
  if (created) { assert.match(databaseName, /^rems_test_[a-f0-9]{16}$/); await root.query(`DROP DATABASE \`${databaseName}\``); } await root?.end();
});
function request(path: string, cookie?: string, body?: URLSearchParams) {
  return fetch(`${origin}${path}`, { redirect: "manual", method: body ? "POST" : "GET", headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin } : {}) }, body });
}
async function success(response: Response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function adminReport(query = roomQuery): Promise<MonthlyReport> {
  const value: ReportSelection = await success(await request(`/api/admin/reports?${query}`, cookies[0])); assert.ok(value.report); return value.report;
}
const operation = (action: string, values: Record<string, string> = {}) => new URLSearchParams({ action, year: "1405", month: "8", requestKey: randomUUID(), ...values });
const settle = (body: URLSearchParams) => request("/api/admin/settlements", cookies[0], body);
const pay = (person: number, direction: string, amount: string) => settle(operation("payment", { userId: String(ids[person]), direction, amount, paymentDate: dateString(todayShamsi()), actualPayment: "confirm" }));
const expense = (person: number, amount: string, date = "1405-08-20", description = "Shared expense") => request("/api/expenses", cookies[person], new URLSearchParams({ amount, expenseDate: date, category: "Other", description, requestKey: randomUUID() }));
const download = (query = roomQuery, cookie = cookies[0]) => request(`/api/admin/reports/word?${query}`, cookie);
const text = (value: string) => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
function wordTables(xml: string) {
  return [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(([table]) => [...table.matchAll(/<w:tr(?: [^>]*)?>[\s\S]*?<\/w:tr>/g)].map(([row]) => [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(([cell]) => [...cell.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => text(match[1])).join("\n"))));
}

test("milestone 6: private monthly reports and genuine A4 Word downloads", { timeout: 120000 }, async (t) => {
  let originalPayment = 0;
  await t.test("every report page/API/download checks sessions and admin permissions", async () => {
    for (const path of ["/api/reports", "/api/admin/reports", "/api/admin/reports/word"]) assert.equal((await request(path)).status, 401);
    assert.equal((await request("/reports")).status, 307);
    assert.equal((await request("/admin/reports", cookies[1])).status, 307);
    for (const path of ["/api/admin/reports", "/api/admin/reports/word"]) assert.equal((await request(path, cookies[1])).status, 403);
    assert.equal((await request(`/api/reports?${personalQuery(2)}`, cookies[1])).status, 403);
    assert.equal((await request(`/api/reports?${roomQuery}`, cookies[1])).status, 403);
    assert.equal((await download(`${period}&scope=person&userId=4294967295`)).status, 404);
    assert.equal((await download(period)).status, 400);
    assert.equal((await request("/api/reports?year=1405&month=13", cookies[1])).status, 400);
    assert.equal((await success(await request(`/api/admin/reports?${period}`, cookies[0]))).report, null);
  });

  await t.test("unconfirmed and empty months show spending without invented financial balances", async () => {
    const empty = await adminReport(); assert.equal(empty.spending, "0.00"); assert.equal(empty.participants, undefined); assert.equal(empty.fund, undefined); assert.match(empty.financialMessage!, /must be confirmed/);
    expenseA = (await success(await expense(1, "600"), 201)).expense.id;
    await success(await expense(3, "300"), 201);
    const unconfirmed = await adminReport(personalQuery(1)); assert.equal(unconfirmed.spending, "600.00"); assert.equal(unconfirmed.personal, undefined);
    assert.equal((await download(`${personalQuery(1)}&snapshot=${unconfirmed.snapshot}`)).status, 200);
    const future = await adminReport("scope=room&year=1405&month=9"); assert.equal(future.status, "untracked"); assert.deepEqual(future.expenses, []);
    const html = await (await request(`/reports?${period}`, cookies[1])).text(); assert.match(html, /Roommates must be confirmed/); assert.doesNotMatch(html, /Download Word/);
    const roster = await success(await request(`/api/admin/participation?${period}`, cookies[0]));
    const body = new URLSearchParams({ period: "140508", acknowledge: "confirm", revision: roster.revision }); ids.slice(1).forEach((id) => body.append("participantId", String(id)));
    await success(await request("/api/admin/participation", cookies[0], body));
  });

  await t.test("provisional personal privacy and zero-spending historical participants", async () => {
    const room = await adminReport(); assert.equal(room.status, "open"); assert.match(room.statusLabel, /provisional/); assert.equal(room.spending, "900.00");
    assert.deepEqual(room.participants!.map((p) => p.initialBalance), ["300.00", "-300.00", "0.00"]);
    assert.equal(room.participants![1].spending, "0.00"); assert.equal(room.participants![1].allocatedShare, "300.00");
    const response = await request(`/api/reports?${period}`, cookies[1]); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /private.*no-store/); assert.ok(response.headers.get("vary")!.split(/,\s*/).includes("Cookie"));
    const own: ReportSelection = await response.json(); assert.equal(own.candidates, undefined); assert.equal(own.report!.participants, undefined); assert.equal(own.report!.fund, undefined); assert.equal(own.report!.subject!.userId, ids[1]);
    assert.ok(own.report!.expenses.every((e) => e.paidBy === undefined)); assert.doesNotMatch(JSON.stringify(own), /roommate\.b|roommate\.c|password_hash|token_hash/);
    const b: ReportSelection = await success(await request(`/api/reports?${period}`, cookies[2])); assert.deepEqual(b.report!.expenses, []); assert.equal(b.report!.personal!.spending, "0.00");
    const emptyWord = unzipSync(new Uint8Array(await (await download(personalQuery(2))).arrayBuffer()));
    const emptyXml = strFromU8(emptyWord["word/document.xml"]); assert.match(emptyXml, /No non-deleted expenses recorded/); assert.match(emptyXml, /300.00 AFN/); assert.match(emptyXml, /To pay/);
    const page = await request(`/reports?${period}`, cookies[1]); assert.match(page.headers.get("cache-control")!, /private.*no-store/);
  });

  await t.test("repeatable-read reports remain internally consistent during concurrent expense updates", async () => {
    for (let index = 0; index < 4; index++) {
      const pending = Array.from({ length: 6 }, () => adminReport());
      const update = request(`/api/expenses/${expenseA}`, cookies[1], new URLSearchParams({ action: "update", version: String(index + 1), amount: index % 2 ? "600" : "600.01", expenseDate: "1405-08-20", category: "Other", description: "Concurrent snapshot verification", requestKey: randomUUID() }));
      for (const report of await Promise.all(pending)) {
        assert.equal(report.expenses.reduce((sum, e) => sum + amountToMinor(e.amount), BigInt(0)), amountToMinor(report.spending));
        assert.equal(report.participants!.reduce((sum, p) => sum + amountToMinor(p.spending), BigInt(0)), amountToMinor(report.spending));
      }
      await success(await update);
    }
  });

  await t.test("departed users remain selectable and partial/reversed payments appear exactly once", async () => {
    const reviewed = await success(await request(`/api/admin/departures?userId=${ids[3]}&leavesOn=1405-08-20`, cookies[0]));
    await success(await request("/api/admin/departures", cookies[0], operation("finalize", { userId: String(ids[3]), leavesOn: "1405-08-20", reviewDigest: reviewed.reviewDigest, expensesComplete: "confirm" })));
    await success(await request("/api/admin/departures", cookies[0], operation("deactivate", { userId: String(ids[3]), acknowledge: "deactivate" })));
    await success(await pay(2, "collection", "300")); originalPayment = (await success(await pay(1, "payout", "100"))).entryId;
    await success(await settle(operation("reverse", { entryId: String(originalPayment), reason: "Erroneous recorded amount", acknowledge: "correction" })));
    await success(await pay(1, "payout", "50"));
    const personal = await adminReport(personalQuery(1)); assert.equal(personal.personal!.payouts, "50.00"); assert.equal(personal.personal!.outstanding, "250.00"); assert.equal(personal.history!.length, 3);
    assert.equal(personal.history!.find((e) => e.id === originalPayment)!.reversed, true); assert.equal(personal.history!.filter((e) => e.reversalOf === originalPayment).length, 1);
    await success(await expense(2, "300", "1405-08-21"), 201);
    const full = await adminReport(); assert.equal(full.spending, "1200.00"); assert.deepEqual(full.participants!.map((p) => p.outstanding), ["100.00", "150.00", "0.00"]); assert.equal(full.fund!.cash, "250.00");
    const departed = await adminReport(personalQuery(3)); assert.equal(departed.subject!.leavesOn, "1405-08-20"); assert.equal(departed.subject!.deactivated, true); assert.equal(departed.personal!.allocatedShare, "300.00"); assert.equal(departed.personal!.outstanding, "0.00");
    const selection: ReportSelection = await success(await request(`/api/admin/reports?${period}`, cookies[0])); assert.ok(selection.candidates!.some((p) => p.id === ids[3] && p.deactivated));
    assert.equal((await request(`/api/reports?${period}`, cookies[3])).status, 401);
  });

  await t.test("Word is genuine OOXML with exactly the same selected report tables and A4 settings", async () => {
    const report = await adminReport(personalQuery(1)); const response = await download(`${personalQuery(1)}&snapshot=${report.snapshot}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); assert.match(response.headers.get("content-disposition")!, /REMS-person-\d+-roommate\.a-1405-08\.docx/); assert.match(response.headers.get("cache-control")!, /private.*no-store/); assert.ok(response.headers.get("vary")!.split(/,\s*/).includes("Cookie"));
    const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(Buffer.from(bytes.subarray(0, 2)).toString(), "PK");
    const zip = unzipSync(bytes); for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/footer1.xml"]) assert.ok(zip[part], part);
    const xml = strFromU8(zip["word/document.xml"]); assert.match(xml, /w:w="11906"/); assert.match(xml, /w:h="16838"/); assert.match(xml, /w:orient="portrait"/); assert.match(xml, /w:tblHeader/); assert.match(xml, /w:cantSplit/); assert.match(xml, /w:jc w:val="right"/);
    const footer = strFromU8(zip["word/footer1.xml"]); assert.match(footer, /PAGE/); assert.match(footer, /NUMPAGES/);
    assert.deepEqual(wordTables(xml), reportDocument(report).tables.map((value) => [value.headers, ...value.rows])); assert.match(xml, new RegExp(report.snapshot)); assert.doesNotMatch(xml, /roommate\.b|roommate\.c/);
    assert.ok(!Object.keys(zip).some((part) => part.startsWith("word/media/"))); // Editable text and tables, no screenshot.
    const old = (await adminReport()).snapshot;
    await success(await expense(2, "0.10", "1405-08-21", "نان و چای — café & <rent>"), 201);
    assert.equal((await download(`${roomQuery}&snapshot=${old}`)).status, 409);
  });

  await t.test("large months include every row and Unicode/long descriptions without history pagination", async () => {
    const description = "نان و چای — café & <rent> ".repeat(5).slice(0, 100);
    for (let index = 0; index < 79; index++) await success(await expense(2, "0.10", "1405-08-21", `${String(index).padStart(2, "0")} ${description}`.slice(0, 100)), 201);
    const report = await adminReport(); assert.equal(report.expenses.length, 83); assert.equal(report.spending, "1208.00");
    assert.deepEqual(report.participants!.map((p) => p.outstanding), ["96.00", "154.00", "0.00"]);
    const bytes = new Uint8Array(await (await download(`${roomQuery}&snapshot=${report.snapshot}`)).arrayBuffer());
    const zip = unzipSync(bytes); const xml = strFromU8(zip["word/document.xml"]);
    assert.match(xml, /نان و چای/); assert.match(xml, /&amp;/); assert.match(xml, /&lt;rent&gt;/); assert.deepEqual(wordTables(xml), reportDocument(report).tables.map((value) => [value.headers, ...value.rows]));
    mkdirSync(".cache/report-verification", { recursive: true }); writeFileSync(".cache/report-verification/room-multipage.docx", bytes); writeFileSync(".cache/report-verification/room-data.json", JSON.stringify(report, null, 2));
  });

  await t.test("desktop/mobile browser preview, selection changes, editable export and multi-page A4 printing", async (context) => {
    if (!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") && !process.env.REMS_REPORT_BROWSER_CHANNEL) { context.skip("Set REMS_REPORT_BROWSER_CHANNEL to an installed Playwright browser channel for visual checks."); return; }
    const browser = await chromium.launch({ channel: process.env.REMS_REPORT_BROWSER_CHANNEL ?? "chrome", headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
      await page.context().addCookies([{ name: "rems_session", value: cookies[0].split("=")[1], url: origin }]);
      await page.goto(`${origin}/admin/reports?${roomQuery}`); await page.locator(".report-document").waitFor();
      const report = await adminReport();
      const rendered = await page.locator(".report-document table").evaluateAll((tables) => tables.map((table) => Array.from(table.querySelectorAll("tr"), (row) => Array.from(row.querySelectorAll("th,td"), (cell) => cell.textContent))));
      assert.deepEqual(rendered, reportDocument(report).tables.map((table) => [table.headers, ...table.rows]));
      assert.equal(await page.locator(".report-controls .report-document").count(), 0);
      assert.ok(await page.locator(".report-document").evaluate((node) => node.scrollWidth <= node.clientWidth));
      await page.screenshot({ path: ".cache/report-verification/browser-desktop.png" });
      await page.pdf({ path: ".cache/report-verification/browser-multipage.pdf", preferCSSPageSize: true, printBackground: true });
      const file = new Uint8Array(await (await download()).arrayBuffer()); const zip = unzipSync(file);
      for (const [name, bytes] of Object.entries(zip).filter(([name]) => name.endsWith(".xml"))) {
        const valid = await page.evaluate((xml) => !new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror"), strFromU8(bytes)); assert.ok(valid, name);
      }
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: ".cache/report-verification/browser-mobile.png" });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.locator(".report-document").scrollIntoViewIfNeeded(); await page.screenshot({ path: ".cache/report-verification/browser-mobile-document.png" });
      await page.getByLabel("Shamsi month", { exact: true }).selectOption("9"); await Promise.all([page.waitForURL(/month=9/), page.getByRole("button", { name: "View report", exact: true }).click()]);
      assert.equal(await page.locator(".report-document tbody tr").first().innerText(), "No non-deleted expenses recorded for this month.");
      assert.match(await page.locator(".report-period").innerText(), /Qaws 1405/);
      // Independently render the downloaded OOXML, rather than reusing the app's HTML.
      const wordPage = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
      await wordPage.setContent('<div id="word-sample"></div>');
      await wordPage.addScriptTag({ path: "node_modules/jszip/dist/jszip.min.js" });
      await wordPage.addScriptTag({ path: "node_modules/docx-preview/dist/docx-preview.min.js" });
      await wordPage.evaluate(async (bytes) => {
        const renderer = (window as typeof window & { docx: { renderAsync: (data: Uint8Array, element: HTMLElement, styles: HTMLElement, options: object) => Promise<unknown> } }).docx;
        const target = document.getElementById("word-sample")!;
        await renderer.renderAsync(new Uint8Array(bytes), target, target, { breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true });
      }, Array.from(file));
      assert.equal(await wordPage.locator("table").count(), reportDocument(report).tables.length);
      assert.match(await wordPage.locator("body").innerText(), /1,208.00 AFN/);
      await wordPage.screenshot({ path: ".cache/report-verification/word-render-desktop.png" });
      // This independent HTML renderer has approximate pagination; the OOXML's native
      // A4, row/header and PAGE/NUMPAGES settings are verified separately above.
      await wordPage.addStyleTag({ content: '@page { size: A4 portrait; margin: 18mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial; } } @media print { body { margin: 0; } .docx-wrapper { padding: 0 !important; background: white !important; } section.docx { width: 174mm !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; height: auto !important; box-shadow: none !important; } section.docx article { margin: 0 !important; } table { width: 100% !important; } tr { break-inside: avoid; } }' });
      await wordPage.pdf({ path: ".cache/report-verification/word-multipage.pdf", preferCSSPageSize: true, printBackground: true });
      await wordPage.close();
    } finally { await browser.close(); }
  });

  await t.test("settling/closed reports use frozen allocations and exclude the following Shamsi month", async () => {
    const settlement = await success(await request(`/api/admin/settlements?${period}`, cookies[0]));
    await success(await settle(operation("begin", { acknowledge: "begin", reviewDigest: settlement.reviewDigest })));
    const frozen = await adminReport(); assert.equal(frozen.status, "settling"); assert.match(frozen.statusLabel, /frozen/); assert.deepEqual(frozen.participants!.map((p) => p.outstanding), ["96.00", "154.00", "0.00"]);
    await success(await pay(1, "payout", "96")); await success(await pay(2, "payout", "154")); await success(await settle(operation("close", { acknowledge: "close" })));
    const closed = await adminReport(); assert.equal(closed.status, "closed"); assert.ok(closed.participants!.every((p) => p.outstanding === "0.00")); assert.equal(closed.fund!.cash, "0.00");
    const roster = await success(await request("/api/admin/participation?year=1405&month=9", cookies[0]));
    const body = new URLSearchParams({ period: "140509", acknowledge: "confirm", revision: roster.revision }); ids.slice(1, 3).forEach((id) => body.append("participantId", String(id))); await success(await request("/api/admin/participation", cookies[0], body));
    await success(await expense(2, "999", "1405-09-01", "Following month only"), 201);
    assert.equal((await adminReport()).snapshot, closed.snapshot);
    const next = await adminReport("scope=room&year=1405&month=9"); assert.equal(next.expenses.length, 1); assert.equal(next.spending, "999.00"); assert.ok(next.expenses.every((e) => e.date === "1405-09-01"));
    assert.equal((await download(`${roomQuery}&snapshot=${closed.snapshot}`)).status, 200);
    const [rows] = await sql.query<RowDataPacket[]>("SELECT COUNT(*) AS value FROM rems_expenses WHERE period_key = 140508"); assert.equal(rows[0].value, 83);
  });
});
