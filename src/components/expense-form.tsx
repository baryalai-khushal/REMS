"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CATEGORIES, type Expense } from "@/lib/expense-input";
import { MONTHS, monthDays, parseShamsiDate, periodKey } from "@/lib/shamsi";

type Availability = { allowed: boolean; message: string };
export function ExpenseForm({ initial, today, requestKey, availability }: {
  initial?: Expense; today: string; requestKey: string; availability: Availability;
}) {
  const router = useRouter();
  const [year, setYear] = useState((initial?.expenseDate ?? today).slice(0, 4));
  const [month, setMonth] = useState((initial?.expenseDate ?? today).slice(5, 7));
  const [day, setDay] = useState((initial?.expenseDate ?? today).slice(8, 10));
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Other");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const expenseDate = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = parseShamsiDate(expenseDate);
  const key = parsed ? periodKey(parsed) : null;
  const initialKey = initial?.periodKey ?? periodKey(parseShamsiDate(today)!);
  const [period, setPeriod] = useState({ ...availability, key: initialKey });
  const checking = key !== null && period.key !== key;

  useEffect(() => {
    if (key === null || key === period.key) return;
    const controller = new AbortController();
    fetch(`/api/periods?year=${Math.floor(key / 100)}&month=${key % 100}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to check the accounting month.");
        setPeriod({ ...result, key });
      }).catch((problem) => {
        if (!controller.signal.aborted) setPeriod({ key, allowed: false, message: problem instanceof Error ? problem.message : "Unable to check the accounting month. Reload to try again." });
      });
    return () => controller.abort();
  }, [key, period.key]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(""); setFields({});
    try {
      const body = new URLSearchParams({ amount, expenseDate, category, description, requestKey });
      if (initial) { body.set("action", "update"); body.set("version", String(initial.version)); }
      const response = await fetch(initial ? `/api/expenses/${initial.id}` : "/api/expenses", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) { setFields(result.fields ?? {}); throw new Error(result.error ?? "Unable to save expense."); }
      const savedKey = result.expense.periodKey as number;
      router.push(`/expenses?year=${Math.floor(savedKey / 100)}&month=${savedKey % 100}&success=${initial ? "updated" : "created"}`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to save expense. Please retry; the same submission will not be recorded twice.");
      setPending(false);
    }
  }
  const fieldError = (name: string) => fields[name] && <span className="field-error" id={`${name}-error`}>{fields[name]}</span>;
  const blocked = !parsed || checking || !period.allowed || Boolean(initial && !availability.allowed);

  return <form onSubmit={submit} className="stack expense-form">
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <label htmlFor="amount">Amount (AFN)
      <input id="amount" name="amount" inputMode="decimal" placeholder="e.g. 125.50" value={amount} onChange={(e) => setAmount(e.target.value)} required maxLength={15} aria-invalid={Boolean(fields.amount)} aria-describedby={fields.amount ? "amount-error" : undefined} />{fieldError("amount")}
    </label>
    <fieldset><legend>Expense date · Hijri Shamsi</legend><div className="date-fields">
      <label htmlFor="expense-day">Day<select id="expense-day" value={Number(day)} onChange={(e) => setDay(e.target.value)}>{Array.from({ length: monthDays(Number(year), Number(month)) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
      <label htmlFor="expense-month">Month<select id="expense-month" value={Number(month)} onChange={(e) => setMonth(e.target.value)}>{MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
      <label htmlFor="expense-year">Year<input id="expense-year" type="number" min="1" max="3177" value={year} onChange={(e) => setYear(e.target.value)} required /></label>
    </div><p className="field-help date-help">Today defaults to Kabul local time. If you change month, check the day.</p>
      {!parsed && <p className="field-error" role="alert">This Shamsi date does not exist. Choose a valid day.</p>}{fieldError("expenseDate")}
    </fieldset>
    <p className={`notice ${!checking && !period.allowed ? "notice-error" : ""}`} role="status">{checking ? "Checking accounting month…" : period.message}</p>
    {initial && !availability.allowed && <p className="notice notice-error">The original expense month is locked. Changing the date cannot unlock this expense.</p>}
    <label htmlFor="category">Category<select id="category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>{CATEGORIES.map((name) => <option key={name}>{name}</option>)}</select>{fieldError("category")}</label>
    <label htmlFor="description">Description<textarea id="description" value={description} rows={3} maxLength={200} onChange={(e) => setDescription([...e.target.value].slice(0, 100).join(""))} aria-describedby="description-count" aria-invalid={Boolean(fields.description)} />
      <span className="field-help" id="description-count" aria-live="polite">{[...description].length}/100 characters</span>{fieldError("description")}
    </label>
    <div className="form-actions"><button type="submit" disabled={pending || blocked}>{pending ? "Saving…" : initial ? "Save changes" : "Add expense"}</button><Link href="/expenses">Cancel</Link></div>
  </form>;
}
