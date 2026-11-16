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

const databaseName = `rems_test_${randomBytes(8).toString("hex")}`;
const cookies: string[] = [], ids: number[] = [], expenseIds: number[] = [];
let root: Connection, sql: Connection, server: ChildProcess | undefined;
let created = false, origin = "", output = "";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
before(async () => {
  root = await mysql.createConnection({ ...databaseConfig(), database: undefined });
  await root.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`); created = true;
  process.env.DB_NAME = databaseName; process.env.REMS_TEST_DATABASE = "1";
  await migrate(); await initializePeriod(1405, 8); sql = await mysql.createConnection(databaseConfig());
  const passwordHash = await hashPassword(randomBytes(6).toString("base64"));
  for (const [index, username] of ["admin.a", "roommate.b", "roommate.c", "roommate.d", "roommate.e"].entries()) {
    const [user] = await sql.execute<ResultSetHeader>("INSERT INTO rems_users (username, password_hash, role) VALUES (?, ?, ?)", [username, passwordHash, index === 0 ? "admin" : "roommate"]);
    ids.push(user.insertId); const token = randomBytes(32).toString("hex"); cookies.push(`rems_session=${token}`);
    await sql.execute("INSERT INTO rems_sessions (token_hash, user_id, expires_at) VALUES (?, ?, TIMESTAMPADD(DAY, 7, CURRENT_TIMESTAMP(3)))", [hash(token), user.insertId]);
  }
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as { port: number }).port; await new Promise<void>((resolve) => listener.close(() => resolve())); origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", APP_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout?.on("data", (value) => { output = (output + value).slice(-10000); }); server.stderr?.on("data", (value) => { output = (output + value).slice(-10000); });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Settlement test server exited: ${output}`);
    try { if ((await fetch(`${origin}/login`)).ok) return; } catch { /* Startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Settlement test server did not start: ${output}`);
}, { timeout: 60000 });
after(async () => {
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  await db().end(); await sql?.end();
  if (created) { assert.match(databaseName, /^rems_test_[a-f0-9]{16}$/); await root.query(`DROP DATABASE \`${databaseName}\``); } await root?.end();
});
function request(path: string, cookie?: string, body?: URLSearchParams, requestOrigin = origin) {
  return fetch(`${origin}${path}`, { redirect: "manual", method: body ? "POST" : "GET", headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin: requestOrigin } : {}) }, body });
}
const query = "year=1405&month=8";
function operation(action: string, values: Record<string, string> = {}) { return new URLSearchParams({ action, year: "1405", month: "8", requestKey: randomUUID(), ...values }); }
function pay(person: number, direction: string, amount: string) { return operation("payment", { userId: String(ids[person]), direction, amount, paymentDate: "1405-08-19", actualPayment: "confirm" }); }
function reverse(entryId: number, reason = "Incorrect entry; correction only") { return operation("reverse", { entryId: String(entryId), reason, acknowledge: "correction" }); }
const post = (body: URLSearchParams, cookie = cookies[0]) => request("/api/admin/settlements", cookie, body);
async function room() { const response = await request(`/api/admin/settlements?${query}`, cookies[0]); assert.equal(response.status, 200); return response.json(); }
async function scalar(query: string, values: (number | string)[] = []) { const [rows] = await sql.execute<RowDataPacket[]>(query, values); return rows[0].value; }
async function createExpense(person: number, amount: string, date = "1405-08-19") {
  return request("/api/expenses", cookies[person], new URLSearchParams({ amount, expenseDate: date, category: "Other", description: "Monthly shared expense", requestKey: randomUUID() }));
}

test("milestone 4: reviewed settlement fund, auditable corrections and validated closure", { timeout: 120000 }, async (t) => {
  let review = "", receiptB = 0, payoutA = 0;
  await t.test("unauthorized mutations, privacy boundaries and unconfirmed roster", async () => {
    assert.equal((await request("/api/settlements")).status, 401);
    assert.equal((await request("/api/admin/settlements")).status, 401);
    assert.equal((await post(operation("begin", { acknowledge: "begin" }), cookies[1])).status, 403);
    assert.equal((await request("/api/admin/settlements", cookies[0], operation("begin"), "https://attacker.invalid")).status, 403);
    assert.equal((await request("/admin/settlements", cookies[1])).status, 307);
    assert.equal((await request("/settlements")).status, 307);
    assert.equal((await room()).status, "unconfirmed");
    assert.equal((await post(operation("begin", { acknowledge: "begin", reviewDigest: "unconfirmed" }))).status, 409);
    for (const [index, amount] of ["2000", "1000", "500", "1000", "3000"].entries()) {
      const response = await createExpense(index, amount); assert.equal(response.status, 201); expenseIds.push((await response.json()).expense.id);
    }
    const roster = await (await request("/api/admin/participation", cookies[0])).json();
    const form = new URLSearchParams({ period: "140508", acknowledge: "confirm", revision: roster.revision }); ids.forEach((id) => form.append("participantId", String(id)));
    assert.equal((await request("/api/admin/participation", cookies[0], form)).status, 200);
    const initial = await room(); review = initial.reviewDigest;
    assert.equal(initial.status, "open"); assert.equal(initial.totals.spending, "7500.00");
    assert.deepEqual(initial.participants.map((p: { initialBalance: string }) => p.initialBalance), ["500.00", "-500.00", "-1000.00", "-500.00", "1500.00"]);
    assert.equal((await post(pay(1, "collection", "1"))).status, 409);
    assert.equal((await post(operation("close", { acknowledge: "close" }))).status, 409);
    const page = await request(`/admin/settlements?${query}`, cookies[0]); assert.match(await page.text(), /Begin monthly settlement/);
  });

  await t.test("begin is serialized with expense mutations and rejects stale reviewed data", async () => {
    await sql.beginTransaction();
    let finished = false; let pending: Promise<Response> | undefined;
    try {
      await sql.query("SELECT first_period FROM rems_accounting_state WHERE id = 1 FOR UPDATE");
      pending = post(operation("begin", { acknowledge: "begin", reviewDigest: review })); pending.then(() => { finished = true; });
      await new Promise((resolve) => setTimeout(resolve, 150)); assert.equal(finished, false);
      await sql.execute("UPDATE rems_expenses SET version = version + 1 WHERE id = ?", [expenseIds[0]]); await sql.commit();
      assert.equal((await pending).status, 409);
    } finally { await sql.rollback(); await pending; }
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_month_settlements"), 0);
    assert.equal(await scalar("SELECT status AS value FROM rems_accounting_periods WHERE period_key = 140508"), "open");
    review = (await room()).reviewDigest;
  });

  await t.test("freeze, initial balances, lifecycle transition and retry key commit atomically", async () => {
    const body = operation("begin", { acknowledge: "begin", reviewDigest: review });
    await sql.query("CREATE TRIGGER rems_test_balance_failure BEFORE INSERT ON rems_settlement_participants FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test freeze failure'");
    try {
      assert.equal((await post(body)).status, 503);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_allocation_freezes"), 0);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_month_settlements"), 0);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_settlement_requests"), 0);
      assert.equal(await scalar("SELECT status AS value FROM rems_accounting_periods WHERE period_key = 140508"), "open");
    } finally { await sql.query("DROP TRIGGER rems_test_balance_failure"); }
    const responses = await Promise.all([post(body), post(body)]);
    for (const response of responses) assert.equal(response.status, 200, `${await response.clone().text()} ${output}`);
    assert.deepEqual((await Promise.all(responses.map((r) => r.json()))).map((r) => r.replayed).sort(), [false, true]);
    assert.equal((await post(operation("begin", { acknowledge: "begin", reviewDigest: review }))).status, 200);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_allocation_freezes"), 1);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_finalized_expenses"), 5);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_settlement_participants"), 5);
    assert.equal((await room()).status, "settling");
  });

  await t.test("signed debtor snapshots retain exact equations while expense and payment amounts stay positive", async () => {
    const [balances] = await sql.query<RowDataPacket[]>(
      "SELECT CAST(initial_minor AS CHAR) AS initial_balance FROM rems_settlement_participants WHERE period_key = 140508 ORDER BY user_id",
    );
    assert.deepEqual(balances.map((row) => row.initial_balance), ["50000", "-50000", "-100000", "-50000", "150000"]);
    const rejectsConstraint = (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "ER_CHECK_CONSTRAINT_VIOLATED");
    await assert.rejects(
      sql.execute("UPDATE rems_settlement_participants SET initial_minor = -49999 WHERE period_key = 140508 AND user_id = ?", [ids[1]]),
      rejectsConstraint,
    );
    for (const amount of ["0.00", "-0.01"]) {
      await assert.rejects(sql.execute("UPDATE rems_expenses SET amount = ? WHERE id = ?", [amount, expenseIds[0]]), rejectsConstraint);
      await assert.rejects(sql.execute(
        "INSERT INTO rems_settlement_ledger (period_key, user_id, direction, entry_kind, amount, payment_date, recorded_by) VALUES (140508, ?, 'collection', 'payment', ?, '1405-08-19', ?)",
        [ids[1], amount, ids[0]],
      ), rejectsConstraint);
      assert.equal((await post(pay(1, "collection", amount))).status, 400);
    }
    assert.equal(await scalar("SELECT initial_minor AS value FROM rems_settlement_participants WHERE period_key = 140508 AND user_id = ?", [ids[1]]), "-50000");
    assert.equal(await scalar("SELECT amount AS value FROM rems_expenses WHERE id = ?", [expenseIds[0]]), "2000.00");
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_settlement_ledger"), 0);
  });

  await t.test("settling freezes expenses and roster and rejects premature closure", async () => {
    assert.equal((await createExpense(0, "1")).status, 409);
    const update = new URLSearchParams({ action: "update", version: "2", amount: "2100", expenseDate: "1405-08-19", category: "Other", requestKey: randomUUID() });
    assert.equal((await request(`/api/expenses/${expenseIds[0]}`, cookies[0], update)).status, 409);
    assert.equal((await request(`/api/expenses/${expenseIds[0]}`, cookies[0], new URLSearchParams({ action: "delete", version: "2", requestKey: randomUUID() }))).status, 409);
    const change = new URLSearchParams({ period: "140508", acknowledge: "confirm", revision: "ignored", participantId: String(ids[0]) });
    assert.equal((await request("/api/admin/participation", cookies[0], change)).status, 409);
    assert.equal((await createExpense(0, "1", "1405-09-01")).status, 409);
    assert.equal((await post(operation("close", { acknowledge: "close" }))).status, 409);
    assert.equal((await post(operation("force-close", { acknowledge: "close" }))).status, 400);
  });

  await t.test("partial receipt retries record once; invalid direction, overpayment and cash shortages fail", async () => {
    const body = pay(1, "collection", "200.00");
    await sql.query("CREATE TRIGGER rems_test_retry_failure BEFORE INSERT ON rems_settlement_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test retry persistence failure'");
    try {
      assert.equal((await post(body)).status, 503);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_settlement_ledger"), 0);
    } finally { await sql.query("DROP TRIGGER rems_test_retry_failure"); }
    const results = await Promise.all([post(body), post(body)]); assert.ok(results.every((r) => r.status === 200));
    const records = await Promise.all(results.map((r) => r.json())); receiptB = records[0].entryId; assert.equal(records[1].entryId, receiptB);
    const view = await room(); assert.equal(view.participants[1].outstanding, "-300.00"); assert.equal(view.totals.cash, "200.00");
    body.set("amount", "201"); assert.equal((await post(body)).status, 409);
    for (const entry of [pay(1, "collection", "301"), pay(1, "payout", "1"), pay(0, "collection", "1"), pay(0, "payout", "501"), pay(0, "payout", "201")]) assert.equal((await post(entry)).status, 409);
    const invalid = pay(1, "collection", "1"); invalid.delete("actualPayment"); assert.equal((await post(invalid)).status, 400);
    invalid.set("actualPayment", "confirm"); invalid.set("amount", "0.001"); assert.equal((await post(invalid)).status, 400);
    invalid.set("amount", "1"); invalid.set("paymentDate", "1404-12-30"); assert.equal((await post(invalid)).status, 400);
    invalid.set("paymentDate", "1406-01-01"); assert.equal((await post(invalid)).status, 400);
    payoutA = (await (await post(pay(0, "payout", "100"))).json()).entryId;
    assert.equal((await room()).totals.cash, "100.00");
    assert.equal((await room()).totals.spending, "7500.00");
  });

  await t.test("reason-required linked reversals preserve originals and reject duplicate or cash-invalid corrections", async () => {
    assert.equal((await post(reverse(receiptB, ""))).status, 400);
    assert.equal((await post(reverse(receiptB))).status, 409); // Funds already used by A's payout.
    const original = await scalar("SELECT amount AS value FROM rems_settlement_ledger WHERE id = ?", [payoutA]);
    const body = reverse(payoutA); const result = await post(body); assert.equal(result.status, 200);
    const reversalId = (await result.json()).entryId;
    assert.equal((await post(body)).status, 200);
    assert.equal((await post(reverse(payoutA))).status, 409);
    assert.equal((await post(reverse(reversalId))).status, 404);
    assert.equal(await scalar("SELECT amount AS value FROM rems_settlement_ledger WHERE id = ?", [payoutA]), original);
    assert.equal(await scalar("SELECT reversal_of AS value FROM rems_settlement_ledger WHERE id = ?", [reversalId]), payoutA);
    assert.equal((await room()).totals.cash, "200.00");
    assert.equal((await post(reverse(receiptB))).status, 200);
    const corrected = await room(); assert.equal(corrected.totals.cash, "0.00"); assert.equal(corrected.participants[1].outstanding, "-500.00");
    assert.equal(corrected.history.length, 4);
  });

  await t.test("distinct concurrent collection requests cannot overcollect a participant", async () => {
    const results = await Promise.all([post(pay(1, "collection", "300")), post(pay(1, "collection", "300"))]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await room()).participants[1].outstanding, "-200.00");
    assert.equal((await post(pay(1, "collection", "200"))).status, 200);
    assert.equal((await post(pay(2, "collection", "600"))).status, 200);
    assert.equal((await post(pay(2, "collection", "400"))).status, 200);
    assert.equal((await post(pay(3, "collection", "500"))).status, 200);
    const view = await room(); assert.equal(view.totals.cash, "2000.00"); assert.equal(view.totals.remainingToCollect, "0.00");
  });

  await t.test("the admin's reimbursement and concurrent payouts obey the same fund rules", async () => {
    assert.equal((await post(pay(0, "payout", "500"))).status, 200);
    const first = pay(4, "payout", "1500"), second = pay(4, "payout", "1500");
    const results = await Promise.all([post(first), post(second)]); assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await post(results[0].status === 200 ? first : second)).status, 200);
    const final = await room(); assert.ok(final.participants.every((p: { outstanding: string }) => p.outstanding === "0.00"));
    assert.equal(final.totals.cash, "0.00"); assert.equal(final.totals.collections, "2000.00"); assert.equal(final.totals.payouts, "2000.00");
    assert.equal(final.totals.spending, "7500.00"); assert.equal(final.totals.allocatedShare, "7500.00");
  });

  await t.test("personal responses expose only the session user's own balances and payment history", async () => {
    const response = await request(`/api/settlements?${query}&userId=${ids[4]}&room=true`, cookies[1]); assert.equal(response.status, 200);
    const value = await response.json(); assert.equal(value.personal.userId, ids[1]); assert.equal(value.personal.outstanding, "0.00");
    assert.equal(value.participants, undefined); assert.equal(value.totals, undefined); assert.equal(value.reviewDigest, undefined);
    assert.ok(value.history.every((entry: { userId: number }) => entry.userId === ids[1]));
    assert.doesNotMatch(JSON.stringify(value), /roommate.e|admin.a/);
    const page = await request(`/settlements?${query}`, cookies[1]); const html = await page.text();
    assert.match(html, /My settlements/); assert.match(html, /Kabul/); assert.match(html, /Aqrab/); assert.doesNotMatch(html, /roommate.e/);
    const admin = await request(`/admin/settlements?${query}`, cookies[0]); assert.match(await admin.text(), /Validate and close month/);
    assert.equal((await fetch(`${origin}/api/admin/settlements`, { method: "DELETE", headers: { cookie: cookies[0], origin } })).status, 405);
  });

  await t.test("closure revalidates frozen balances and the ledger and rolls back if next-month activation fails", async () => {
    await sql.execute("UPDATE rems_settlement_participants SET spending_minor = spending_minor + 1, initial_minor = initial_minor + 1 WHERE period_key = 140508 AND user_id = ?", [ids[0]]);
    assert.equal((await post(operation("close", { acknowledge: "close" }))).status, 409);
    await sql.execute("UPDATE rems_settlement_participants SET spending_minor = spending_minor - 1, initial_minor = initial_minor - 1 WHERE period_key = 140508 AND user_id = ?", [ids[0]]);
    await sql.execute("UPDATE rems_settlement_ledger SET amount = 199 WHERE id = ?", [receiptB]);
    assert.equal((await post(operation("close", { acknowledge: "close" }))).status, 409);
    await sql.execute("UPDATE rems_settlement_ledger SET amount = 200 WHERE id = ?", [receiptB]);
    await sql.query("CREATE TRIGGER rems_test_next_failure BEFORE INSERT ON rems_accounting_periods FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test activation failure'");
    try {
      assert.equal((await post(operation("close", { acknowledge: "close" }))).status, 503);
      assert.equal(await scalar("SELECT status AS value FROM rems_accounting_periods WHERE period_key = 140508"), "settling");
      assert.equal(await scalar("SELECT closed_at AS value FROM rems_month_settlements WHERE period_key = 140508"), null);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_accounting_periods WHERE period_key = 140509"), 0);
    } finally { await sql.query("DROP TRIGGER rems_test_next_failure"); }
  });

  await t.test("closure is atomic and idempotent and closed records cannot be mutated", async () => {
    const body = operation("close", { acknowledge: "close" });
    const results = await Promise.all([post(body), post(body), post(pay(1, "collection", "0.01"))]);
    assert.deepEqual(results.map((r) => r.status), [200, 200, 409]);
    assert.equal((await results[0].json()).nextPeriod, 140509);
    const closedAt = await scalar("SELECT closed_at AS value FROM rems_month_settlements WHERE period_key = 140508"); assert.ok(closedAt);
    assert.equal((await post(operation("close", { acknowledge: "close" }))).status, 200);
    assert.equal(await scalar("SELECT closed_at AS value FROM rems_month_settlements WHERE period_key = 140508"), closedAt);
    assert.equal((await post(reverse(payoutA))).status, 409);
    assert.equal((await createExpense(0, "1")).status, 409);
    assert.equal((await room()).status, "closed");
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_accounting_periods WHERE period_key = 140509"), 1);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_accounting_periods WHERE period_key = 140510"), 0);
    assert.equal(followingPeriod(140512), 140601);
  });

  await t.test("next month requires explicit unchanged participation and starts with no carried settlement cash", async () => {
    assert.equal((await createExpense(0, "1", "1405-09-01")).status, 409);
    assert.equal((await createExpense(0, "1", "1405-10-01")).status, 409);
    const before = await request("/api/admin/settlements?year=1405&month=9", cookies[0]); assert.equal((await before.json()).status, "unconfirmed");
    const roster = await (await request("/api/admin/participation?year=1405&month=9", cookies[0])).json();
    const form = new URLSearchParams({ period: "140509", acknowledge: "confirm", revision: roster.revision });
    ids.slice(0, 4).forEach((id) => form.append("participantId", String(id)));
    assert.equal((await request("/api/admin/participation", cookies[0], form)).status, 409);
    form.append("participantId", String(ids[4])); assert.equal((await request("/api/admin/participation", cookies[0], form)).status, 200);
    const next = await (await request("/api/admin/settlements?year=1405&month=9", cookies[0])).json();
    assert.equal(next.status, "open"); assert.equal(next.totals.cash, "0.00"); assert.equal(next.totals.spending, "0.00");
    assert.ok(next.participants.every((p: { outstanding: string }) => p.outstanding === "0.00"));
    assert.equal((await createExpense(0, "10", "1405-09-01")).status, 201);
    assert.equal((await room()).totals.spending, "7500.00"); assert.equal((await room()).totals.cash, "0.00");
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_participation_rosters"), 2);
  });

  await t.test("admin contributions, concurrent cash-limited payouts and the final-payment/closure race reconcile", async () => {
    // In Qaws A spent 10, B spends 90: each share is 20; admin A owes 10.
    assert.equal((await createExpense(1, "90", "1405-09-01")).status, 201);
    const nextView = async () => {
      const response = await request("/api/admin/settlements?year=1405&month=9", cookies[0]);
      assert.equal(response.status, 200); return response.json();
    };
    const review = await nextView();
    assert.equal(review.participants[0].initialBalance, "-10.00");
    assert.equal((await post(operation("begin", { month: "9", acknowledge: "begin", reviewDigest: review.reviewDigest }))).status, 200);
    const nextPay = (person: number, direction: string, amount: string) => { const form = pay(person, direction, amount); form.set("month", "9"); return form; };
    assert.equal((await post(nextPay(0, "collection", "10"))).status, 200);
    assert.equal((await nextView()).participants[0].outstanding, "0.00");
    const concurrent = await Promise.all([post(nextPay(1, "payout", "10")), post(nextPay(1, "payout", "10"))]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await nextView()).totals.cash, "0.00");
    for (const person of [2, 3, 4]) assert.equal((await post(nextPay(person, "collection", "20"))).status, 200);
    const close = operation("close", { month: "9", acknowledge: "close" });
    const race = await Promise.all([post(close), post(nextPay(1, "payout", "60"))]);
    assert.ok([200, 409].includes(race[0].status)); assert.equal(race[1].status, 200);
    assert.equal((await post(close)).status, 200);
    const final = await nextView(); assert.equal(final.status, "closed"); assert.equal(final.totals.cash, "0.00");
    assert.ok(final.participants.every((p: { outstanding: string }) => p.outstanding === "0.00"));
    assert.equal(await scalar("SELECT status AS value FROM rems_accounting_periods WHERE period_key = 140510"), "open");
  });
});
