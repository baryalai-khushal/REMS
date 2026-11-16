import "server-only";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "./database";
import { ExpenseError } from "../lib/expense-input";
import { formatPeriod, periodKey, validMonth } from "../lib/shamsi";

export function followingPeriod(key: number) {
  const month = key % 100, year = Math.floor(key / 100);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  if (!validMonth(next.year, next.month)) throw new ExpenseError("The following month is outside the supported calendar range.", 409);
  return next.year * 100 + next.month;
}

// All expense writes and any future period transitions must acquire this singleton first.
// Row locks on periods also prevent a simultaneous status update from racing a write.
export async function lockAccounting(connection: PoolConnection) {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT first_period FROM rems_accounting_state WHERE id = 1 FOR UPDATE");
  if (!rows.length) throw new ExpenseError("Accounting setup is unavailable.", 503);
  return rows[0].first_period as number | null;
}

export async function initializePeriod(year: number, month: number) {
  if (!validMonth(year, month)) throw new ExpenseError("Choose a valid first Shamsi month.");
  const key = periodKey({ year, month });
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const first = await lockAccounting(connection);
    if (first !== null && first !== key) throw new ExpenseError("The first accounting month has already been initialized.", 409);
    if (first === null) {
      await connection.execute("INSERT INTO rems_accounting_periods (period_key, status) VALUES (?, 'open')", [key]);
      await connection.execute("UPDATE rems_accounting_state SET first_period = ? WHERE id = 1", [key]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function guardPeriod(connection: PoolConnection, first: number | null, key: number) {
  if (first === null) throw new ExpenseError("The admin must initialize the first accounting month before expenses can be recorded.", 409);
  if (key < first) throw new ExpenseError(`Accounting starts in ${formatPeriod(first)}. Earlier expenses cannot be recorded.`, 409);
  const [periods] = await connection.execute<RowDataPacket[]>(
    "SELECT period_key, status FROM rems_accounting_periods WHERE period_key <= ? ORDER BY period_key FOR UPDATE", [key],
  );
  const period = periods.find((row) => row.period_key === key);
  if (period && period.status !== "open") throw new ExpenseError(`${formatPeriod(key)} is ${period.status}; expense changes are blocked.`, 409);
  const blocking = periods.find((row) => row.period_key < key && row.status !== "closed");
  if (blocking) throw new ExpenseError(`${formatPeriod(blocking.period_key)} must be settled and closed before expenses can be recorded in ${formatPeriod(key)}.`, 409);
  if (!period) throw new ExpenseError("This month must be enabled by validated closure of the immediately preceding month.", 409);
}

export async function periodAvailability(key: number, connection: Pool | PoolConnection = db()) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT a.first_period,
      (SELECT status FROM rems_accounting_periods WHERE period_key = ?) AS status,
      (SELECT MIN(period_key) FROM rems_accounting_periods WHERE period_key < ? AND status <> 'closed') AS blocking,
      EXISTS(SELECT 1 FROM rems_participation_rosters WHERE period_key = 140508) AS initial_confirmed,
      EXISTS(SELECT 1 FROM rems_participation_rosters WHERE period_key = ?) AS month_confirmed
     FROM rems_accounting_state a WHERE a.id = 1`, [key, key, key],
  );
  const row = rows[0];
  if (!row || row.first_period === null) return { allowed: false, message: "The first accounting month has not been initialized. Contact your admin." };
  if (key < row.first_period) return { allowed: false, message: `Accounting starts in ${formatPeriod(row.first_period)}.` };
  if (row.status && row.status !== "open") return { allowed: false, message: `${formatPeriod(key)} is ${row.status}. Expense changes are blocked.` };
  if (row.blocking) return { allowed: false, message: `${formatPeriod(row.blocking)} must be settled and closed before entering expenses in ${formatPeriod(key)}.` };
  if (!row.status) return { allowed: false, message: "This month has not been enabled by validated closure of the preceding month." };
  if (row.initial_confirmed && !row.month_confirmed) return { allowed: false, message: "Roommates must be explicitly confirmed for this month before new expenses can be entered." };
  return { allowed: true, message: `${formatPeriod(key)} is open for expense recording.` };
}
