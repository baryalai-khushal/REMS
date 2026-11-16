import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { initializePeriod } from "../src/server/periods";
import { dateString, monthDays, parseShamsiDate, todayShamsi } from "../src/lib/shamsi";
import { parseAmount } from "../src/lib/expense-input";

type Fixtures = { sql: Connection; origin: string; adminCookie: string; roommateCookie: string };
export async function expenseScenarios(t: TestContext, { sql, origin, adminCookie, roommateCookie }: Fixtures) {
  const request = (url: string, cookie?: string, body?: Record<string, string>, requestOrigin = origin) => fetch(`${origin}${url}`, {
    method: body ? "POST" : "GET", redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin: requestOrigin } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const input = (overrides: Record<string, string> = {}) => ({
    amount: "0.10", expenseDate: "1405-08-19", category: "Breakfast", description: "Room breakfast", requestKey: randomUUID(), ...overrides,
  });
  const list = async (cookie = roommateCookie, query = "year=1405&month=8") => {
    const response = await request(`/api/expenses?${query}`, cookie);
    assert.equal(response.status, 200);
    return response.json();
  };
  const scalar = async (query: string, values: (number | string)[] = []) => {
    const [rows] = await sql.execute<RowDataPacket[]>(query, values);
    return rows[0].value;
  };
  let ownId = 0;
  let adminId = 0;
  let roommateId = 0;
  let createBody: ReturnType<typeof input>;

  await t.test("Shamsi dates handle leap years, month boundaries, and Kabul midnight", () => {
    assert.ok(parseShamsiDate("1399-12-30"));
    assert.ok(parseShamsiDate("1403-12-30"));
    for (const invalid of ["1400-12-30", "1404-12-30", "1405-07-31", "1405-13-01", "1405-00-01", "1405-01-00", "1405-8-19", "0000-01-01", "3178-01-01"]) {
      assert.equal(parseShamsiDate(invalid), null, invalid);
    }
    assert.equal(monthDays(1405, 6), 31);
    assert.equal(monthDays(1405, 7), 30);
    assert.equal(monthDays(1403, 12), 30);
    assert.equal(monthDays(1404, 12), 29);
    assert.deepEqual(todayShamsi(new Date("2025-03-20T19:29:59Z")), { year: 1403, month: 12, day: 30 });
    assert.deepEqual(todayShamsi(new Date("2025-03-20T19:30:00Z")), { year: 1404, month: 1, day: 1 });
    assert.equal(dateString(todayShamsi(new Date("2026-11-10T00:00:00Z"))), "1405-08-19");
  });

  await t.test("expense routes require sessions and a trusted origin", async () => {
    for (const endpoint of ["/api/expenses", "/api/expenses/1", "/api/admin/expenses", "/api/periods"]) {
      assert.equal((await request(endpoint)).status, 401);
    }
    assert.equal((await request("/api/expenses", undefined, input())).status, 401);
    assert.equal((await request("/api/expenses", roommateCookie, input(), "https://attacker.invalid")).status, 403);
    for (const page of ["/expenses", "/expenses/new", "/expenses/1/edit", "/expenses/1/delete", "/admin/expenses"]) {
      const response = await request(page);
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), "/login");
    }
    assert.equal((await request("/api/admin/expenses", roommateCookie)).status, 403);
    const denied = await request("/admin/expenses", roommateCookie);
    assert.equal(denied.status, 307);
  });

  await t.test("first period is explicit, one-time, and cannot be bypassed", async () => {
    assert.equal((await request("/api/expenses", roommateCookie, input())).status, 409);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_expenses"), 0);
    await initializePeriod(1405, 8);
    await initializePeriod(1405, 8);
    await assert.rejects(initializePeriod(1405, 9), /already been initialized/);
    assert.equal(await scalar("SELECT status AS value FROM rems_accounting_periods WHERE period_key = 140508"), "open");
    assert.equal((await request("/api/periods", adminCookie, { status: "closed" })).status, 405);
  });

  await t.test("amount/date/category/description validation rejects invalid values without mutations", async () => {
    for (const amount of ["0", "0.00", "-1", "1.001", "1e3", "NaN", "Infinity", "1000000000000", "1,000", "", "0.0001"]) {
      assert.equal(parseAmount(amount), null);
      const response = await request("/api/expenses", roommateCookie, input({ amount }));
      assert.equal(response.status, 400, amount);
      assert.ok((await response.json()).fields.amount);
    }
    for (const expenseDate of ["1404-12-30", "1405-07-31", "2026-11-31", "1405-08-00"]) {
      assert.equal((await request("/api/expenses", roommateCookie, input({ expenseDate }))).status, 400);
    }
    assert.equal((await request("/api/expenses", roommateCookie, input({ category: "not-a-category" }))).status, 400);
    assert.equal((await request("/api/expenses", roommateCookie, input({ description: "x".repeat(101) }))).status, 400);
    assert.equal((await request("/api/expenses", roommateCookie, input({ requestKey: "missing" }))).status, 400);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_expenses"), 0);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_expense_audit"), 0);
  });

  await t.test("create derives payer from session; concurrent retries create one expense and audit", async () => {
    roommateId = await scalar("SELECT id AS value FROM rems_users WHERE username = 'room.mate'");
    adminId = await scalar("SELECT id AS value FROM rems_users WHERE username = 'room.admin'");
    createBody = input({ userId: String(adminId), payer: String(adminId), periodKey: "140509" });
    const results = await Promise.all([request("/api/expenses", roommateCookie, createBody), request("/api/expenses", roommateCookie, createBody)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
    const [first, second] = await Promise.all(results.map((r) => r.json()));
    ownId = first.expense.id;
    assert.equal(second.expense.id, ownId);
    assert.equal(first.expense.userId, roommateId);
    assert.equal(first.expense.periodKey, 140508);
    assert.equal(first.expense.amount, "0.10");
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_expense_audit WHERE expense_id = ?", [ownId]), 1);
    const replay = await request("/api/expenses", roommateCookie, { ...createBody, amount: "0.1" });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);
    assert.equal((await request("/api/expenses", roommateCookie, { ...createBody, amount: "12" })).status, 409);
  });

  let adminExpenseId = 0;
  await t.test("personal totals use exact decimals and exclude other payers", async () => {
    const result = await request("/api/expenses", roommateCookie, input({ amount: "0.20", description: "Second expense" }));
    assert.equal(result.status, 201);
    const ownHistory = await list();
    assert.equal(ownHistory.total, "0.30");
    const response = await request("/api/expenses", adminCookie, input({ amount: "7.25", description: "Admin private spending" }));
    assert.equal(response.status, 201);
    adminExpenseId = (await response.json()).expense.id;
    assert.equal((await list(adminCookie)).total, "7.25");
    assert.equal((await list(roommateCookie, `year=1405&month=8&userId=${adminId}`)).total, "0.30");
    const large = await request("/api/expenses", roommateCookie, input({ amount: "999999999999.99", description: "😀".repeat(100) }));
    assert.equal(large.status, 201);
    const largeExpense = (await large.json()).expense;
    assert.equal((await list()).total, "1000000000000.29");
    assert.equal((await request(`/api/expenses/${largeExpense.id}`, roommateCookie, { action: "delete", version: "1", requestKey: randomUUID() })).status, 200);
    assert.equal((await list()).total, "0.30");
  });

  await t.test("ownership is enforced for reads, URLs, edits and deletes, including admin mutations", async () => {
    for (const [cookie, id] of [[roommateCookie, adminExpenseId], [adminCookie, ownId]] as const) {
      assert.equal((await request(`/api/expenses/${id}`, cookie)).status, 404);
      assert.equal((await request(`/api/expenses/${id}/edit`, cookie)).status, 404);
      assert.equal((await request(`/expenses/${id}/edit`, cookie)).status, 404);
      assert.equal((await request(`/expenses/${id}/delete`, cookie)).status, 404);
      assert.equal((await request(`/api/expenses/${id}`, cookie, input({ action: "update", version: "1" }))).status, 404);
      assert.equal((await request(`/api/expenses/${id}`, cookie, { action: "delete", version: "1", requestKey: randomUUID() })).status, 404);
    }
    const own = await request(`/api/expenses/${ownId}`, roommateCookie);
    assert.equal(own.status, 200);
    assert.equal((await own.json()).userId, roommateId);
  });

  await t.test("admin review supports month/roommate filters without write access", async () => {
    const response = await request("/api/admin/expenses?year=1405&month=8", adminCookie);
    assert.equal(response.status, 200);
    const review = await response.json();
    assert.equal(review.total, "7.55");
    assert.equal(review.count, 3);
    assert.ok(review.expenses.every((row: { username: string }) => row.username));
    const filtered = await request(`/api/admin/expenses?year=1405&month=8&userId=${roommateId}`, adminCookie);
    assert.equal((await filtered.json()).total, "0.30");
    assert.equal((await request("/api/admin/expenses?year=1405&month=8&userId=1%20OR%201=1", adminCookie)).status, 400);
    assert.equal((await request("/api/admin/expenses", adminCookie, input())).status, 405);
    const page = await request("/admin/expenses?year=1405&month=8", adminCookie);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Aqrab/);
    assert.match(html, /room.mate/);
    assert.doesNotMatch(html, /password_hash|scrypt\$/);
  });

  await t.test("updates reject stale versions and capture exact before/after values once", async () => {
    const body = input({ action: "update", version: "1", amount: "12.34", description: "Updated meal" });
    const results = await Promise.all([request(`/api/expenses/${ownId}`, roommateCookie, body), request(`/api/expenses/${ownId}`, roommateCookie, body)]);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal((await results[0].json()).expense.version, 2);
    assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie, input({ action: "update", version: "1" }))).status, 409);
    const [audit] = await sql.execute<RowDataPacket[]>("SELECT * FROM rems_expense_audit WHERE expense_id = ? ORDER BY id", [ownId]);
    assert.equal(audit.length, 2);
    assert.equal(audit[1].actor_id, roommateId);
    assert.equal(audit[1].action, "update");
    assert.equal(audit[1].before_values.amount, "0.10");
    assert.equal(audit[1].after_values.amount, "12.34");
    assert.equal(audit[1].after_values.version, 2);
    assert.ok(audit[1].occurred_at);
  });

  await t.test("audit write failure rolls back expense mutation and retry key together", async () => {
    const count = await scalar("SELECT COUNT(*) AS value FROM rems_expenses");
    const body = input({ description: "Must roll back" });
    await sql.query("CREATE TRIGGER rems_test_audit_failure BEFORE INSERT ON rems_expense_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test audit failure'");
    try {
      assert.equal((await request("/api/expenses", roommateCookie, body)).status, 503);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_expenses"), count);
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_expense_requests WHERE request_key = ?", [body.requestKey]), 0);
      assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie, input({ action: "update", version: "2", amount: "88" }))).status, 503);
      assert.equal(await scalar("SELECT amount AS value FROM rems_expenses WHERE id = ?", [ownId]), "12.34");
      assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie, { action: "delete", version: "2", requestKey: randomUUID() })).status, 503);
      assert.equal(await scalar("SELECT deleted_at AS value FROM rems_expenses WHERE id = ?", [ownId]), null);
    } finally { await sql.query("DROP TRIGGER rems_test_audit_failure"); }
    assert.equal((await request("/api/expenses", roommateCookie, body)).status, 201);
  });

  await t.test("settling/closed periods reject writes and moving dates cannot bypass a locked source", async () => {
    for (const status of ["settling", "closed"]) {
      await sql.execute("UPDATE rems_accounting_periods SET status = ? WHERE period_key = 140508", [status]);
      if (status === "closed") await sql.execute("INSERT INTO rems_accounting_periods (period_key, status) VALUES (140509, 'open')");
      for (const cookie of [roommateCookie, adminCookie]) {
        assert.equal((await request("/api/expenses", cookie, input())).status, 409);
        assert.equal((await request("/api/expenses", cookie, input({ expenseDate: "1405-09-01" }))).status, status === "closed" ? 201 : 409);
      }
      assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie, input({ action: "update", version: "2", expenseDate: "1405-09-01" }))).status, 409);
      assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie, { action: "delete", version: "2", requestKey: randomUUID() })).status, 409);
      assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie)).status, 200);
      await initializePeriod(1405, 8);
      assert.equal(await scalar("SELECT status AS value FROM rems_accounting_periods WHERE period_key = 140508"), status);
    }
    await sql.execute("UPDATE rems_accounting_periods SET status = 'open' WHERE period_key = 140508");
    for (const cookie of [roommateCookie, adminCookie]) {
      assert.equal((await request("/api/expenses", cookie, input({ expenseDate: "1405-09-02", status: "open", bypass: "true" }))).status, 409);
    }
    assert.equal((await request("/api/expenses", roommateCookie, input({ expenseDate: "1405-07-30" }))).status, 409);
    assert.equal((await list(roommateCookie, "year=1405&month=9")).count, 1);
    assert.equal((await list(roommateCookie, "year=1405&month=9")).expenses[0].expenseDate, "1405-09-01");
  });

  await t.test("period status changes are locked in the same transaction as a mutation", async () => {
    await sql.beginTransaction();
    let settled = false;
    let response: Promise<Response> | undefined;
    try {
      await sql.execute("UPDATE rems_accounting_periods SET status = 'settling' WHERE period_key = 140508");
      response = request("/api/expenses", roommateCookie, input({ description: "Concurrent status change" }));
      response.then(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(settled, false);
      await sql.commit();
      assert.equal((await response).status, 409);
    } finally {
      await sql.rollback();
      await response;
      await sql.execute("UPDATE rems_accounting_periods SET status = 'open' WHERE period_key = 140508");
    }
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_expenses WHERE description = 'Concurrent status change'"), 0);
  });

  await t.test("delete is soft, audited, retry-safe, and excluded from normal totals/history", async () => {
    const body = { action: "delete", version: "2", requestKey: randomUUID() };
    const response = await request(`/api/expenses/${ownId}`, roommateCookie, body);
    assert.equal(response.status, 200);
    const deleted = (await response.json()).expense;
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.version, 3);
    assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie, body)).status, 200);
    assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie)).status, 404);
    const history = await list();
    assert.equal(history.total, "0.30");
    assert.ok(history.expenses.every((expense: { id: number }) => expense.id !== ownId));
    const [audit] = await sql.execute<RowDataPacket[]>("SELECT * FROM rems_expense_audit WHERE expense_id = ? ORDER BY id", [ownId]);
    assert.deepEqual(audit.map((row) => row.action), ["create", "update", "delete"]);
    assert.equal(audit[2].before_values.deletedAt, null);
    assert.ok(audit[2].after_values.deletedAt);
    assert.equal(audit[2].after_values.amount, "12.34");
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM rems_expenses WHERE id = ?", [ownId]), 1);
    // Replaying a successful create after deletion returns its original result; no resurrection.
    assert.equal((await request("/api/expenses", roommateCookie, createBody)).status, 200);
    assert.equal((await request(`/api/expenses/${ownId}`, roommateCookie)).status, 404);
    await assert.rejects(sql.execute("DELETE FROM rems_expenses WHERE id = ?", [ownId]));
  });

  await t.test("personal pages display Shamsi filters, feedback and confirmation without leaking another payer", async () => {
    const page = await request("/expenses?year=1405&month=8&success=created", roommateCookie);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Expense added/);
    assert.match(html, /0\.30 AFN/);
    assert.match(html, /Hamal/); assert.match(html, /Hoot/);
    assert.doesNotMatch(html, /Admin private spending/);
    const empty = await request("/expenses?year=1406&month=1", roommateCookie);
    assert.match(await empty.text(), /No expenses in this selection/);
    const invalid = await request("/expenses?year=bad&month=15", roommateCookie);
    assert.match(await invalid.text(), /Choose a valid Shamsi/);
    const history = await list();
    const editableId = history.expenses[0].id;
    const confirmation = await request(`/expenses/${editableId}/delete`, roommateCookie);
    assert.match(await confirmation.text(), /Confirm deletion/);
    const add = await request("/expenses/new", roommateCookie);
    const addHTML = await add.text();
    assert.match(addHTML, /100 characters/);
    assert.match(addHTML, /Kabul local time/);
  });

  await t.test("paginated personal history keeps the total for the entire selected month", async () => {
    for (let index = 0; index < 51; index++) {
      assert.equal((await request("/api/expenses", roommateCookie, input({ amount: "0.01", description: `History row ${index}` }))).status, 201);
    }
    const first = await list();
    const second = await list(roommateCookie, "year=1405&month=8&page=2");
    assert.equal(first.count, 53);
    assert.equal(first.pages, 2);
    assert.equal(first.expenses.length, 50);
    assert.equal(second.expenses.length, 3);
    assert.equal(first.total, "0.81");
    assert.equal(second.total, "0.81");
    const firstIds = new Set(first.expenses.map((expense: { id: number }) => expense.id));
    assert.ok(second.expenses.every((expense: { id: number }) => !firstIds.has(expense.id)));
    assert.equal((await request("/api/expenses?year=1405&month=8&page=-1", roommateCookie)).status, 400);
  });

  await t.test("concurrent history reads complete without exhausting the connection pool", async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => fetch(`${origin}/api/expenses?year=1405&month=8`, {
      headers: { cookie: roommateCookie }, signal: AbortSignal.timeout(5000),
    })));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).total, "0.81");
    }
  });

  await t.test("Hoot and Hamal entry and filters respect the Shamsi year boundary", async () => {
    // Test fixtures emulate future validated closure; there is no closure endpoint or command.
    await sql.execute("UPDATE rems_accounting_periods SET status = 'closed' WHERE period_key IN (140508, 140509)");
    await sql.execute("INSERT INTO rems_accounting_periods (period_key, status) VALUES (140512, 'open')");
    const hoot = await request("/api/expenses", roommateCookie, input({ expenseDate: "1405-12-29", amount: "1.01" }));
    assert.equal(hoot.status, 201);
    assert.equal((await hoot.json()).expense.periodKey, 140512);
    assert.equal((await request("/api/expenses", roommateCookie, input({ expenseDate: "1406-01-01" }))).status, 409);
    await sql.execute("UPDATE rems_accounting_periods SET status = 'closed' WHERE period_key = 140512");
    await sql.execute("INSERT INTO rems_accounting_periods (period_key, status) VALUES (140601, 'open')");
    const hamal = await request("/api/expenses", roommateCookie, input({ expenseDate: "1406-01-01", amount: "2.02" }));
    assert.equal(hamal.status, 201);
    assert.equal((await hamal.json()).expense.expenseDate, "1406-01-01");
    const hootHistory = await list(roommateCookie, "year=1405&month=12");
    const hamalHistory = await list(roommateCookie, "year=1406&month=1");
    assert.equal(hootHistory.total, "1.01");
    assert.equal(hamalHistory.total, "2.02");
    assert.equal(hootHistory.count, 1);
    assert.equal(hamalHistory.count, 1);
    assert.equal(hootHistory.expenses[0].expenseDate, "1405-12-29");
    const hootPage = await request("/expenses?year=1405&month=12", roommateCookie);
    assert.match(await hootPage.text(), /29 Hoot 1405/);
    const hamalPage = await request("/expenses?year=1406&month=1", roommateCookie);
    assert.match(await hamalPage.text(), /1 Hamal 1406/);
    assert.equal((await request("/api/expenses", roommateCookie, createBody)).status, 200);
  });
}
