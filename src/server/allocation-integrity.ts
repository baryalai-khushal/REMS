import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { ExpenseError } from "../lib/expense-input";

// Settlement locks accounting first, writes complete snapshots atomically,
// then changes period state. This guard also preserves future departure freezes.
export async function guardFrozenDates(connection: PoolConnection, dates: { periodKey: number; expenseDate: string }[]) {
  for (const date of dates) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT through_date FROM rems_allocation_freezes WHERE period_key = ? ORDER BY through_date DESC FOR UPDATE", [date.periodKey],
    );
    if (rows.some((row) => date.expenseDate <= row.through_date)) {
      throw new ExpenseError("This expense date is inside finalized historical allocations. Backdated additions, edits, and deletions are blocked.", 409);
    }
  }
}
