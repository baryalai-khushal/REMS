import "../scripts/env";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { databaseConfig } from "../src/server/database";
import { hashPassword, verifyPassword, validPassword } from "../src/server/password";
import { bootstrapAdmin } from "../scripts/bootstrap";
import { migrate } from "../scripts/migrations";
import { db } from "../src/server/database";
import { expenseScenarios } from "./expense-scenarios";

const databaseName = `rems_test_${randomBytes(8).toString("hex")}`;
const adminPassword = randomBytes(6).toString("base64");
const roommatePassword = randomBytes(6).toString("base64");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let root: Connection;
let sql: Connection;
let server: ChildProcess | undefined;
let origin: string;
let port: number;
let output = "";
let testDatabaseCreated = false;

async function startServer(configuredOrigin = origin) {
  output = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", APP_ORIGIN: configuredOrigin }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  server.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
  server.stderr?.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    try { if ((await fetch(`${origin}/login`)).ok) return; } catch { /* Wait for startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Test server did not start: ${output}`);
}
async function stopServer() {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  server = undefined;
}
function request(url: string, cookie?: string, body?: Record<string, string>, requestOrigin = origin) {
  return fetch(`${origin}${url}`, {
    redirect: "manual", method: body ? "POST" : "GET",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin: requestOrigin } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  });
}
async function login(username: string, password: string) {
  const response = await request("/api/auth/login", undefined, { username, password });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${origin}/dashboard`);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Max-Age=604800/i);
  assert.doesNotMatch(cookie, /; Secure/i); // Loopback HTTP is intentionally supported.
  return cookie.split(";")[0];
}

before(async () => {
  root = await mysql.createConnection({ ...databaseConfig(), database: undefined });
  // Generated name only; never create, clear, or drop the real rems database here.
  await root.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`);
  testDatabaseCreated = true;
  process.env.DB_NAME = databaseName;
  process.env.REMS_TEST_DATABASE = "1";
  await migrate();
  sql = await mysql.createConnection(databaseConfig());
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  await startServer();
}, { timeout: 60000 });

after(async () => {
  await stopServer();
  await db().end();
  await sql?.end();
  if (testDatabaseCreated) {
    assert.match(databaseName, /^rems_test_[a-f0-9]{16}$/);
    await root.query(`DROP DATABASE \`${databaseName}\``);
  }
  await root?.end();
});

test("first milestone: real MySQL and HTTP authorization", { timeout: 120000 }, async (t) => {
  let adminCookie = "";
  let roommateCookie = "";

  await t.test("migration history is repeatable and detects changed or incomplete DDL", async () => {
    await migrate();
    const [rows] = await sql.query<RowDataPacket[]>("SELECT * FROM rems_schema_migrations");
    assert.equal(rows.length, 25);
    assert.ok(rows.every((row) => row.status === "applied"));
    const temp = await mkdtemp(path.join(process.cwd(), ".cache-migrations-"));
    try {
      for (const row of rows) await writeFile(path.join(temp, row.version), await readFile(path.join("migrations", row.version)));
      await writeFile(path.join(temp, rows[0].version), "SELECT 1");
      await assert.rejects(migrate(temp), /changed or removed/);
    } finally {
      assert.equal(path.dirname(path.resolve(temp)), process.cwd());
      assert.match(path.basename(temp), /^\.cache-migrations-/);
      await rm(temp, { recursive: true, force: true });
    }
    await sql.execute("UPDATE rems_schema_migrations SET status = 'applying' WHERE version = ?", [rows[0].version]);
    await assert.rejects(migrate(), /incomplete/);
    await sql.execute("UPDATE rems_schema_migrations SET status = 'applied' WHERE version = ?", [rows[0].version]);
  });

  await t.test("passwords are salted, verified, and constrained to the SRS", async () => {
    assert.equal(validPassword("short"), false);
    assert.equal(validPassword("too-long-password"), false);
    const encoded = await hashPassword(roommatePassword);
    assert.equal(await verifyPassword(roommatePassword, encoded), true);
    assert.equal(await verifyPassword("incorrect", encoded), false);
    assert.notEqual(encoded, await hashPassword(roommatePassword));
    assert.equal(await verifyPassword(roommatePassword, "malformed"), false);
  });

  await t.test("anonymous and forged sessions cannot access protected pages or admin operations", async () => {
    for (const cookie of [undefined, "rems_session=forged", `rems_session=${"a".repeat(64)}`]) {
      for (const page of ["/dashboard", "/account", "/admin/users"]) {
        const response = await request(page, cookie);
        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), "/login");
        assert.doesNotMatch(await response.text(), /Add a roommate/);
      }
      assert.equal((await request("/api/admin/users", cookie)).status, 401);
      assert.equal((await request("/api/admin/users", cookie, { username: "intruder", password: roommatePassword })).status, 401);
    }
  });

  await t.test("admin setup is one-time and stores no plaintext password", async () => {
    await assert.rejects(bootstrapAdmin("admin", "short"), /exactly 8/);
    assert.equal(await bootstrapAdmin("Room.Admin", adminPassword), "room.admin");
    await assert.rejects(bootstrapAdmin("another.admin", adminPassword), /already exists/);
    const [rows] = await sql.execute<RowDataPacket[]>("SELECT * FROM rems_users");
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].password_hash, adminPassword);
    assert.match(rows[0].password_hash, /^scrypt\$/);
  });

  await t.test("login rejects bad credentials, SQL injection, and cross-origin submissions", async () => {
    for (const username of ["room.admin", "missing.user", "' OR 1=1 --"]) {
      const response = await request("/api/auth/login", undefined, { username, password: "wrong" });
      assert.equal(response.headers.get("location"), `${origin}/login?error=credentials`);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal((await request("/api/auth/login", undefined, { username: "room.admin", password: adminPassword }, "https://attacker.invalid")).status, 403);
    assert.equal((await fetch(`${origin}/api/auth/login`, { method: "POST", body: new URLSearchParams({ username: "room.admin", password: adminPassword }) })).status, 403);
    adminCookie = await login("ROOM.ADMIN", adminPassword);
    const token = adminCookie.split("=")[1];
    const [sessions] = await sql.execute<RowDataPacket[]>("SELECT * FROM rems_sessions");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].token_hash, hash(token));
    assert.notEqual(sessions[0].token_hash, token);
  });

  await t.test("only the admin can create accounts; usernames remain unique under races", async () => {
    assert.equal((await request("/admin/users", adminCookie)).status, 200);
    assert.equal((await request("/api/admin/users", adminCookie, { username: "new.user", password: roommatePassword }, "https://attacker.invalid")).status, 403);
    const responses = await Promise.all([1, 2].map(() => request("/api/admin/users", adminCookie, { username: "Room.Mate", password: roommatePassword, role: "admin" })));
    assert.deepEqual(responses.map((r) => new URL(r.headers.get("location")!).searchParams.get("result")).sort(), ["created", "duplicate"]);
    const [rows] = await sql.execute<RowDataPacket[]>("SELECT role FROM rems_users WHERE username = 'room.mate'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "roommate");
    const listing = await request("/api/admin/users", adminCookie);
    assert.match(listing.headers.get("cache-control")!, /no-store/);
    assert.ok((await listing.json()).every((row: object) => Object.keys(row).sort().join(",") === "id,role,username"));
    roommateCookie = await login("room.mate", roommatePassword);
  });

  await t.test("roommates access their pages but cannot read or invoke admin operations", async () => {
    assert.equal((await request("/dashboard", roommateCookie)).status, 200);
    const account = await request("/account", roommateCookie);
    const html = await account.text();
    assert.match(html, /room.mate/);
    assert.doesNotMatch(html, /room.admin|password_hash|scrypt\$/);
    const response = await request("/admin/users", roommateCookie);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/dashboard?denied=1");
    assert.doesNotMatch(await response.text(), /Add a roommate/);
    assert.equal((await request("/api/admin/users", roommateCookie)).status, 403);
    assert.equal((await request("/api/admin/users", roommateCookie, { username: "intruder", password: roommatePassword, role: "admin" })).status, 403);
  });

  await t.test("milestone 2: expenses, audits and accounting periods", async (expenseTest) => {
    await expenseScenarios(expenseTest, { sql, origin, adminCookie, roommateCookie });
  });

  await t.test("sessions survive a server restart and roles are read from MySQL", async () => {
    await stopServer();
    await startServer();
    assert.equal((await request("/account", roommateCookie)).status, 200);
    // A role changed directly in MySQL must take effect without re-login.
    await sql.execute("UPDATE rems_users SET role = 'roommate' WHERE username = 'room.admin'");
    assert.equal((await request("/api/admin/users", adminCookie)).status, 403);
    await sql.execute("UPDATE rems_users SET role = 'admin' WHERE username = 'room.admin'");
    assert.equal((await request("/api/admin/users", adminCookie)).status, 200);
  });

  await t.test("session rotation, expiry, and logout invalidate old tokens on the server", async () => {
    const oldCookie = roommateCookie;
    const response = await request("/api/auth/login", oldCookie, { username: "room.mate", password: roommatePassword });
    roommateCookie = response.headers.get("set-cookie")!.split(";")[0];
    assert.notEqual(roommateCookie, oldCookie);
    assert.equal((await request("/account", oldCookie)).status, 307);
    assert.equal((await request("/api/auth/logout", roommateCookie)).status, 405);
    assert.equal((await request("/api/auth/logout", roommateCookie, {}, "https://attacker.invalid")).status, 403);
    assert.equal((await request("/account", roommateCookie)).status, 200);
    const logout = await request("/api/auth/logout", roommateCookie, {});
    assert.equal(logout.status, 303);
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/i);
    assert.equal((await request("/account", roommateCookie)).status, 307);
    roommateCookie = await login("room.mate", roommatePassword);
    await sql.execute("UPDATE rems_sessions SET expires_at = TIMESTAMPADD(SECOND, -1, CURRENT_TIMESTAMP(3)) WHERE token_hash = ?", [hash(roommateCookie.split("=")[1])]);
    assert.equal((await request("/account", roommateCookie)).status, 307);
  });

  await t.test("login attempts are limited persistently for existing and unknown usernames", async () => {
    for (const username of ["room.mate", "unknown.user"]) {
      for (let i = 0; i < 10; i++) await request("/api/auth/login", undefined, { username, password: "wrong" });
      const response = await request("/api/auth/login", undefined, { username, password: roommatePassword });
      assert.equal(response.headers.get("location"), `${origin}/login?error=throttled`);
    }
  });

  await t.test("form bodies are bounded and unsupported submissions are rejected", async () => {
    const response = await request("/api/auth/login", undefined, { username: "a".repeat(5000), password: "wrong" });
    assert.equal(response.status, 400);
    assert.equal((await fetch(`${origin}/api/auth/login`, {
      method: "POST", headers: { origin, "Content-Type": "application/json" }, body: "{}",
    })).status, 400);
  });

  await t.test("HTTPS deployments set Secure cookies and use the configured trusted origin", async () => {
    await stopServer();
    const httpsOrigin = "https://rems.example.test";
    await startServer(httpsOrigin);
    const response = await request("/api/auth/login", undefined, { username: "room.admin", password: adminPassword }, httpsOrigin);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${httpsOrigin}/dashboard`);
    assert.match(response.headers.get("set-cookie")!, /; Secure/i);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
    assert.equal((await request("/api/auth/login", undefined, { username: "room.admin", password: adminPassword })).status, 403);
  });
});
