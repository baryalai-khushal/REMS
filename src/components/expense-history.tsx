import Link from "next/link";
import { ExpenseError, formatAFN } from "@/lib/expense-input";
import { formatPeriod, periodKey, todayShamsi } from "@/lib/shamsi";
import { expenseHistory } from "@/server/expenses";
import { listUsers } from "@/server/users";
import { ExpenseFilters } from "./expense-filters";
import { ExpenseTable } from "./expense-table";

export async function ExpenseHistory({ params, review = false }: { params: URLSearchParams; review?: boolean }) {
  let history;
  try { history = await expenseHistory(params, review); }
  catch (error) {
    if (!(error instanceof ExpenseError) || error.status !== 400) throw error;
    const today = todayShamsi();
    return <><p className="notice notice-error" role="alert">{error.message}</p><ExpenseFilters year={today.year} month={today.month} review={review} users={review ? await listUsers() : []} /></>;
  }
  const success = params.get("success");
  const messages: Record<string, string> = { created: "Expense added.", updated: "Expense updated.", deleted: "Expense deleted. Its audit history has been preserved." };
  const pageLink = (page: number) => {
    const next = new URLSearchParams(params);
    next.delete("success"); next.set("year", String(history.year)); next.set("month", String(history.month)); next.set("page", String(page));
    return `${review ? "/admin/expenses" : "/expenses"}?${next}`;
  };
  return <>
    {!review && success && messages[success] && <p className="notice" role="status">{messages[success]}</p>}
    <section className="card"><ExpenseFilters year={history.year} month={history.month} review={review} userId={params.get("userId") ?? ""} users={review ? await listUsers() : []} /></section>
    <div className="history-summary"><div><p className="eyebrow">{formatPeriod(periodKey(history))}</p><h2>{review ? "Selected spending" : "Your personal spending"}</h2><p className="muted">{history.count} expense{history.count === 1 ? "" : "s"}</p></div><strong>{formatAFN(history.total)}</strong></div>
    <p className={`notice ${history.availability.allowed ? "" : "notice-error"}`}>{history.availability.message}</p>
    {review && <p className="muted">Review access only. Each person can change only their own expenses.</p>}
    <section className="card history-card"><ExpenseTable expenses={history.expenses} review={review} canChange={history.availability.allowed} /></section>
    {history.pages > 1 && <nav className="pagination" aria-label="Expense pages">{history.page > 1 && <Link href={pageLink(history.page - 1)}>Previous</Link>}<span>Page {history.page} of {history.pages}</span>{history.page < history.pages && <Link href={pageLink(history.page + 1)}>Next</Link>}</nav>}
  </>;
}
