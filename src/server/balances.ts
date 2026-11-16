import "server-only";
import { db } from "./database";
import { currentUser } from "./auth";
import { ExpenseError, monthFilter } from "../lib/expense-input";
import type { BalancePreview } from "../lib/balance-types";
import { loadAllocationData, checkedAllocations } from "./allocation-data";

export async function monthlyBalancePreview(params: URLSearchParams, room = false): Promise<BalancePreview> {
  const actor = await currentUser();
  if (!actor) throw new ExpenseError("Authentication required.", 401);
  if (room && actor.role !== "admin") throw new ExpenseError("Admin access required.", 403);
  const { year, month, key } = monthFilter(params);
  const connection = await db().getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.beginTransaction();
    const data = await loadAllocationData(connection, key);
    if (!data.confirmed) {
      await connection.commit();
      return { year, month, status: "unconfirmed", message: "Roommates must be confirmed", provisional: true };
    }
    const result = checkedAllocations(data);
    await connection.commit();
    const common = { year, month, provisional: data.periodStatus === "open", message: data.periodStatus === "open" ? "Provisional allocation preview. These amounts are not confirmed settlements." : "Frozen initial allocations. View Settlements for confirmed payments and outstanding balances." };
    if (room) return { ...common, status: "preview", participants: result.participants, totals: result.totals };
    const personal = result.participants.find((person) => person.userId === actor.id);
    if (!personal) return { ...common, status: "not-participating", message: "You are not a confirmed participant in this month." };
    return { ...common, status: "preview", personal };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
