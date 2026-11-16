import Link from "next/link";
export default function ExpenseNotFound() {
  return <main className="content"><section className="card narrow"><h1>Expense not found</h1><p>The expense is unavailable or belongs to another person.</p><Link href="/expenses">Back to My Expenses</Link></section></main>;
}
