import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./database";
import { normalizeUsername, verifyPassword } from "./password";

export type User = { id: number; username: string; role: "admin" | "roommate" };
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
export const COOKIE_NAME = "rems_session";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function appOrigin() {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new Error("Missing APP_ORIGIN.");
  const url = new URL(configured);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== configured) throw new Error("APP_ORIGIN must be an exact HTTP(S) origin without a trailing slash.");
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("APP_ORIGIN requires HTTPS except on loopback.");
  }
  return url.origin;
}

export function sessionCookieOptions() {
  return { httpOnly: true, secure: appOrigin().startsWith("https:"), sameSite: "lax" as const, path: "/", maxAge: SESSION_SECONDS };
}

export async function userForToken(token?: string): Promise<User | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [rows] = await db().execute<(RowDataPacket & User)[]>(
    `SELECT u.id, u.username, u.role FROM rems_sessions s
     JOIN rems_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP(3) AND u.deactivated_at IS NULL`, [digest(token)],
  );
  return rows[0] ? { id: rows[0].id, username: rows[0].username, role: rows[0].role } : null;
}

export async function currentUser() {
  return userForToken((await cookies()).get(COOKIE_NAME)?.value);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard?denied=1");
  return user;
}

export async function revokeSession(token?: string) {
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await db().execute("DELETE FROM rems_sessions WHERE token_hash = ?", [digest(token)]);
  }
}

export async function createSession(userId: number, oldToken?: string) {
  const token = randomBytes(32).toString("hex");
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [active] = await connection.execute<RowDataPacket[]>("SELECT id FROM rems_users WHERE id = ? AND deactivated_at IS NULL FOR UPDATE", [userId]);
    if (!active.length) throw new Error("The account is unavailable.");
    if (oldToken && /^[a-f0-9]{64}$/.test(oldToken)) {
      await connection.execute("DELETE FROM rems_sessions WHERE token_hash = ?", [digest(oldToken)]);
    }
    await connection.execute(
      "INSERT INTO rems_sessions (token_hash, user_id, expires_at) VALUES (?, ?, TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3)))",
      [digest(token), userId, SESSION_SECONDS],
    );
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  return token;
}

export async function authenticate(rawUsername: string, password: string): Promise<User | "throttled" | null> {
  const username = normalizeUsername(rawUsername);
  if (!username || Buffer.byteLength(password) > 256) return null;
  const key = digest(username);
  // Atomic increments make the limit effective across processes and simultaneous requests.
  await db().execute(
    `INSERT INTO rems_login_throttle (username_hash, attempts, window_end)
     VALUES (?, 1, TIMESTAMPADD(MINUTE, 15, CURRENT_TIMESTAMP(3)))
     ON DUPLICATE KEY UPDATE
       attempts = IF(window_end <= CURRENT_TIMESTAMP(3), 1, attempts + 1),
       window_end = IF(window_end <= CURRENT_TIMESTAMP(3), TIMESTAMPADD(MINUTE, 15, CURRENT_TIMESTAMP(3)), window_end)`, [key],
  );
  const [attempts] = await db().execute<RowDataPacket[]>("SELECT attempts FROM rems_login_throttle WHERE username_hash = ?", [key]);
  if (attempts[0].attempts > 10) return "throttled";
  const [users] = await db().execute<(RowDataPacket & User & { password_hash: string; deactivated_at: string | null })[]>(
    "SELECT id, username, role, password_hash, deactivated_at FROM rems_users WHERE username = ?", [username],
  );
  const user = users[0];
  const valid = await verifyPassword(password, user?.password_hash);
  if (!valid || !user || user.deactivated_at !== null) return null;
  await db().execute("DELETE FROM rems_login_throttle WHERE username_hash = ?", [key]);
  return { id: user.id, username: user.username, role: user.role };
}
