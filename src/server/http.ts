import "server-only";
import { NextResponse } from "next/server";
import { appOrigin } from "./auth";

export function sameOrigin(request: Request) {
  return request.headers.get("origin") === appOrigin() && request.headers.get("sec-fetch-site") !== "cross-site";
}
export function go(path: string) {
  const response = NextResponse.redirect(new URL(path, appOrigin()), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function readForm(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") throw new Error("Invalid form.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing form.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); throw new Error("Form is too large."); }
    chunks.push(value);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
export function logFailure(operation: string, error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
  console.error(`${operation} failed (${code}).`);
}
