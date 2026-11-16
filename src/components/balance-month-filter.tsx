"use client";
import { useState } from "react";
import { MONTHS } from "@/lib/shamsi";

export function BalanceMonthFilter({ year, month, room, action }: { year: number; month: number; room: boolean; action?: string }) {
  const [pending, setPending] = useState(false);
  return <form method="get" action={action ?? (room ? "/admin/balances" : "/balances")} className="filter-form" onSubmit={() => setPending(true)}>
    <label htmlFor="balance-year">Shamsi year<input id="balance-year" type="number" name="year" min="1" max="3177" required defaultValue={year} /></label>
    <label htmlFor="balance-month">Month<select id="balance-month" name="month" defaultValue={month}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
    <button type="submit" disabled={pending}>{pending ? "Loading preview…" : "Show preview"}</button>
    {pending && <span role="status">Loading selected month…</span>}
  </form>;
}
