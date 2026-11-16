import { requireUser } from "@/server/auth";
import { AppShell } from "@/components/app-shell";

export default async function Account() {
  const user = await requireUser();
  return <AppShell user={user}><p className="eyebrow">Your workspace</p><h1>My account</h1><p className="lead">Your private account details.</p>
    <section className="card narrow"><dl className="details"><div><dt>Username</dt><dd>{user.username}</dd></div><div><dt>Access level</dt><dd>{user.role === "admin" ? "Admin" : "Roommate"}</dd></div></dl><p className="help-text">Sign out when using a shared device. Sessions expire after seven days.</p></section>
  </AppShell>;
}
