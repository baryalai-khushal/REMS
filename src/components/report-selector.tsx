"use client";
import { useState } from "react";
import { MONTHS } from "@/lib/shamsi";
import type { ReportSelection } from "@/lib/report-types";

export function ReportSelector({ selection, admin }: { selection: ReportSelection; admin: boolean }) {
  const [scope, setScope] = useState(selection.scope), [pending, setPending] = useState(false);
  return <form method="get" action={admin ? "/admin/reports" : "/reports"} className="filter-form report-selector" onSubmit={() => setPending(true)}>
    {admin && <><label>Report type<select name="scope" required value={scope} onChange={(e) => setScope(e.target.value as "room" | "person")}><option value="">Choose report type</option><option value="room">Entire Room</option><option value="person">Individual Person</option></select></label>
      {scope === "person" && <label>Roommate<select name="userId" required defaultValue={selection.userId ?? ""}><option value="">Choose roommate</option>{selection.candidates?.map((p) => <option key={p.id} value={p.id}>{p.username}{p.deactivated ? " (deactivated)" : ""}</option>)}</select></label>}</>}
    <label>Shamsi year<input name="year" type="number" min="1" max="3177" required defaultValue={selection.year} /></label>
    <label>Shamsi month<select name="month" aria-label="Shamsi month" defaultValue={selection.month}>{MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
    <button disabled={pending}>{pending ? "Loading report…" : "View report"}</button>
  </form>;
}
export function PrintReport() { return <button className="button-secondary" type="button" onClick={() => window.print()}>Print A4 preview</button>; }
