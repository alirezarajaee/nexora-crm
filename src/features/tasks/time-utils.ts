"use client";

// Timezone-aware date helpers shared by the Deals / Tasks / Calendar views.
// The workspace timezone is authoritative: tasks are bucketed and rendered on
// workspace-tz calendar days (not browser-local), and datetime-local inputs are
// converted back to UTC ISO instants using the workspace offset.

import type { Locale, Priority } from "@/types/api";

/** Offset (ms) of `tz` at the given instant. Positive = ahead of UTC. */
function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - at.getTime();
}

/** Convert a wall-clock time in `tz` ("YYYY-MM-DDTHH:mm") to a UTC ISO string. */
export function zonedToIso(local: string, tz: string): string {
  const [datePart, timePart = "00:00"] = local.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh = 0, mm = 0] = timePart.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset2 = tzOffsetMs(tz, new Date(guess - tzOffsetMs(tz, new Date(guess))));
  return new Date(guess - offset2).toISOString();
}

/** Calendar day key ("YYYY-MM-DD") of an instant, observed from `tz`. */
export function zonedDayKey(value: string | Date, tz: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/** ISO instant for the start (local midnight) of a calendar day in `tz`. */
export function dayKeyToStartIso(key: string, tz: string): string {
  return zonedToIso(`${key}T00:00`, tz);
}

/** ISO instant for the start of the day AFTER a calendar day in `tz`. */
export function dayKeyToEndIso(key: string, tz: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nk = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return dayKeyToStartIso(nk, tz);
}

/** "YYYY-MM-DD" of today in `tz`. */
export function todayKey(tz: string): string {
  return zonedDayKey(new Date(), tz);
}

/** ISO instant for the start (midnight) of today in `tz`. */
export function todayStartIso(tz: string): string {
  return dayKeyToStartIso(todayKey(tz), tz);
}

/** ISO instant for the start of the day after today in `tz`. */
export function tomorrowStartIso(tz: string): string {
  return dayKeyToEndIso(todayKey(tz), tz);
}

/** Value for <input type="date"> representing an instant on a `tz` calendar. */
export function isoToDateInput(value: string | null | undefined, tz: string): string {
  if (!value) return "";
  const key = zonedDayKey(value, tz);
  return key || "";
}

/** Convert a <input type="date"> value to ISO at local noon (avoids day shifts). */
export function dateInputToIso(value: string, tz: string): string | null {
  if (!value) return null;
  return zonedToIso(`${value}T12:00`, tz);
}

/** Value for <input type="datetime-local"> for an instant in `tz`. */
export function isoToDateTimeInput(value: string | null | undefined, tz: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

/** Convert a <input type="datetime-local"> value to a UTC ISO instant in `tz`. */
export function dateTimeInputToIso(value: string, tz: string): string | null {
  if (!value) return null;
  return zonedToIso(value, tz);
}

/** "YYYY-MM-DD" calendar-date part of an ISO string (no tz conversion). */
export function isoDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

// ---- Calendar grid math (pure calendar dates, timezone-independent) ----

export interface CalDay {
  key: string; // "YYYY-MM-DD"
  year: number;
  month: number; // 0-based
  date: number;
  inMonth: boolean;
}

/** First weekday (0=Sun..6=Sat) considered the start of a week for `locale`. */
export function weekStartsOn(locale: Locale): number {
  // Persian calendar weeks start on Saturday; English on Sunday.
  return locale === "fa" ? 6 : 0;
}

function keyOf(year: number, month: number, date: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

function fromUtcMs(ms: number): { year: number; month: number; date: number } {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate() };
}

/** 6×7 month grid (42 calendar days) around `anchor` with locale week start. */
export function monthGrid(anchor: Date, locale: Locale): CalDay[] {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const firstUtc = Date.UTC(y, m, 1);
  const firstDow = new Date(firstUtc).getUTCDay();
  const lead = (firstDow - weekStartsOn(locale) + 7) % 7;
  const gridStart = firstUtc - lead * 86400000;
  const days: CalDay[] = [];
  for (let i = 0; i < 42; i++) {
    const p = fromUtcMs(gridStart + i * 86400000);
    days.push({ ...p, key: keyOf(p.year, p.month, p.date), inMonth: p.month === m });
  }
  return days;
}

/** 7 calendar days of the week containing `anchor` (locale week start). */
export function weekDays(anchor: Date, locale: Locale): CalDay[] {
  const startUtc = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = new Date(startUtc).getUTCDay();
  const lead = (dow - weekStartsOn(locale) + 7) % 7;
  const gridStart = startUtc - lead * 86400000;
  const days: CalDay[] = [];
  for (let i = 0; i < 7; i++) {
    const p = fromUtcMs(gridStart + i * 86400000);
    days.push({ ...p, key: keyOf(p.year, p.month, p.date), inMonth: true });
  }
  return days;
}

export function calDayOf(anchor: Date): CalDay {
  const p = { year: anchor.getFullYear(), month: anchor.getMonth(), date: anchor.getDate() };
  return { ...p, key: keyOf(p.year, p.month, p.date), inMonth: true };
}

/** Localized weekday headers aligned to the grid's first column. */
export function weekdayHeaders(locale: Locale): string[] {
  const tag = locale === "fa" ? "fa-IR" : "en-US";
  const fmt = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  const start = weekStartsOn(locale);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    // 2023-01-01 was a Sunday
    out.push(fmt.format(Date.UTC(2023, 0, 1 + ((start + i) % 7))));
  }
  return out;
}

export function monthTitle(anchor: Date, locale: Locale): string {
  const tag = locale === "fa" ? "fa-IR" : "en-US";
  return new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(anchor);
}

export function dayNumber(day: CalDay, locale: Locale): string {
  const tag = locale === "fa" ? "fa-IR" : "en-US";
  return new Intl.DateTimeFormat(tag, { day: "numeric", timeZone: "UTC" }).format(
    Date.UTC(day.year, day.month, day.date)
  );
}

export function weekdayShortOf(day: CalDay, locale: Locale): string {
  const tag = locale === "fa" ? "fa-IR" : "en-US";
  return new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }).format(
    Date.UTC(day.year, day.month, day.date)
  );
}

export function fullDayTitle(day: CalDay, locale: Locale): string {
  const tag = locale === "fa" ? "fa-IR" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(day.year, day.month, day.date));
}

/** Dot color per task priority (stable, contrast-checked on card backgrounds). */
export const PRIORITY_DOT: Record<Priority, string> = {
  LOW: "bg-slate-400",
  MEDIUM: "bg-amber-500",
  HIGH: "bg-red-500",
};
