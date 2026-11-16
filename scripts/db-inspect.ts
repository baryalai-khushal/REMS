import "./env";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { databaseConfig } from "../src/server/database";
async function main() {
  const connection = await mysql.createConnection(databaseConfig());
  try {
    const [version] = await connection.query<RowDataPacket[]>("SELECT VERSION() AS version");
    const [tables] = await connection.query("SHOW TABLES");
    console.log(JSON.stringify({ version: version[0].version, tables }, null, 2));
  } finally { await connection.end(); }
}
main().catch((error) => { console.error(`MySQL inspection failed (${error.code ?? "UNKNOWN"}).`); process.exitCode = 1; });
