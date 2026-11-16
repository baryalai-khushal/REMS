"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPeriod } from "@/lib/shamsi";

export function ParticipationSetup({ revision, candidates, confirmed, members, period = 140508 }: {
  revision: string; candidates: { id: number; username: string; expenseCount: number }[];
  confirmed: boolean; members: number[]; period?: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const body = new URLSearchParams({ period: String(period), acknowledge: "confirm", revision });
      for (const id of selected) body.append("participantId", String(id));
      const response = await fetch("/api/admin/participation", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Roommates could not be confirmed.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to confirm roommates. Retry the same selection.");
      setPending(false);
    }
  }
  if (confirmed) return <section className="card narrow"><p className="notice" role="status">Participating roommates are confirmed for {formatPeriod(period)}.</p><ul>{candidates.filter((person) => members.includes(person.id)).map((person) => <li key={person.id}>{person.username}</li>)}</ul><p className="help-text">This historical roster is fixed. Creating another account does not change it. Arrival and temporary-absence policies have not been defined.</p></section>;

  return <section className="card expense-editor">
    <h2>{reviewing ? "Review before confirming" : period === 140508 ? "Who participated from 1 Aqrab 1405?" : `Confirm continuing roommates for ${formatPeriod(period)}`}</h2>
    <p>{period === 140508 ? "Select every initial participating roommate, including people who spent nothing. Include the admin only if they lived in the room. Account creation dates do not establish residence." : "Explicitly reconfirm every eligible continuing roommate below. Use Departures for a leaving roommate; arrivals and temporary absences remain unsupported."}</p>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {!reviewing ? <form className="stack" onSubmit={(event) => { event.preventDefault(); setError(""); setReviewing(true); }}>
      <fieldset><legend>{period === 140508 ? "Initial participating roommates" : "Continuing participating roommates"}</legend>{candidates.map((person) => <label className="checkbox-row" key={person.id}>
        <input type="checkbox" checked={selected.includes(person.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, person.id] : selected.filter((id) => id !== person.id))} />
        <span>{person.username}<small className="muted">{person.expenseCount} existing non-deleted expense{person.expenseCount === 1 ? "" : "s"}</small></span>
      </label>)}</fieldset><button type="submit" disabled={!selected.length}>Review selected roommates</button>
    </form> : <div className="stack">
      <ul>{candidates.filter((person) => selected.includes(person.id)).map((person) => <li key={person.id}>{person.username}</li>)}</ul>
      <p className="notice">Confirm these historical participants, accounting for finalized inclusive leaving dates. Arrivals and temporary absences are not supported.</p>
      <div className="form-actions"><button type="button" disabled={pending} onClick={confirm}>{pending ? "Confirming…" : "Confirm these roommates"}</button><button type="button" className="button-secondary" disabled={pending} onClick={() => setReviewing(false)}>Back to selection</button></div>
    </div>}
  </section>;
}
