import Link from "next/link";
import { formatShamsi } from "@/lib/shamsi";
import { formatAFN, type Expense } from "@/lib/expense-input";

export function ExpenseTable({ expenses, review = false, canChange = false }: { expenses: Expense[]; review?: boolean; canChange?: boolean }) {
  if (!expenses.length) return <div className="empty-state"><h2>No expenses in this selection</h2><p>{review ? "Choose another roommate or Shamsi month to review their expenses." : "Expenses you add for this Shamsi month will appear here."}</p></div>;
  return <div className="table-scroll"><table><caption className="sr-only">{review ? "Room expense review" : "Personal expense history"}</caption><thead><tr>
    <th>Date (Shamsi)</th>{review && <th>Paid by</th>}<th>Category</th><th>Description</th><th className="amount-cell">Amount</th>{!review && <th>Actions</th>}
  </tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id}>
    <td className="nowrap">{formatShamsi(expense.expenseDate)}</td>{review && <td>{expense.username}</td>}<td>{expense.category}</td><td className="description-cell">{expense.description || "—"}</td><td className="amount-cell nowrap">{formatAFN(expense.amount)}</td>
    {!review && <td>{canChange ? <div className="row-actions"><Link href={`/expenses/${expense.id}/edit`}>Edit</Link><Link href={`/expenses/${expense.id}/delete`}>Delete</Link></div> : <span className="muted">Read-only</span>}</td>}
  </tr>)}</tbody></table></div>;
}
