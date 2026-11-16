import "./env";
import { db } from "../src/server/database";
import { initializePeriod } from "../src/server/periods";
import { formatPeriod, periodKey } from "../src/lib/shamsi";
import { ExpenseError } from "../src/lib/expense-input";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--year" || args[2] !== "--month") {
    throw new ExpenseError("Usage: npm run period:init -- --year 1405 --month 8 (Hijri Shamsi)");
  }
  const year = Number(args[1]);
  const month = Number(args[3]);
  try {
    await initializePeriod(year, month);
    console.log(`First accounting month: ${formatPeriod(periodKey({ year, month }))}. Initial setup is complete; existing status is preserved.`);
  } finally { await db().end(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof ExpenseError ? error.message : "Accounting initialization failed. Check MySQL and run migrations first.");
  process.exitCode = 1;
});
