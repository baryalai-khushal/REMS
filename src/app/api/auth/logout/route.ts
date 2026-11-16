import { cookies } from "next/headers";
import { COOKIE_NAME, revokeSession, sessionCookieOptions } from "@/server/auth";
import { failure, go, logFailure, sameOrigin } from "@/server/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return failure("Invalid request origin.", 403);
  try {
    await revokeSession((await cookies()).get(COOKIE_NAME)?.value);
    const response = go("/login");
    response.cookies.set(COOKIE_NAME, "", { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    logFailure("Logout", error);
    return failure("Unable to sign out. Please try again.", 503);
  }
}
