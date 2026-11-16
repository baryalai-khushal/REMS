import { requireAdmin } from "@/server/auth";
import { listUsers } from "@/server/users";
import { AppShell } from "@/components/app-shell";

const messages: Record<string, string> = {
  created: "Roommate account created.", duplicate: "That username is already taken.",
  invalid: "Use a valid username and a password of exactly 8 characters.",
  unavailable: "The account could not be created. Please try again.",
};
export default async function Users({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await requireAdmin();
  const users = await listUsers();
  const { result } = await searchParams;
  return <AppShell user={user}><p className="eyebrow">Administration</p><h1>Roommate accounts</h1><p className="lead">Give each roommate their own private sign-in.</p>
    {result && messages[result] && <p role="status" className={`notice ${result === "created" ? "" : "notice-error"}`}>{messages[result]}</p>}
    <div className="admin-grid"><section className="card"><h2>In this room</h2><div className="table-scroll"><table><thead><tr><th>Username</th><th>Access</th></tr></thead><tbody>{users.map((member) => <tr key={member.id}><td>{member.username}{member.id === user.id && <span className="muted"> (you)</span>}</td><td><span className="tag">{member.role}</span></td></tr>)}</tbody></table></div></section>
      <section className="card"><h2>Add a roommate</h2><p className="muted">New accounts have roommate access.</p><form action="/api/admin/users" method="post" className="stack">
        <label htmlFor="username">Username<input id="username" name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} required aria-describedby="username-help" /></label>
        <p id="username-help" className="field-help">3–32 letters, numbers, dots, underscores, or hyphens. Starts with a letter or number. Case-insensitive.</p>
        <label htmlFor="password">Password<input id="password" name="password" type="password" autoComplete="new-password" maxLength={64} required aria-describedby="password-help" /></label><p id="password-help" className="field-help">Exactly 8 characters. Share it privately with your roommate.</p>
        <button type="submit">Create roommate account</button>
      </form></section></div>
  </AppShell>;
}
