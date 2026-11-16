"use client";
import { useState } from "react";
import { SettlementAction } from "./settlement-action";
import { MONTHS, monthDays } from "@/lib/shamsi";

export function SettlementPayment({ year, month, userId, direction, requestKey, today }: {
  year: number; month: number; userId: number; direction: "collection" | "payout"; requestKey: string; today: string;
}) {
  const [dateYear, setYear] = useState(today.slice(0, 4)), [dateMonth, setMonth] = useState(today.slice(5, 7)), [day, setDay] = useState(today.slice(8, 10));
  return <SettlementAction values={{ action: "payment", year: String(year), month: String(month), userId: String(userId), direction }} requestKey={requestKey} label={direction === "collection" ? "Record receipt" : "Record payout"} confirmationName="actualPayment" confirmationValue="confirm" confirmation={direction === "collection" ? "I confirm this money was actually received into the room fund." : "I confirm this money was actually paid from the room fund."}>
    <label>Amount (AFN)<input name="amount" inputMode="decimal" required maxLength={15} placeholder="Partial or full payment" /></label>
    <fieldset><legend>Actual payment date · Hijri Shamsi</legend><div className="date-fields">
      <label>Day<select value={Number(day)} onChange={(e) => setDay(e.target.value)}>{Array.from({ length: monthDays(Number(dateYear), Number(dateMonth)) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      <label>Month<select value={Number(dateMonth)} onChange={(e) => setMonth(e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
      <label>Year<input type="number" min="1" max="3177" value={dateYear} onChange={(e) => setYear(e.target.value)} required /></label>
    </div><input type="hidden" name="paymentDate" value={`${dateYear.padStart(4, "0")}-${dateMonth.padStart(2, "0")}-${day.padStart(2, "0")}`} /></fieldset>
    <label>Optional note<textarea name="note" maxLength={200} rows={2} /></label>
  </SettlementAction>;
}
