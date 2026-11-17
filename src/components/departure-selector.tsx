"use client";
import { useState } from "react";
import { MONTHS, monthDays } from "@/lib/shamsi";
export function DepartureSelector({ candidates, selected = "", date }: {
  candidates: { id: number; username: string; role: string; leavesOn: string | null; active: boolean }[];
  selected?: string; date: string;
}) {
  const [year, setYear] = useState(date.slice(0, 4)), [month, setMonth] = useState(date.slice(5, 7)), [day, setDay] = useState(date.slice(8, 10));
  const [pending, setPending] = useState(false);
  return <form method="get" action="/admin/departures" className="stack expense-form" onSubmit={() => setPending(true)}>
    <label>Roommate<select name="userId" required defaultValue={selected} onChange={(event) => {
      const leaving = candidates.find((c) => String(c.id) === event.target.value)?.leavesOn;
      if (leaving) { setYear(leaving.slice(0, 4)); setMonth(leaving.slice(5, 7)); setDay(leaving.slice(8, 10)); }
    }}><option value="">Select a roommate</option>{candidates.map((c) => <option key={c.id} value={c.id} disabled={c.role === "admin"}>{c.username}{c.role === "admin" ? " (sole admin)" : !c.active ? " (deactivated)" : ""}</option>)}</select></label>
    <fieldset><legend>Inclusive leaving date · Hijri Shamsi</legend><div className="date-fields">
      <label>Day<select value={Number(day)} onChange={(e) => setDay(e.target.value)}>{Array.from({ length: monthDays(Number(year), Number(month)) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      <label>Month<select value={Number(month)} onChange={(e) => { setMonth(e.target.value); setDay(String(Math.min(Number(day), monthDays(Number(year), Number(e.target.value))))); }}>{MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
      <label>Year<input type="number" min="1" max="3177" value={year} onChange={(e) => { setYear(e.target.value); setDay(String(Math.min(Number(day), monthDays(Number(e.target.value), Number(month))))); }} required /></label>
    </div></fieldset>
    <input type="hidden" name="leavesOn" value={`${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`} />
    <button disabled={pending}>{pending ? "Reviewing…" : "Review departure"}</button>
  </form>;
}
