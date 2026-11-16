import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";

const errors: Record<string, string> = {
  credentials: "The username or password is incorrect.",
  throttled: "Too many attempts. Please try again in 15 minutes.",
  unavailable: "Sign-in is temporarily unavailable. Please try again shortly.",
};
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/dashboard");
  const { error } = await searchParams;
  return <main className="login-shell">
    <section className="login-intro">
      <div className="brand"><span className="brand-mark">R</span><span>REMS</span></div>
      <div><p className="eyebrow">A place for our room</p><h1>Shared living.<br />A little simpler.</h1><p>Welcome to your room workspace. Sign in with the account provided by your admin.</p></div>
      <p className="intro-footer">Kabul · Room Expense Management System</p>
    </section>
    <section className="login-panel" aria-labelledby="login-heading"><div className="login-card">
      <p className="eyebrow">Welcome back</p><h2 id="login-heading">Sign in to REMS</h2><p className="muted">Your room workspace is private.</p>
      {error && errors[error] && <p className="notice notice-error" role="alert">{errors[error]}</p>}
      <form action="/api/auth/login" method="post" className="stack">
        <label htmlFor="username">Username<input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={32} /></label>
        <label htmlFor="password">Password<input id="password" name="password" type="password" autoComplete="current-password" required maxLength={64} /></label>
        <button type="submit">Sign in</button>
      </form><p className="help-text">Need an account or help signing in? Contact your room admin.</p>
    </div></section>
  </main>;
}
