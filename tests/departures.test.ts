import "../scripts/env";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import mysql, { type Connection, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { databaseConfig, db } from "../src/server/database";
import { hashPassword } from "../src/server/password";
import { initializePeriod, followingPeriod } from "../src/server/periods";
import { migrate } from "../scripts/migrations";
import { dateString, todayShamsi } from "../src/lib/shamsi";
import { checkedAllocations, loadAllocationData } from "../src/server/allocation-data";

const databaseName = `rems_test_${randomBytes(8).toString("hex")}`;
const cookies: string[] = [], ids: number[] = [], expenses: number[] = [];
const password = randomBytes(6).toString("base64");
let root: Connection, sql: Connection, server: ChildProcess | undefined;
let created = false, origin = "", output = "", key = 140508;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
before(async () => {
  root = await mysql.createConnection({ ...databaseConfig(), database: undefined });
  await root.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`); created = true;
  process.env.DB_NAME = databaseName; process.env.REMS_TEST_DATABASE = "1";
  await migrate(); await initializePeriod(1405, 8); sql = await mysql.createConnection(databaseConfig());
  const passwordHash = await hashPassword(password);
  for (let i = 0; i < 6; i++) {
    const [user] = await sql.execute<ResultSetHeader>("INSERT INTO rems_users (username, password_hash, role) VALUES (?, ?, ?)", [i ? `roommate.${i}` : "admin", passwordHash, i ? "roommate" : "admin"]);
    ids.push(user.insertId); const token = randomBytes(32).toString("hex"); cookies.push(`rems_session=${token}`);
    await sql.execute("INSERT INTO rems_sessions (token_hash, user_id, expires_at) VALUES (?, ?, TIMESTAMPADD(DAY, 7, CURRENT_TIMESTAMP(3)))", [hash(token), user.insertId]);
  }
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as { port: number }).port; await new Promise<void>((resolve) => listener.close(() => resolve())); origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", APP_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout?.on("data", (value) => { output = (output + value).slice(-10000); }); server.stderr?.on("data", (value) => { output = (output + value).slice(-10000); });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Departure test server exited: ${output}`);
    try { if ((await request("/login")).ok) return; } catch { /* Startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Departure test server did not start: ${output}`);
}, { timeout: 60000 });
after(async () => {
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  await db().end(); await sql?.end();
  if (created) { assert.match(databaseName, /^rems_test_[a-f0-9]{16}$/); await root.query(`DROP DATABASE \`${databaseName}\``); } await root?.end();
});
function request(path: string, cookie?: string, body?: URLSearchParams) {
  return fetch(`${origin}${path}`, { redirect: "manual", method: body ? "POST" : "GET", headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin } : {}) }, body });
}
async function success(response: Response, status = 200) {
  assert.equal(response.status, status, await response.clone().text()); return response.json();
}
const month = () => `year=${Math.floor(key / 100)}&month=${key % 100}`;
const operation = (action: string, values: Record<string, string> = {}) => new URLSearchParams({ action, year: String(Math.floor(key / 100)), month: String(key % 100), requestKey: randomUUID(), ...values });
const settlement = (body: URLSearchParams) => request("/api/admin/settlements", cookies[0], body);
const room = async () => success(await request(`/api/admin/settlements?${month()}`, cookies[0]));
const pay = (person: number, direction: string, amount: string) => settlement(operation("payment", { userId: String(ids[person]), direction, amount, paymentDate: dateString(todayShamsi()), actualPayment: "confirm" }));
const depart = (body: URLSearchParams, cookie = cookies[0]) => request("/api/admin/departures", cookie, body);
const review = (person = 1, date = "1406-01-20") => request(`/api/admin/departures?userId=${ids[person]}&leavesOn=${date}`, cookies[0]);
const finalize = (value: { userId: number; leavesOn: string; reviewDigest: string }) => operation("finalize", { userId: String(value.userId), leavesOn: value.leavesOn, reviewDigest: value.reviewDigest, expensesComplete: "confirm" });
const deactivate = (person = 1) => operation("deactivate", { userId: String(ids[person]), acknowledge: "deactivate" });
async function scalar(query: string, values: (number | string)[] = []) { const [rows] = await sql.execute<RowDataPacket[]>(query, values); return rows[0].value; }
async function expense(person: number, amount: string, date = "1406-01-20") {
  return request("/api/expenses", cookies[person], new URLSearchParams({ amount, expenseDate: date, category: "Other", description: "Shared expense", requestKey: randomUUID() }));
}
async function confirmRoster() {
  const roster = await success(await request(`/api/admin/participation?${month()}`, cookies[0]));
  const form = new URLSearchParams({ period: String(key), acknowledge: "confirm", revision: roster.revision });
  for (const id of ids.slice(1)) form.append("participantId", String(id));
  await success(await request("/api/admin/participation", cookies[0], form));
}
async function begin() { await success(await settlement(operation("begin", { acknowledge: "begin", reviewDigest: (await room()).reviewDigest }))); }
const close = () => settlement(operation("close", { acknowledge: "close" }));
async function allocations() {
  const connection = await db().getConnection();
  try { return checkedAllocations(await loadAllocationData(connection, key)); }
  finally { connection.release(); }
}

test("milestone 5: inclusive departures, one room fund, account revocation and later closure", { timeout: 120000 }, async (t) => {
  let cutoffReview: Awaited<ReturnType<typeof success>>, frozenBefore = "", payout = 0, priorPayout = 0;
  await t.test("admin authorization and explicit, genuinely closed prior-month history", async () => {
    assert.equal((await request("/api/admin/departures")).status, 401);
    assert.equal((await request("/api/admin/departures", cookies[1])).status, 403);
    assert.equal((await depart(deactivate(), cookies[1])).status, 403);
    assert.equal((await request("/admin/departures", cookies[1])).status, 307);
    assert.equal((await depart(deactivate(0))).status, 409);
    await confirmRoster();
    await success(await expense(1, "500", "1405-08-19"), 201); await begin();
    for (let person = 2; person <= 5; person++) await success(await pay(person, "collection", "100"));
    priorPayout = (await success(await pay(1, "payout", "400"))).entryId;
    await success(await close()); key = followingPeriod(key);
    while (key !== 140601) { await confirmRoster(); await begin(); await success(await close()); key = followingPeriod(key); }
    await confirmRoster();
    for (const [index, amount] of ["2000", "1000", "500", "1000", "3000"].entries()) expenses.push((await success(await expense(index + 1, amount), 201)).expense.id);
    assert.equal((await room()).totals.spending, "7500.00");
    assert.equal((await depart(deactivate())).status, 409);
  });

  await t.test("Shamsi/date conflicts and later own expenses require explicit resolution", async () => {
    assert.equal((await review(1, "1405-08-19")).status, 409);
    assert.equal((await review(1, "1405-12-30")).status, 400);
    const later = await success(await expense(1, "10", "1406-01-21"), 201);
    const conflict = await review(); assert.equal(conflict.status, 409); assert.match(await conflict.text(), /after the leaving date/);
    await success(await request(`/api/expenses/${later.expense.id}`, cookies[1], new URLSearchParams({ action: "delete", version: "1", requestKey: randomUUID() })));
    cutoffReview = await success(await review());
    assert.equal(cutoffReview.person.spending, "2000.00"); assert.equal(cutoffReview.person.allocatedShare, "1500.00"); assert.equal(cutoffReview.person.outstanding, "500.00");
    assert.equal(cutoffReview.expenseCount, 5); assert.ok(cutoffReview.priorObligations.every((p: { verified: boolean; outstanding: string }) => p.verified && p.outstanding === "0.00"));
    const noAck = finalize(cutoffReview); noAck.delete("expensesComplete"); assert.equal((await depart(noAck)).status, 400);
    assert.match(await (await request(`/admin/departures?userId=${ids[1]}&leavesOn=1406-01-20`, cookies[0])).text(), /1500|1,500/);
  });

  await t.test("finalization waits for expense transactions and rejects a stale review", async () => {
    await sql.beginTransaction(); let completed = false; let pending: Promise<Response> | undefined;
    try {
      await sql.query("SELECT first_period FROM rems_accounting_state WHERE id = 1 FOR UPDATE");
      pending = depart(finalize(cutoffReview)); pending.then(() => { completed = true; });
      await new Promise((resolve) => setTimeout(resolve, 150)); assert.equal(completed, false);
      await sql.execute("UPDATE rems_expenses SET version = version + 1 WHERE id = ?", [expenses[0]]); await sql.commit();
      assert.equal((await pending).status, 409);
    } finally { await sql.rollback(); await pending; }
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_departures"), 0);
    cutoffReview = await success(await review());
  });

  await t.test("atomic cutoff/audit/retry rollback and concurrent duplicate confirmation", async () => {
    const body = finalize(cutoffReview);
    await sql.query("CREATE TRIGGER rems_test_departure_failure BEFORE INSERT ON rems_departures FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test departure failure'");
    try {
      assert.equal((await depart(body)).status, 503);
      assert.equal(await scalar("SELECT leaves_on AS value FROM rems_memberships WHERE user_id = ?", [ids[1]]), null);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_allocation_freezes WHERE period_key = 140601"), 0);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_cutoff_balances"), 0);
    } finally { await sql.query("DROP TRIGGER rems_test_departure_failure"); }
    const results = await Promise.all([depart(body), depart(body)]);
    const values = await Promise.all(results.map((r) => success(r))); assert.deepEqual(values.map((r) => r.replayed).sort(), [false, true]);
    await success(await depart(finalize(cutoffReview)));
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_departures"), 1);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_cutoff_balances"), 5);
    assert.equal(await scalar("SELECT deactivated_at AS value FROM rems_users WHERE id = ?", [ids[1]]), null);
    assert.equal((await room()).status, "open"); assert.equal((await room()).history.length, 0);
    const [rows] = await sql.query("SELECT * FROM rems_finalized_shares WHERE expense_id IN (SELECT id FROM rems_expenses WHERE period_key = 140601) ORDER BY expense_id, user_id"); frozenBefore = JSON.stringify(rows);
  });

  await t.test("inclusive frozen cutoff blocks backdated writes while four roommates continue", async () => {
    for (const date of ["1406-01-19", "1406-01-20"]) assert.equal((await expense(2, "1", date)).status, 409);
    assert.equal((await request(`/api/expenses/${expenses[0]}`, cookies[1], new URLSearchParams({ action: "delete", version: "2", requestKey: randomUUID() }))).status, 409);
    assert.equal((await request(`/api/expenses/${expenses[1]}`, cookies[2], new URLSearchParams({ action: "update", version: "1", amount: "1001", expenseDate: "1406-01-21", category: "Other", requestKey: randomUUID() }))).status, 409);
    assert.equal((await expense(1, "1", "1406-01-21")).status, 409);
    const later = await success(await expense(4, "1000", "1406-01-21"), 201); expenses.push(later.expense.id);
    const view = await room(); assert.equal(view.reviewThrough, "1406-01-20"); assert.equal(view.totals.spending, "7500.00"); assert.equal(view.monthEndReview.totals.spending, "8500.00");
    assert.deepEqual(view.monthEndReview.participants.map((p: { allocatedShare: string }) => p.allocatedShare), ["1500.00", "1750.00", "1750.00", "1750.00", "1750.00"]);
    const balance = await allocations();
    const allocation = balance.allocations.find((a: { expenseId: number }) => a.expenseId === later.expense.id);
    assert.deepEqual(allocation.shares.map((s: { minor: string }) => s.minor), ["25000", "25000", "25000", "25000"]);
    const [rows] = await sql.query("SELECT * FROM rems_finalized_shares WHERE expense_id IN (SELECT id FROM rems_expenses WHERE period_key = 140601) ORDER BY expense_id, user_id"); assert.equal(JSON.stringify(rows), frozenBefore);
    assert.equal((await review(2, "1406-01-19")).status, 409);
    assert.equal((await review(1, "1406-01-21")).status, 409);
  });

  await t.test("partial actual payments, funding limits, privacy and concurrent payout protection", async () => {
    assert.equal((await pay(1, "payout", "500")).status, 409);
    assert.equal((await depart(deactivate())).status, 409);
    await success(await pay(3, "collection", "1000"));
    assert.equal((await pay(3, "collection", "0.01")).status, 409);
    assert.equal((await pay(1, "collection", "1")).status, 409);
    payout = (await success(await pay(1, "payout", "200"))).entryId;
    assert.equal((await depart(deactivate())).status, 409);
    const amounts = await Promise.all([pay(1, "payout", "300"), pay(1, "payout", "300")]); assert.deepEqual(amounts.map((r) => r.status).sort(), [200, 409]);
    const view = await room(); assert.equal(view.participants[0].outstanding, "0.00"); assert.equal(view.totals.cash, "500.00");
    const privateView = await success(await request(`/api/settlements?${month()}&userId=${ids[3]}`, cookies[1]));
    assert.equal(privateView.personal.userId, ids[1]); assert.equal(privateView.participants, undefined); assert.equal(privateView.totals, undefined); assert.equal(privateView.monthEndReview, undefined);
    assert.ok(privateView.history.every((e: { userId: number }) => e.userId === ids[1]));
    assert.equal((await settlement(operation("reverse", { entryId: String(payout), reason: "Correction", acknowledge: "correction" }))).status, 409);
  });

  await t.test("prior-month obligations block deactivation; ordinary reversals cannot reopen departed balances", async () => {
    const [headers] = await sql.query<RowDataPacket[]>("SELECT closed_at, closed_by FROM rems_month_settlements WHERE period_key = 140508");
    const [reversal] = await sql.execute<ResultSetHeader>("INSERT INTO rems_settlement_ledger (period_key,user_id,direction,entry_kind,amount,payment_date,note,reversal_of,recorded_by,basis_freeze_id) SELECT period_key,user_id,direction,'reversal',amount,payment_date,'Isolated prior obligation fixture',id,recorded_by,basis_freeze_id FROM rems_settlement_ledger WHERE id = ?", [priorPayout]);
    try {
      await sql.query("UPDATE rems_accounting_periods SET status = 'settling' WHERE period_key = 140508");
      await sql.query("UPDATE rems_month_settlements SET closed_at = NULL, closed_by = NULL WHERE period_key = 140508");
      const blocked = await depart(deactivate()); assert.equal(blocked.status, 409); assert.match(await blocked.text(), /earlier|Earlier/);
      const priorKey = key; key = 140508;
      try { assert.equal((await settlement(operation("reverse", { entryId: String(priorPayout), reason: "Correction", acknowledge: "correction" }))).status, 409); }
      finally { key = priorKey; }
    } finally {
      await sql.execute("DELETE FROM rems_settlement_ledger WHERE id = ?", [reversal.insertId]);
      await sql.query("UPDATE rems_accounting_periods SET status = 'closed' WHERE period_key = 140508");
      await sql.execute("UPDATE rems_month_settlements SET closed_at = ?, closed_by = ? WHERE period_key = 140508", [headers[0].closed_at, headers[0].closed_by]);
    }
  });

  await t.test("deactivation rollback, concurrent retries and revocation of every session", async () => {
    const extra: string[] = [];
    for (let i = 0; i < 2; i++) { const token = randomBytes(32).toString("hex"); extra.push(`rems_session=${token}`); await sql.execute("INSERT INTO rems_sessions (token_hash,user_id,expires_at) VALUES (?,?,TIMESTAMPADD(DAY,7,CURRENT_TIMESTAMP(3)))", [hash(token), ids[1]]); }
    const body = deactivate();
    await sql.query("CREATE TRIGGER rems_test_deactivation_failure BEFORE INSERT ON rems_settlement_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test deactivation failure'");
    try {
      assert.equal((await depart(body)).status, 503);
      assert.equal(await scalar("SELECT deactivated_at AS value FROM rems_users WHERE id = ?", [ids[1]]), null);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_sessions WHERE user_id = ?", [ids[1]]), 3);
    } finally { await sql.query("DROP TRIGGER rems_test_deactivation_failure"); }
    const count = (await room()).history.length;
    // Hold the user row while deactivation and a password login race for it.
    // Either login ordering must leave no usable session after deactivation.
    await sql.beginTransaction();
    let responses: Response[], loginRace: Response;
    try {
      await sql.execute("SELECT id FROM rems_users WHERE id = ? FOR UPDATE", [ids[1]]);
      let completed = false;
      const first = depart(body); first.then(() => { completed = true; });
      await new Promise((resolve) => setTimeout(resolve, 150)); assert.equal(completed, false);
      const second = depart(body);
      const login = request("/api/auth/login", undefined, new URLSearchParams({ username: "roommate.1", password }));
      await new Promise((resolve) => setTimeout(resolve, 500)); await sql.commit();
      responses = await Promise.all([first, second]); loginRace = await login;
    } finally { await sql.rollback(); }
    const results = await Promise.all(responses.map((r) => success(r))); assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
    const raceCookie = loginRace.headers.get("set-cookie")?.split(";")[0];
    if (raceCookie) assert.equal((await request("/api/settlements", raceCookie)).status, 401);
    const timestamp = await scalar("SELECT deactivated_at AS value FROM rems_users WHERE id = ?", [ids[1]]);
    await success(await depart(deactivate())); assert.equal(await scalar("SELECT deactivated_at AS value FROM rems_users WHERE id = ?", [ids[1]]), timestamp);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_sessions WHERE user_id = ?", [ids[1]]), 0);
    for (const cookie of [cookies[1], ...extra]) { assert.equal((await request("/api/settlements", cookie)).status, 401); assert.equal((await request("/expenses", cookie)).status, 307); }
    const login = await request("/api/auth/login", undefined, new URLSearchParams({ username: "roommate.1", password })); assert.equal(login.status, 303); assert.equal(new URL(login.headers.get("location")!).pathname, "/login"); assert.equal(login.headers.get("set-cookie"), null); assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_sessions WHERE user_id = ?", [ids[1]]), 0);
    assert.equal((await room()).history.length, count); assert.equal((await room()).totals.cash, "500.00");
    assert.equal((await success(await review())).deactivated, true);
  });

  await t.test("second departing debtor, partial collection, persistent retry and later three-way allocations", async () => {
    let next = await success(await review(2, "1406-01-22")); assert.equal(next.person.initialBalance, "-750.00");
    await success(await pay(2, "collection", "300"));
    assert.equal((await depart(finalize(next))).status, 409); // Payment changed after review.
    next = await success(await review(2, "1406-01-22")); assert.equal(next.person.outstanding, "-450.00");
    await success(await depart(finalize(next))); assert.equal((await depart(deactivate(2))).status, 409);
    const payment = operation("payment", { userId: String(ids[2]), direction: "collection", amount: "450", paymentDate: dateString(todayShamsi()), actualPayment: "confirm" });
    const receipts = await Promise.all([settlement(payment), settlement(payment)]); const results = await Promise.all(receipts.map((r) => success(r))); assert.equal(results[0].entryId, results[1].entryId);
    payment.set("amount", "451"); assert.equal((await settlement(payment)).status, 409);
    await success(await depart(deactivate(2)));
    assert.equal((await room()).totals.cash, "1250.00");
    const later = await success(await expense(4, "900", "1406-01-23"), 201);
    const balances = await allocations();
    assert.deepEqual(balances.allocations.find((a: { expenseId: number }) => a.expenseId === later.expense.id).shares.map((s: { minor: string }) => s.minor), ["30000", "30000", "30000"]);
    const view = await room(); assert.deepEqual(view.monthEndReview.participants.slice(0, 2).map((p: { outstanding: string }) => p.outstanding), ["0.00", "0.00"]);
    assert.deepEqual(view.monthEndReview.participants.map((p: { allocatedShare: string }) => p.allocatedShare), ["1500.00", "1750.00", "2050.00", "2050.00", "2050.00"]);
    assert.equal((await expense(3, "1", "1406-01-22")).status, 409);
  });

  await t.test("month-end incorporates departure payments once, validates closure and reconfirms remaining residents", async () => {
    const count = (await room()).history.length; await begin(); const view = await room();
    assert.equal(view.status, "settling"); assert.equal(view.history.length, count);
    assert.deepEqual(view.participants.map((p: { outstanding: string }) => p.outstanding), ["0.00", "0.00", "-550.00", "850.00", "950.00"]);
    assert.equal(view.totals.cash, "1250.00"); assert.equal((await close()).status, 409);
    await success(await pay(3, "collection", "550")); await success(await pay(4, "payout", "850")); await success(await pay(5, "payout", "950"));
    const settled = await room(); assert.equal(settled.totals.cash, "0.00"); assert.ok(settled.participants.every((p: { outstanding: string }) => p.outstanding === "0.00"));
    await success(await close()); await success(await close()); assert.equal((await pay(3, "collection", "1")).status, 409);
    const old = key; key = followingPeriod(key);
    const roster = await success(await request(`/api/admin/participation?${month()}`, cookies[0])); assert.deepEqual(roster.candidates.map((p: { id: number }) => p.id), ids.slice(3));
    const body = new URLSearchParams({ period: String(key), acknowledge: "confirm", revision: roster.revision }); ids.slice(3).forEach((id) => body.append("participantId", String(id)));
    await success(await request("/api/admin/participation", cookies[0], body)); assert.equal((await room()).totals.spending, "0.00");
    key = old;
    const [rows] = await sql.query("SELECT * FROM rems_finalized_shares WHERE expense_id IN (SELECT id FROM rems_expenses WHERE period_key = 140601 AND expense_date <= '1406-01-20') ORDER BY expense_id, user_id"); assert.equal(JSON.stringify(rows), frozenBefore);
    assert.equal((await request("/admin/departures", cookies[0])).status, 200);
  });
});
