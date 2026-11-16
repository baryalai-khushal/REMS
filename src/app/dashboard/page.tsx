import Link from "next/link";
import { requireUser } from "@/server/auth";
import { AppShell } from "@/components/app-shell";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  return <AppShell user={user}>
    <p className="eyebrow">Room workspace</p><h1>Welcome, {user.username}.</h1><p className="lead">Your shared room starts here.</p>
    {denied && <p className="notice notice-error" role="alert">Admin access is required for that page.</p>}
    <div className="card-grid">
      <section className="card"><span className="tag">Actual payments</span><h2>Monthly settlement</h2><p>View confirmed payments and your outstanding amount.</p><Link className="text-link" href="/settlements">My settlements →</Link>{user.role === "admin" && <><br /><Link className="text-link" href="/admin/settlements">Manage settlement fund →</Link></>}</section>
      <section className="card"><span className="tag">Provisional allocation</span><h2>Monthly balance preview</h2><p>See your spending, allocated share, and initial amount to pay or receive.</p><Link className="text-link" href="/balances">View my preview →</Link>{user.role === "admin" && <><br /><Link className="text-link" href="/admin/balances">View room previews →</Link></>}</section>
      <section className="card"><span className="tag">Personal spending</span><h2>Your expenses</h2><p>Record what you paid and view your Shamsi monthly history.</p><Link className="text-link" href="/expenses/new">Add expense →</Link><br /><Link className="text-link" href="/expenses">View My Expenses →</Link></section>
      <section className="card"><span className="tag">{user.role === "admin" ? "Admin" : "Roommate"}</span><h2>Your account</h2><p>View your username and access level.</p><Link className="text-link" href="/account">Open my account →</Link></section>
      {user.role === "admin" && <section className="card"><span className="tag">Room administration</span><h2>Roommates</h2><p>Create a private sign-in for each roommate.</p><Link className="text-link" href="/admin/users">Manage accounts →</Link></section>}
    </div>
    <section className="quiet-panel"><h2>Keep your room spending organized</h2><p>Review monthly allocations, record actual payments through the room fund, and close a month only after everyone and the fund are balanced.</p></section>
  </AppShell>;
}
