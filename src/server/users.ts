import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { currentUser } from "./auth";
import { db } from "./database";
import { hashPassword, normalizeUsername, validPassword } from "./password";

export async function listUsers() {
  const actor = await currentUser();
  if (actor?.role !== "admin") throw new Error("Forbidden.");
  const [rows] = await db().execute<RowDataPacket[]>("SELECT id, username, role FROM rems_users ORDER BY id");
  return rows.map((row) => ({ id: Number(row.id), username: String(row.username), role: String(row.role) }));
}
export async function createRoommate(rawUsername: string, password: string) {
  const actor = await currentUser();
  if (actor?.role !== "admin") throw new Error("Forbidden.");
  const username = normalizeUsername(rawUsername);
  if (!username || !validPassword(password)) return "invalid";
  const hash = await hashPassword(password);
  try {
    await db().execute("INSERT INTO rems_users (username, password_hash, role) VALUES (?, ?, 'roommate')", [username, hash]);
    return "created";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") return "duplicate";
    throw error;
  }
}
