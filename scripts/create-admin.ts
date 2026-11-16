import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { bootstrapAdmin } from "./bootstrap";

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run admin setup in an interactive terminal. Passwords are never accepted as command arguments.");
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, callback) {
    if (!hidden) process.stdout.write(chunk);
    callback();
  } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  prompt.on("SIGINT", () => { hidden = false; prompt.close(); process.stdout.write("\nSetup cancelled.\n"); process.exitCode = 1; });
  try {
    const username = await prompt.question("Initial admin username: ");
    process.stdout.write("Password (exactly 8 characters, hidden): ");
    hidden = true;
    const password = await prompt.question("");
    process.stdout.write("\nConfirm password (hidden): ");
    const confirmation = await prompt.question("");
    hidden = false;
    process.stdout.write("\n");
    if (password !== confirmation) throw new Error("Passwords did not match. Nothing was created.");
    const created = await bootstrapAdmin(username, password);
    console.log(`Admin '${created}' created. You can now sign in.`);
  } finally { hidden = false; prompt.close(); }
}
main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
  console.error(code ? `Admin setup failed (${code}). Check the database and run migrations first.` : error instanceof Error ? error.message : "Admin setup failed.");
  process.exitCode = 1;
});
