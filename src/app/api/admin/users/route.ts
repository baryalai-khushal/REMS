import { currentUser } from "@/server/auth";
import { createRoommate, listUsers } from "@/server/users";
import { failure, go, logFailure, readForm, sameOrigin } from "@/server/http";

export async function GET() {
  const user = await currentUser();
  if (!user) return failure("Authentication required.", 401);
  if (user.role !== "admin") return failure("Admin access required.", 403);
  return Response.json(await listUsers(), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return failure("Invalid request origin.", 403);
  const user = await currentUser();
  if (!user) return failure("Authentication required.", 401);
  if (user.role !== "admin") return failure("Admin access required.", 403);
  let form: URLSearchParams;
  try { form = await readForm(request); } catch { return failure("Invalid form.", 400); }
  try {
    const result = await createRoommate(form.get("username") ?? "", form.get("password") ?? "");
    return go(`/admin/users?result=${result}`);
  } catch (error) {
    logFailure("Create roommate", error);
    return go("/admin/users?result=unavailable");
  }
}
