import { migrate } from "./migrations";
migrate().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
  console.error(code ? `Migration failed (${code}). Check the MySQL configuration.` : error instanceof Error ? error.message : "Migration failed.");
  process.exitCode = 1;
});
