import "./env";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { databaseConfig } from "../src/server/database";
import { hashPassword, normalizeUsername, validPassword } from "../src/server/password";

export async function bootstrapAdmin(rawUsername: string, password: string) {
  const username = normalizeUsername(rawUsername);
  if (!username) throw new Error("Username must be 3–32 letters, numbers, dots, underscores, or hyphens, starting with a letter or number.");
  if (!validPassword(password)) throw new Error("Password must contain exactly 8 characters.");
  const connection = await mysql.createConnection(databaseConfig());
  const lock = `${databaseConfig().database}:bootstrap`;
  try {
    const [locks] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS acquired", [lock]);
    if (locks[0].acquired !== 1) throw new Error("Another admin setup is running.");
    const [admins] = await connection.execute<RowDataPacket[]>("SELECT id FROM rems_users WHERE role = 'admin' LIMIT 1");
    if (admins.length) throw new Error("An admin already exists. Setup will not replace or reset that account.");
    await connection.execute("INSERT INTO rems_users (username, password_hash, role) VALUES (?, ?, 'admin')", [username, await hashPassword(password)]);
    return username;
  } finally {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lock]).catch(() => {});
    await connection.end();
  }
}
