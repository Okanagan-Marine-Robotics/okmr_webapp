import * as chrono from "chrono-node";
import {
  formatZonedDateTime,
  getZonedParts,
  zonedWallClockToUtc,
} from "@okmr_webapp/shared/timezone";

// Parse a due date from user input to a Date at local midnight (tasks track a
// day, not a time). Returns null if empty or unparseable.
//
// Exact YYYY-MM-DD keeps its precise behaviour; anything else goes through
// chrono, which understands natural language like "tomorrow", "next friday",
// "aug 1", "in 3 days", "8/15". forwardDate biases ambiguous dates to the future.
export function parseDueDate(input?: string | null): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = chrono.parseDate(trimmed, new Date(), { forwardDate: true });
  if (!parsed) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
}

// Format a Date as club-local "YYYY-MM-DD HH:MM" (uses CLUB_TIMEZONE so it stays
// consistent on Cloudflare Workers in UTC as well as local dev).
export function formatLocalDateTime(date: Date): string {
  return formatZonedDateTime(date);
}

// Parse a meeting "when" string (natural-language date + time). Returns the
// Date and whether a time-of-day was explicitly given, so /meet can require a
// time rather than silently defaulting to noon. Null if unparseable.
export function parseWhen(input: string): { date: Date; hasTime: boolean } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const result = chrono.parse(trimmed, new Date(), { forwardDate: true })[0];
  if (!result) return null;
  return { date: result.start.date(), hasTime: result.start.isCertain("hour") };
}

// Parse a form's "when" answer, which may describe a range ("fri 2pm-5pm").
// chrono fills in an end component when the text implies one; `end` is null for
// a single instant ("fri 2pm"). Null if nothing date-like was found.
export function parseWhenRange(
  input: string,
): { start: Date; end: Date | null } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const result = chrono.parse(trimmed, new Date(), { forwardDate: true })[0];
  if (!result) return null;
  return { start: result.start.date(), end: result.end?.date() ?? null };
}

export function formatDate(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

// Whole days from today (in club timezone) to the given date. Positive = in the
// future, 0 = today, negative = overdue. Null if there's no date.
export function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const nowParts = getZonedParts(new Date());
  const startOfToday = zonedWallClockToUtc(nowParts.year, nowParts.month, nowParts.day, 0, 0);
  const targetParts = getZonedParts(new Date(date));
  const targetStart = zonedWallClockToUtc(
    targetParts.year,
    targetParts.month,
    targetParts.day,
    0,
    0,
  );
  return Math.round((targetStart.getTime() - startOfToday.getTime()) / 86_400_000);
}

// Human phrasing for a due date, e.g. "due today", "due in 3 days",
// "overdue by 1 day", or "no due date".
export function describeDue(date: Date | null | undefined): string {
  const d = daysUntil(date);
  if (d === null) return "no due date";
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  if (d > 1) return `due in ${d} days`;
  if (d === -1) return "overdue by 1 day";
  return `overdue by ${-d} days`;
}
