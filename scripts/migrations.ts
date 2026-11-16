import "./env";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { databaseConfig } from "../src/server/database";

export async function migrate(directory = path.join(process.cwd(), "migrations")) {
  const connection = await mysql.createConnection(databaseConfig());
  const lock = `${databaseConfig().database}:migrate`;
  try {
    const [locks] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS acquired", [lock]);
    if (locks[0].acquired !== 1) throw new Error("Another migration is running.");
    await connection.query(`CREATE TABLE IF NOT EXISTS rems_schema_migrations (
      version VARCHAR(160) CHARACTER SET ascii NOT NULL PRIMARY KEY,
      checksum CHAR(64) CHARACTER SET ascii NOT NULL,
      status ENUM('applying', 'applied') NOT NULL,
      applied_at TIMESTAMP(3) NULL
    ) ENGINE=InnoDB`);
    const [existing] = await connection.execute<RowDataPacket[]>("SELECT version, checksum, status FROM rems_schema_migrations ORDER BY version");
    const files = (await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    if (!files.length) throw new Error("No versioned SQL migration files found.");
    if (new Set(files.map((name) => name.slice(0, 3))).size !== files.length) throw new Error("Duplicate migration number.");
    const sources = new Map<string, { sql: string; checksum: string }>();
    for (const file of files) {
      const sql = (await readFile(path.join(directory, file), "utf8")).replace(/\r\n/g, "\n");
      sources.set(file, { sql, checksum: createHash("sha256").update(sql).digest("hex") });
    }
    // Validate the entire applied history before attempting any further mutation.
    for (const row of existing) {
      if (row.status !== "applied") throw new Error(`Migration ${row.version} is incomplete. Inspect MySQL and repair it manually before continuing.`);
      if (sources.get(row.version)?.checksum !== row.checksum) throw new Error(`Applied migration ${row.version} was changed or removed. Restore the original file.`);
    }
    const applied = new Set(existing.map((row) => String(row.version)));
    const latest = existing.at(-1)?.version ?? "";
    for (const [file, { sql, checksum }] of sources) {
      if (applied.has(file)) continue;
      if (file < latest) throw new Error("New migrations must be appended after the latest applied version.");
      // MySQL DDL implicitly commits. Persist an applying marker rather than claim rollback safety.
      // Each SQL file contains exactly one statement; multipleStatements stays disabled.
      await connection.execute("INSERT INTO rems_schema_migrations (version, checksum, status) VALUES (?, ?, 'applying')", [file, checksum]);
      await connection.query(sql);
      await connection.execute("UPDATE rems_schema_migrations SET status = 'applied', applied_at = CURRENT_TIMESTAMP(3) WHERE version = ?", [file]);
      console.log(`Applied ${file}`);
    }
    console.log("Database migrations are up to date.");
  } finally {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lock]).catch(() => {});
    await connection.end();
  }
}
