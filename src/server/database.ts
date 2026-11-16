import "server-only";
import mysql from "mysql2/promise";

export function databaseConfig() {
  for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD"] as const) {
    if (process.env[key] === undefined) throw new Error(`Missing ${key}. Configure .env.local.`);
  }
  const port = Number(process.env.DB_PORT ?? "3306");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DB_PORT.");
  const database = process.env.DB_NAME ?? "rems";
  if (database !== "rems" && !(process.env.REMS_TEST_DATABASE === "1" && /^rems_test_[a-z0-9_]+$/.test(database))) {
    throw new Error("REMS uses the existing rems database. Tests require an explicit rems_test_ database.");
  }
  return {
    host: process.env.DB_HOST,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    charset: "utf8mb4",
    timezone: "+00:00",
    dateStrings: true,
    multipleStatements: false,
    connectTimeout: 10000,
  };
}

const globalDatabase = globalThis as unknown as { remsPool?: mysql.Pool };
export function db() {
  return (globalDatabase.remsPool ??= mysql.createPool({
    ...databaseConfig(), connectionLimit: 5, waitForConnections: true, queueLimit: 25,
  }));
}
