import "server-only";
import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { currentUser } from "./auth";
import { db } from "./database";
import { guardPeriod, lockAccounting, periodAvailability } from "./periods";
import { guardFrozenDates } from "./allocation-integrity";
import { guardExpenseParticipation } from "./participation";
import { ExpenseError, monthFilter, positiveId, validateExpense, type Expense } from "../lib/expense-input";

const columns = `e.id, e.user_id, e.amount, e.expense_date, e.period_key, e.category,
  e.description, e.version, e.created_at, e.updated_at, e.deleted_at`;

function expenseDTO(row: RowDataPacket): Expense {
  return {
    id: row.id, userId: row.user_id, amount: row.amount, expenseDate: row.expense_date,
    periodKey: row.period_key, category: row.category, description: row.description,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
    ...(row.username !== undefined ? { username: row.username } : {}),
  };
}
async function actor() {
  const user = await currentUser();
  if (!user) throw new ExpenseError("Authentication required.", 401);
  return user;
}

export async function ownExpense(rawId: string) {
  const user = await actor();
  const id = positiveId(rawId);
  const [rows] = await db().execute<RowDataPacket[]>(
    `SELECT ${columns} FROM rems_expenses e WHERE e.id = ? AND e.user_id = ? AND e.deleted_at IS NULL`, [id, user.id],
  );
  if (!rows.length) throw new ExpenseError("Expense not found.", 404);
  return expenseDTO(rows[0]);
}

export async function expenseHistory(params: URLSearchParams, review = false) {
  const user = await actor();
  if (review && user.role !== "admin") throw new ExpenseError("Admin access required.", 403);
  const { year, month, key } = monthFilter(params);
  const page = params.has("page") ? Number(params.get("page")) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new ExpenseError("Invalid page.");
  const userId = review ? (params.get("userId") ? positiveId(params.get("userId")!, "roommate") : null) : user.id;
  const where = `e.period_key = ? AND e.deleted_at IS NULL${userId !== null ? " AND e.user_id = ?" : ""}`;
  const values = userId !== null ? [key, userId] : [key];
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT ${columns}${review ? ", u.username" : ""} FROM rems_expenses e
       ${review ? "JOIN rems_users u ON u.id = e.user_id" : ""} WHERE ${where}
       ORDER BY e.expense_date DESC, e.id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`, values,
    );
    const [totals] = await connection.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(e.amount), 0.00) AS total, COUNT(*) AS count FROM rems_expenses e WHERE ${where}`, values,
    );
    const availability = await periodAvailability(key, connection);
    await connection.commit();
    return {
      expenses: rows.map(expenseDTO), total: String(totals[0].total), count: Number(totals[0].count),
      page, pages: Math.max(1, Math.ceil(Number(totals[0].count) / 50)), year, month,
      availability,
    };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

type Action = "create" | "update" | "delete";
export async function mutateExpense(action: Action, form: URLSearchParams, rawId?: string) {
  const user = await actor();
  const requestKey = form.get("requestKey") ?? "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestKey)) {
    throw new ExpenseError("A valid submission key is required. Reload the form.");
  }
  const id = action === "create" ? null : positiveId(rawId ?? "");
  const version = action === "create" ? null : positiveId(form.get("version") ?? "", "expense version");
  const data = action === "delete" ? null : validateExpense(form);
  const payloadHash = createHash("sha256").update(JSON.stringify({ action, id, version, data })).digest("hex");
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const first = await lockAccounting(connection);
    const [active] = await connection.execute<RowDataPacket[]>("SELECT id FROM rems_users WHERE id = ? AND deactivated_at IS NULL FOR SHARE", [user.id]);
    if (!active.length) throw new ExpenseError("Authentication required.", 401);
    const [requests] = await connection.execute<RowDataPacket[]>(
      "SELECT payload_hash, result FROM rems_expense_requests WHERE actor_id = ? AND request_key = ?", [user.id, requestKey],
    );
    if (requests.length) {
      if (requests[0].payload_hash !== payloadHash) throw new ExpenseError("This submission key was already used for a different change. Reload the form.", 409);
      await connection.commit();
      return { expense: requests[0].result as Expense, replayed: true };
    }
    let before: Expense | null = null;
    let expenseId = id;
    if (id !== null) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT ${columns} FROM rems_expenses e WHERE e.id = ? AND e.user_id = ? AND e.deleted_at IS NULL FOR UPDATE`, [id, user.id],
      );
      if (!rows.length) throw new ExpenseError("Expense not found.", 404);
      before = expenseDTO(rows[0]);
      if (before.version !== version) throw new ExpenseError("This expense has changed. Reload it before saving or deleting.", 409);
    }
    const months = new Set([...(before ? [before.periodKey] : []), ...(data ? [data.periodKey] : [])]);
    for (const month of [...months].sort((a, b) => a - b)) await guardPeriod(connection, first, month);
    await guardFrozenDates(connection, [...(before ? [before] : []), ...(data ? [data] : [])]);
    if (data) await guardExpenseParticipation(connection, user.id, data.expenseDate);

    if (action === "create" && data) {
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO rems_expenses (user_id, amount, expense_date, period_key, category, description)
         VALUES (?, ?, ?, ?, ?, ?)`, [user.id, data.amount, data.expenseDate, data.periodKey, data.category, data.description],
      );
      expenseId = insert.insertId;
    } else if (action === "update" && data) {
      await connection.execute(
        `UPDATE rems_expenses SET amount = ?, expense_date = ?, period_key = ?, category = ?, description = ?,
         version = version + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ?`,
        [data.amount, data.expenseDate, data.periodKey, data.category, data.description, id, user.id],
      );
    } else if (action === "delete") {
      await connection.execute(
        `UPDATE rems_expenses SET deleted_at = CURRENT_TIMESTAMP(3), version = version + 1,
         updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ?`, [id, user.id],
      );
    }
    const [afterRows] = await connection.execute<RowDataPacket[]>(`SELECT ${columns} FROM rems_expenses e WHERE e.id = ?`, [expenseId]);
    const after = expenseDTO(afterRows[0]);
    await connection.execute(
      "INSERT INTO rems_expense_audit (expense_id, actor_id, action, before_values, after_values) VALUES (?, ?, ?, ?, ?)",
      [expenseId, user.id, action, before ? JSON.stringify(before) : null, JSON.stringify(after)],
    );
    await connection.execute(
      "INSERT INTO rems_expense_requests (actor_id, request_key, payload_hash, expense_id, result) VALUES (?, ?, ?, ?, ?)",
      [user.id, requestKey, payloadHash, expenseId, JSON.stringify(after)],
    );
    await connection.commit();
    return { expense: after, replayed: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
