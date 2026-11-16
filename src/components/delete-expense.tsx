"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function DeleteExpense({ id, version, requestKey, periodKey, allowed }: { id: number; version: number; requestKey: string; periodKey: number; allowed: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/expenses/${id}`, {
        method: "POST", body: new URLSearchParams({ action: "delete", version: String(version), requestKey }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to delete expense.");
      router.push(`/expenses?year=${Math.floor(periodKey / 100)}&month=${periodKey % 100}&success=deleted`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to delete expense. Please retry.");
      setPending(false);
    }
  }
  return <div>{error && <p className="notice notice-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button-danger" disabled={pending || !allowed} onClick={remove}>{pending ? "Deleting…" : "Confirm deletion"}</button><Link href="/expenses">Keep expense</Link></div></div>;
}
