"use client";
import { useState } from "react";
import { MONTHS } from "@/lib/shamsi";

export function ExpenseFilters({ year, month, review = false, userId = "", users = [] }: {
  year: number; month: number; review?: boolean; userId?: string; users?: { id: number; username: string }[];
}) {
  const [loading, setLoading] = useState(false);
  return <form method="get" action={review ? "/admin/expenses" : "/expenses"} className="filter-form" onSubmit={() => setLoading(true)}>
    <label htmlFor="filter-year">Shamsi year<input id="filter-year" name="year" type="number" min="1" max="3177" defaultValue={year} required /></label>
    <label htmlFor="filter-month">Month<select id="filter-month" name="month" defaultValue={month}>{MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
    {review && <label htmlFor="filter-user">Roommate<select id="filter-user" name="userId" defaultValue={userId}><option value="">Everyone</option>{users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}</select></label>}
    <button type="submit" disabled={loading}>{loading ? "Loading…" : "Show expenses"}</button>
    {loading && <span role="status">Loading selected expenses…</span>}
  </form>;
}
