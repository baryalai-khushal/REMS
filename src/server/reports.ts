import "server-only";
import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { currentUser } from "./auth";
import { db } from "./database";
import { readMonth } from "./settlements";
import { amountToMinor, minorToAmount } from "./allocation-engine";
import { ExpenseError, monthFilter, positiveId } from "../lib/expense-input";
import type { MonthlyReport, ReportParticipant, ReportSelection } from "../lib/report-types";

// Every reader (HTML, JSON, Word) uses one repeatable-read, read-only snapshot.
// Full-month balances deliberately use fullLedger, not the departure funding cutoff.
export async function monthlyReport(params: URLSearchParams, access: "personal" | "admin", download = false): Promise<ReportSelection> {
  const actor = await currentUser();
  if (!actor) throw new ExpenseError("Authentication required.", 401);
  if ((access === "admin" || download) && actor.role !== "admin") throw new ExpenseError("Admin access required.", 403);
  const { year, month, key } = monthFilter(params);
  const requestedScope = params.get("scope") ?? "";
  if (requestedScope && requestedScope !== "room" && requestedScope !== "person") throw new ExpenseError("Choose Entire Room or Individual Person.");
  const scope = access === "personal" ? "person" : requestedScope as "room" | "person" | "";
  const requestedId = params.has("userId") ? positiveId(params.get("userId")!, "roommate") : undefined;
  if (access === "personal" && (requestedScope === "room" || (requestedId !== undefined && requestedId !== actor.id))) throw new ExpenseError("Only your own personal report is available.", 403);
  const userId = access === "personal" ? actor.id : scope === "person" ? requestedId : undefined;
  const connection = await db().getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await connection.beginTransaction();
    const [periods] = await connection.execute<RowDataPacket[]>("SELECT status FROM rems_accounting_periods WHERE period_key = ?", [key]);
    const [rosters] = await connection.execute<RowDataPacket[]>("SELECT period_key FROM rems_participation_rosters WHERE period_key = ?", [key]);
    const confirmed = rosters.length === 1;
    const selection: ReportSelection = { year, month, scope, userId, report: null };
    if (access === "admin") {
      const [candidates] = await connection.execute<RowDataPacket[]>(
        `SELECT u.id, u.username, u.deactivated_at FROM rems_users u WHERE ? = 0
         OR EXISTS (SELECT 1 FROM rems_period_participants p WHERE p.period_key = ? AND p.user_id = u.id)
         OR EXISTS (SELECT 1 FROM rems_expenses e WHERE e.period_key = ? AND e.user_id = u.id)
         ORDER BY u.id`, [confirmed ? 1 : 0, key, key],
      );
      selection.candidates = candidates.map((u) => ({ id: u.id, username: u.username, deactivated: u.deactivated_at !== null }));
    }
    if (!scope || (scope === "person" && !userId)) {
      if (download) throw new ExpenseError("Select the report type and roommate before downloading.");
      await connection.commit(); return selection;
    }
    let subject: MonthlyReport["subject"];
    if (scope === "person") {
      const [users] = await connection.execute<RowDataPacket[]>("SELECT u.id, u.username, u.deactivated_at, m.leaves_on FROM rems_users u LEFT JOIN rems_memberships m ON m.user_id = u.id WHERE u.id = ?", [userId!]);
      if (!users.length) throw new ExpenseError("Roommate not found.", 404);
      subject = { userId: users[0].id, username: users[0].username, deactivated: users[0].deactivated_at !== null, leavesOn: users[0].leaves_on };
    }
    const [expenses] = await connection.execute<RowDataPacket[]>(
      `SELECT e.id, e.expense_date, e.category, e.description, e.amount, u.username FROM rems_expenses e
       JOIN rems_users u ON u.id = e.user_id WHERE e.period_key = ? AND e.deleted_at IS NULL${scope === "person" ? " AND e.user_id = ?" : ""}
       ORDER BY e.expense_date, e.id`, scope === "person" ? [key, userId!] : [key],
    );
    const status: MonthlyReport["status"] = periods[0]?.status ?? "untracked";
    const report: MonthlyReport = {
      scope, year, month, period: key, status,
      statusLabel: status === "open" ? "Open — provisional monthly figures" : status === "settling" ? "Settling — frozen monthly allocations" : status === "closed" ? "Closed — finalized and fully settled" : "Not yet enabled — no finalized accounting period",
      rosterConfirmed: confirmed, ...(subject ? { subject } : {}),
      expenses: expenses.map((e) => ({ id: e.id, date: e.expense_date, category: e.category, description: e.description, amount: e.amount, ...(scope === "room" ? { paidBy: e.username } : {}) })),
      spending: minorToAmount(expenses.reduce((sum, e) => sum + amountToMinor(e.amount), BigInt(0))), snapshot: "",
    };
    if (!confirmed) {
      const [ledger] = await connection.execute<RowDataPacket[]>("SELECT id FROM rems_settlement_ledger WHERE period_key = ? LIMIT 1", [key]);
      if (ledger.length) throw new ExpenseError("Unconfirmed participation conflicts with existing settlement history; recovery review is required.", 409);
      if (status !== "untracked") report.statusLabel = `${status[0].toUpperCase()}${status.slice(1)} — participation unconfirmed; calculated figures unavailable`;
      report.financialMessage = "Roommates must be confirmed. Allocated shares and balances are unavailable.";
    } else {
      const value = await readMonth(connection, key);
      const [accounts] = await connection.execute<RowDataPacket[]>("SELECT u.id, u.deactivated_at FROM rems_users u JOIN rems_period_participants p ON p.user_id = u.id WHERE p.period_key = ?", [key]);
      const people: ReportParticipant[] = value.fullLedger.participants.map((p) => ({ ...p, leavesOn: value.data.members.find((m) => m.userId === p.userId)?.leavesOn ?? null, deactivated: (accounts.find((a) => a.id === p.userId)?.deactivated_at ?? null) !== null }));
      if (scope === "room") {
        if (report.spending !== value.allocations.totals.spending) throw new ExpenseError("Report expense totals do not match the allocation snapshot.", 409);
        report.participants = people;
        report.fund = { collections: value.fullLedger.collections, payouts: value.fullLedger.payouts, cash: value.fullLedger.cash };
      } else {
        report.personal = people.find((p) => p.userId === userId);
        if (report.personal && report.personal.spending !== report.spending) throw new ExpenseError("Personal report spending does not match the allocation snapshot.", 409);
        if (!report.personal) report.financialMessage = "This account is not a confirmed participant in this month. Allocated share and balance are unavailable.";
        const history = value.history.filter((e) => e.userId === userId);
        const reversed = new Set(history.filter((e) => e.reversalOf !== null).map((e) => e.reversalOf));
        report.history = history.map((e) => ({ id: e.id, date: e.paymentDate, direction: e.direction, amount: e.amount, reversalOf: e.reversalOf, reversed: reversed.has(e.id) }));
      }
    }
    report.snapshot = createHash("sha256").update(JSON.stringify(report)).digest("hex");
    if (params.has("snapshot") && params.get("snapshot") !== report.snapshot) throw new ExpenseError("This report changed after preview. Refresh the report and review it before downloading.", 409);
    await connection.commit(); selection.report = report; return selection;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
