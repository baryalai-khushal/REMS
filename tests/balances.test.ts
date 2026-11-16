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
import { initializePeriod } from "../src/server/periods";
import { migrate } from "../scripts/migrations";
import { ALLOCATION_VERSION, calculateAllocations } from "../src/server/allocation-engine";

const databaseName = `rems_test_${randomBytes(8).toString("hex")}`;
const cookies: string[] = [];
const ids: number[] = [];
const expenseIds: number[] = [];
let root: Connection, sql: Connection, server: ChildProcess | undefined;
let created = false, origin = "", output = "";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

before(async () => {
  root = await mysql.createConnection({ ...databaseConfig(), database: undefined });
  await root.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`);
  created = true;
  process.env.DB_NAME = databaseName; process.env.REMS_TEST_DATABASE = "1";
  await migrate();
  await initializePeriod(1405, 8);
  sql = await mysql.createConnection(databaseConfig());
  const passwordHash = await hashPassword(randomBytes(6).toString("base64"));
  for (const [index, username] of ["alpha.owner", "beta.owner", "gamma.zero", "delta.owner", "epsilon.owner"].entries()) {
    const [result] = await sql.execute<ResultSetHeader>("INSERT INTO rems_users (username, password_hash, role) VALUES (?, ?, ?)", [username, passwordHash, index === 0 ? "admin" : "roommate"]);
    ids.push(result.insertId);
    const token = randomBytes(32).toString("hex");
    await sql.execute("INSERT INTO rems_sessions (token_hash, user_id, expires_at) VALUES (?, ?, TIMESTAMPADD(DAY, 7, CURRENT_TIMESTAMP(3)))", [hash(token), result.insertId]);
    cookies.push(`rems_session=${token}`);
  }
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", APP_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  server.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
  server.stderr?.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Allocation test server exited: ${output}`);
    try { if ((await fetch(`${origin}/login`)).ok) return; } catch { /* Startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Allocation test server did not start: ${output}`);
}, { timeout: 60000 });

after(async () => {
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  await db().end(); await sql?.end();
  if (created) { assert.match(databaseName, /^rems_test_[a-f0-9]{16}$/); await root.query(`DROP DATABASE \`${databaseName}\``); }
  await root?.end();
});

function request(path: string, cookie?: string, body?: URLSearchParams, requestOrigin = origin) {
  return fetch(`${origin}${path}`, { redirect: "manual", method: body ? "POST" : "GET", headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin: requestOrigin } : {}) }, body });
}
const selection = "year=1405&month=8";
async function preview(room = true, cookie = cookies[0], extra = "") {
  const response = await request(`/api/${room ? "admin/" : ""}balances?${selection}${extra}`, cookie);
  assert.equal(response.status, 200);
  return response.json();
}
async function expense(index: number, amount: string, date = "1405-08-19") {
  const response = await request("/api/expenses", cookies[index], new URLSearchParams({ amount, expenseDate: date, category: "Other", description: "Allocation fixture", requestKey: randomUUID() }));
  assert.equal(response.status, 201);
  return (await response.json()).expense;
}
function confirmation(revision: string, people = ids) {
  const form = new URLSearchParams({ period: "140508", acknowledge: "confirm", revision });
  for (const id of people) form.append("participantId", String(id));
  return form;
}
async function saveFixtureFreeze(throughDate: string, kind: "departure" | "month_end") {
  const [rows] = await sql.query<RowDataPacket[]>("SELECT * FROM rems_expenses WHERE period_key = 140508 ORDER BY expense_date, id");
  const [memberRows] = await sql.query<RowDataPacket[]>("SELECT m.*, u.username FROM rems_memberships m JOIN rems_users u ON u.id = m.user_id ORDER BY user_id");
  const result = calculateAllocations({
    period: 140508,
    members: memberRows.map((m) => ({ userId: m.user_id, username: m.username, startsOn: m.starts_on, leavesOn: m.leaves_on })),
    expenses: rows.map((e) => ({ id: e.id, userId: e.user_id, amount: e.amount, expenseDate: e.expense_date, version: e.version, deletedAt: e.deleted_at })),
  });
  const [freeze] = await sql.execute<ResultSetHeader>("INSERT INTO rems_allocation_freezes (period_key, through_date, kind, algorithm_version, finalized_by) VALUES (140508, ?, ?, ?, ?)", [throughDate, kind, ALLOCATION_VERSION, ids[0]]);
  for (const allocation of result.allocations) {
    const row = rows.find((r) => r.id === allocation.expenseId)!;
    if (row.expense_date > throughDate) continue;
    const [existing] = await sql.execute<RowDataPacket[]>("SELECT expense_id FROM rems_finalized_expenses WHERE expense_id = ?", [row.id]);
    if (existing.length) continue;
    await sql.execute("INSERT INTO rems_finalized_expenses (expense_id, freeze_id, expense_version, source_hash) VALUES (?, ?, ?, ?)", [row.id, freeze.insertId, row.version, allocation.sourceHash]);
    for (const share of allocation.shares) await sql.execute("INSERT INTO rems_finalized_shares (expense_id, user_id, share_minor) VALUES (?, ?, ?)", [row.id, share.userId, share.minor]);
  }
}

test("milestone 3: confirmed historical membership and private allocation previews", { timeout: 120000 }, async (t) => {
  await t.test("unconfirmed rosters return a clear state without guessed figures", async () => {
    expenseIds.push((await expense(0, "2000.00")).id, (await expense(1, "1000.00")).id);
    for (const room of [true, false]) {
      const value = await preview(room);
      assert.equal(value.message, "Roommates must be confirmed");
      assert.equal(value.status, "unconfirmed");
      assert.equal(value.participants, undefined); assert.equal(value.totals, undefined); assert.equal(value.personal, undefined);
    }
    const page = await request(`/balances?${selection}`, cookies[1]);
    assert.match(await page.text(), /Roommates must be confirmed/);
  });

  await t.test("anonymous and roommate requests cannot review or confirm the roster or room balances", async () => {
    for (const endpoint of ["/api/balances", "/api/admin/balances", "/api/admin/participation"]) assert.equal((await request(endpoint)).status, 401);
    for (const endpoint of ["/api/admin/balances", "/api/admin/participation"]) assert.equal((await request(endpoint, cookies[1])).status, 403);
    assert.equal((await request("/api/admin/participation", cookies[1], confirmation("irrelevant"))).status, 403);
    assert.equal((await request("/api/admin/participation", cookies[0], confirmation("irrelevant"), "https://attacker.invalid")).status, 403);
    for (const path of ["/balances", "/admin/balances", "/admin/participation"]) assert.equal((await request(path)).status, 307);
    assert.equal((await request("/admin/balances", cookies[1])).status, 307);
    assert.equal((await request("/admin/participation", cookies[1])).status, 307);
  });

  await t.test("initial setup requires explicit reviewed participants including existing payers", async () => {
    const review = await (await request("/api/admin/participation", cookies[0])).json();
    assert.equal(review.candidates.length, 5);
    assert.equal(review.candidates[2].expenseCount, 0);
    const body = confirmation(review.revision);
    body.delete("acknowledge");
    assert.equal((await request("/api/admin/participation", cookies[0], body)).status, 400);
    assert.equal((await request("/api/admin/participation", cookies[0], confirmation(review.revision, [ids[0]]))).status, 409);
    assert.equal((await request("/api/admin/participation", cookies[0], confirmation("stale"))).status, 409);
    const page = await request("/admin/participation", cookies[0]);
    const html = await page.text();
    assert.match(html, /gamma.zero/); assert.match(html, /Review selected roommates/);
    assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
    // Account creation timestamps are irrelevant to the explicit historical decision.
    await sql.execute("UPDATE rems_users SET created_at = '2026-11-10 01:00:00'");
    const responses = await Promise.all([request("/api/admin/participation", cookies[0], confirmation(review.revision)), request("/api/admin/participation", cookies[0], confirmation(review.revision))]);
    assert.ok(responses.every((r) => r.status === 200));
    assert.deepEqual((await Promise.all(responses.map((r) => r.json()))).map((r) => r.replayed).sort(), [false, true]);
    const [members] = await sql.query<RowDataPacket[]>("SELECT * FROM rems_memberships ORDER BY user_id");
    assert.equal(members.length, 5); assert.ok(members.every((m) => m.starts_on === "1405-08-01" && m.leaves_on === null));
    assert.equal((await request("/api/admin/participation", cookies[0], confirmation(review.revision, [ids[0], ids[1]]))).status, 409);
    assert.equal((await fetch(`${origin}/api/admin/participation`, { method: "PATCH", headers: { cookie: cookies[0], origin } })).status, 405);
  });

  await t.test("zero-spending participants are included and the five-payer example matches the SRS", async () => {
    const zero = await preview();
    assert.equal(zero.participants.length, 5);
    assert.equal(zero.participants[2].spending, "0.00");
    assert.equal(zero.participants[2].initialBalance, "-600.00");
    for (const [index, amount] of [[2, "500.00"], [3, "1000.00"], [4, "3000.00"]] as const) expenseIds.push((await expense(index, amount)).id);
    const result = await preview();
    assert.deepEqual(result.participants.map((p: { allocatedShare: string }) => p.allocatedShare), Array(5).fill("1500.00"));
    assert.deepEqual(result.participants.map((p: { initialBalance: string }) => p.initialBalance), ["500.00", "-500.00", "-1000.00", "-500.00", "1500.00"]);
    assert.deepEqual(result.totals, { spending: "7500.00", allocatedShare: "7500.00", initialBalance: "0.00" });
    assert.equal(result.provisional, true);
  });

  await t.test("personal server responses never include another person's figures or room totals", async () => {
    const result = await preview(false, cookies[1], `&userId=${ids[4]}&room=true&admin=true`);
    assert.equal(result.personal.userId, ids[1]);
    assert.equal(result.personal.initialBalance, "-500.00");
    assert.equal(result.participants, undefined); assert.equal(result.allocations, undefined); assert.equal(result.totals, undefined);
    assert.doesNotMatch(JSON.stringify(result), /epsilon.owner|alpha.owner|sourceHash/);
    const html = await (await request(`/balances?${selection}&userId=${ids[4]}`, cookies[1])).text();
    assert.match(html, /To pay/); assert.match(html, /500\.00 AFN/);
    assert.doesNotMatch(html, /epsilon.owner|alpha.owner|sourceHash/);
    const admin = await (await request(`/admin/balances?${selection}`, cookies[0])).text();
    assert.match(admin, /7,500\.00 AFN/); assert.match(admin, /Provisional/); assert.match(admin, /gamma.zero/);
    assert.equal((await request("/api/admin/balances", cookies[1], new URLSearchParams({ action: "finalize" }))).status, 405);
  });

  await t.test("permitted edits and soft deletion update previews and retain zero-spending members", async () => {
    const edit = await request(`/api/expenses/${expenseIds[0]}`, cookies[0], new URLSearchParams({ action: "update", version: "1", amount: "2500.00", expenseDate: "1405-08-19", category: "Other", description: "Edited", requestKey: randomUUID() }));
    assert.equal(edit.status, 200);
    assert.equal((await preview()).totals.spending, "8000.00");
    assert.equal((await request(`/api/expenses/${expenseIds[2]}`, cookies[2], new URLSearchParams({ action: "delete", version: "1", requestKey: randomUUID() }))).status, 200);
    const result = await preview();
    assert.equal(result.totals.spending, "7500.00");
    assert.equal(result.participants[2].spending, "0.00");
    assert.equal(result.participants[2].allocatedShare, "1500.00");
    assert.equal(result.participants[2].initialBalance, "-1500.00");
  });

  await t.test("new accounts do not join the historical roster or change shares", async () => {
    const before = await preview();
    const password = randomBytes(6).toString("base64");
    assert.equal((await request("/api/admin/users", cookies[0], new URLSearchParams({ username: "new.account", password }))).status, 303);
    const [users] = await sql.query<RowDataPacket[]>("SELECT id FROM rems_users WHERE username = 'new.account'");
    const token = randomBytes(32).toString("hex");
    await sql.execute("INSERT INTO rems_sessions (token_hash, user_id, expires_at) VALUES (?, ?, TIMESTAMPADD(DAY, 7, CURRENT_TIMESTAMP(3)))", [hash(token), users[0].id]);
    const cookie = `rems_session=${token}`;
    const after = await preview();
    assert.deepEqual(after.participants, before.participants);
    const personal = await preview(false, cookie);
    assert.equal(personal.status, "not-participating"); assert.equal(personal.personal, undefined);
    const write = await request("/api/expenses", cookie, new URLSearchParams({ amount: "1", expenseDate: "1405-08-19", category: "Other", requestKey: randomUUID() }));
    assert.equal(write.status, 409);
    assert.equal((await request(`/api/expenses?${selection}`, cookie)).status, 200);
    assert.equal((await request("/api/expenses", cookies[0], new URLSearchParams({ amount: "1", expenseDate: "1405-09-01", category: "Other", requestKey: randomUUID() }))).status, 409);
  });

  await t.test("saved departure allocations are read unchanged and backdated mutations are blocked", async () => {
    await saveFixtureFreeze("1405-08-20", "departure");
    const [saved] = await sql.query("SELECT * FROM rems_finalized_shares ORDER BY expense_id, user_id");
    const before = await preview();
    // Departure data is a fixture only. No application operation can set it yet.
    await sql.execute("UPDATE rems_memberships SET leaves_on = '1405-08-20' WHERE user_id = ?", [ids[2]]);
    for (const date of ["1405-08-01", "1405-08-20"]) {
      const body = new URLSearchParams({ amount: "1", expenseDate: date, category: "Other", requestKey: randomUUID() });
      assert.equal((await request("/api/expenses", cookies[0], body)).status, 409);
    }
    assert.equal((await request(`/api/expenses/${expenseIds[0]}`, cookies[0], new URLSearchParams({ action: "delete", version: "2", requestKey: randomUUID() }))).status, 409);
    assert.equal((await request(`/api/expenses/${expenseIds[0]}`, cookies[0], new URLSearchParams({ action: "update", version: "2", amount: "2500", expenseDate: "1405-08-21", category: "Other", requestKey: randomUUID() }))).status, 409);
    await expense(0, "1.00", "1405-08-21");
    const after = await preview();
    assert.equal(after.totals.spending, "7501.00");
    assert.equal(after.participants[2].allocatedShare, before.participants[2].allocatedShare);
    const [unchanged] = await sql.query("SELECT * FROM rems_finalized_shares ORDER BY expense_id, user_id");
    assert.deepEqual(unchanged, saved);
    const payerAfterLeaving = await request("/api/expenses", cookies[2], new URLSearchParams({ amount: "1", expenseDate: "1405-08-21", category: "Other", requestKey: randomUUID() }));
    assert.equal(payerAfterLeaving.status, 409);
  });

  await t.test("inconsistent finalized sources and missing month-end review return clear errors", async () => {
    await sql.execute("UPDATE rems_expenses SET version = version + 1 WHERE id = ?", [expenseIds[0]]);
    const changed = await request(`/api/admin/balances?${selection}`, cookies[0]);
    assert.equal(changed.status, 409); assert.match((await changed.json()).error, /cannot be calculated safely/);
    await sql.execute("UPDATE rems_expenses SET version = version - 1 WHERE id = ?", [expenseIds[0]]);
    // An out-of-band move must fail for both the original month and its destination.
    await sql.execute("INSERT INTO rems_accounting_periods (period_key, status) VALUES (140509, 'open')");
    await sql.execute("INSERT INTO rems_participation_rosters (period_key, confirmed_by) VALUES (140509, ?)", [ids[0]]);
    await sql.execute("INSERT INTO rems_period_participants (period_key, user_id) SELECT 140509, user_id FROM rems_memberships");
    await sql.execute("UPDATE rems_expenses SET expense_date = '1405-09-01', period_key = 140509 WHERE id = ?", [expenseIds[0]]);
    assert.equal((await request(`/api/admin/balances?${selection}`, cookies[0])).status, 409);
    assert.equal((await request("/api/admin/balances?year=1405&month=9", cookies[0])).status, 409);
    await sql.execute("UPDATE rems_expenses SET expense_date = '1405-08-19', period_key = 140508 WHERE id = ?", [expenseIds[0]]);
    await sql.execute("UPDATE rems_accounting_periods SET status = 'settling' WHERE period_key = 140508");
    assert.equal((await request(`/api/admin/balances?${selection}`, cookies[0])).status, 409);
    await sql.execute("UPDATE rems_accounting_periods SET status = 'open' WHERE period_key = 140508");
    await saveFixtureFreeze("1405-08-30", "month_end");
    await sql.execute("UPDATE rems_accounting_periods SET status = 'settling' WHERE period_key = 140508");
    const [saved] = await sql.query("SELECT * FROM rems_finalized_shares ORDER BY expense_id, user_id");
    const result = await preview();
    assert.equal(result.totals.spending, "7501.00");
    assert.equal(result.provisional, false);
    assert.match(result.message, /Frozen initial allocations/);
    assert.deepEqual((await sql.query("SELECT * FROM rems_finalized_shares ORDER BY expense_id, user_id"))[0], saved);
  });
});
