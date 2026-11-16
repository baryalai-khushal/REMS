import Link from "next/link";
import type { ReactNode } from "react";
import type { User } from "@/server/auth";

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="app-header">
      <Link className="brand" href="/dashboard"><span className="brand-mark">R</span><span>REMS<small>Our room, organized.</small></span></Link>
      <nav aria-label="Main navigation"><Link href="/dashboard">Overview</Link><Link href="/expenses/new">Add Expense</Link><Link href="/expenses">My Expenses</Link><Link href="/balances">My balance</Link><Link href="/settlements">My settlements</Link><Link href="/account">My account</Link>{user.role === "admin" && <><Link href="/admin/departures">Departures</Link><Link href="/admin/settlements">Settlement fund</Link><Link href="/admin/balances">Room balances</Link><Link href="/admin/participation">Participation</Link><Link href="/admin/expenses">Expense review</Link><Link href="/admin/users">Roommates</Link></>}</nav>
      <form action="/api/auth/logout" method="post"><button className="button-secondary" type="submit">Sign out</button></form>
    </header>
    <main id="main" className="content">{children}</main>
    <footer className="app-footer">Room Expense Management System <span>Kabul · One shared room</span></footer>
  </div>;
}
