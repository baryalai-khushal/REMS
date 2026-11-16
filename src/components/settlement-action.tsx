"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function SettlementAction({ values, requestKey, label, confirmation, confirmationName = "acknowledge", confirmationValue, disabled = false, children, endpoint = "/api/admin/settlements" }: {
  values: Record<string, string>; requestKey: string; label: string; confirmation: string;
  confirmationName?: string; confirmationValue: string; disabled?: boolean; children?: ReactNode; endpoint?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const form = event.currentTarget;
    const body = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (typeof value === "string") body.append(key, value);
    for (const [key, value] of Object.entries(values)) body.set(key, value);
    body.set("requestKey", requestKey);
    setPending(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save settlement operation.");
      router.refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to save. Retry the same submission safely."); setPending(false); }
  }
  return <form onSubmit={submit} className="stack settlement-action">
    {children}
    <label className="checkbox-row"><input type="checkbox" name={confirmationName} value={confirmationValue} required disabled={pending || disabled} /><span>{confirmation}</span></label>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <button type="submit" disabled={pending || disabled}>{pending ? "Saving…" : label}</button>
  </form>;
}
