import { cookies } from "next/headers";
import { authenticate, COOKIE_NAME, createSession, sessionCookieOptions } from "@/server/auth";
import { failure, go, logFailure, readForm, sameOrigin } from "@/server/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return failure("Invalid request origin.", 403);
  let form: URLSearchParams;
  try { form = await readForm(request); } catch { return failure("Invalid form.", 400); }
  try {
    const user = await authenticate(form.get("username") ?? "", form.get("password") ?? "");
    if (user === "throttled") return go("/login?error=throttled");
    if (!user) return go("/login?error=credentials");
    const oldToken = (await cookies()).get(COOKIE_NAME)?.value;
    const token = await createSession(user.id, oldToken);
    const response = go("/dashboard");
    response.cookies.set(COOKIE_NAME, token, sessionCookieOptions());
    return response;
  } catch (error) {
    logFailure("Login", error);
    return go("/login?error=unavailable");
  }
}
