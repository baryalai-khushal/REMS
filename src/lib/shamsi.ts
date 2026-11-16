import { isValidJalaaliDate, jalaaliMonthLength, toJalaali } from "jalaali-js";

export const MONTHS = ["Hamal", "Sawr", "Jawza", "Saratan", "Asad", "Sonbola", "Mizan", "Aqrab", "Qaws", "Jadi", "Dalwa", "Hoot"] as const;
export type ShamsiDate = { year: number; month: number; day: number };
export const dateString = ({ year, month, day }: ShamsiDate) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
export const periodKey = ({ year, month }: Pick<ShamsiDate, "year" | "month">) => year * 100 + month;

export function validMonth(year: number, month: number) {
  return Number.isInteger(year) && year >= 1 && year <= 3177 && Number.isInteger(month) && month >= 1 && month <= 12;
}
export function monthDays(year: number, month: number) {
  return validMonth(year, month) ? jalaaliMonthLength(year, month) : 31;
}
export function parseShamsiDate(value: string): ShamsiDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return validMonth(year, month) && isValidJalaaliDate(year, month, day) ? { year, month, day } : null;
}
export function todayShamsi(instant = new Date()): ShamsiDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kabul", calendar: "gregory", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(instant);
  const part = (name: string) => Number(parts.find((entry) => entry.type === name)!.value);
  const { jy, jm, jd } = toJalaali(part("year"), part("month"), part("day"));
  return { year: jy, month: jm, day: jd };
}
export function formatShamsi(value: string) {
  const date = parseShamsiDate(value);
  if (!date) throw new Error("Invalid Shamsi date.");
  return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}
export function formatPeriod(key: number) {
  return `${MONTHS[key % 100 - 1]} ${Math.floor(key / 100)}`;
}
