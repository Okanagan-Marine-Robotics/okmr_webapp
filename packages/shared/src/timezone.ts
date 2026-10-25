// Timezone-aware date/time helpers so scheduled channel updates (/config) and
// formatted timestamps behave identically on Cloudflare Workers (where system
// clock timezone is UTC) and local machines (America/Vancouver).

export const DEFAULT_CLUB_TIMEZONE = "America/Vancouver";

export function getClubTimezone(): string {
  if (typeof process !== "undefined" && process.env?.CLUB_TIMEZONE) {
    return process.env.CLUB_TIMEZONE;
  }
  return DEFAULT_CLUB_TIMEZONE;
}

export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0=Sun..6=Sat
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedParts(
  date: Date = new Date(),
  timeZone: string = getClubTimezone(),
): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const rawHour = Number(map.hour ?? 0);
  return {
    year: Number(map.year ?? date.getUTCFullYear()),
    month: Number(map.month ?? date.getUTCMonth() + 1),
    day: Number(map.day ?? date.getUTCDate()),
    weekday: WEEKDAY_MAP[map.weekday ?? "Sun"] ?? date.getUTCDay(),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(map.minute ?? 0),
    second: Number(map.second ?? 0),
  };
}

// Compute the exact UTC Date corresponding to a given local wall-clock time
// (year, month, day, hour, minute) in `timeZone`.
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = getClubTimezone(),
): Date {
  // Initial guess assuming target wall-clock is UTC
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const guessDate = new Date(guessUtcMs);
  const zoned = getZonedParts(guessDate, timeZone);
  const zonedAsUtcMs = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    0,
    0,
  );
  const offsetMs = zonedAsUtcMs - guessUtcMs;
  return new Date(guessUtcMs - offsetMs);
}

// Format a Date as "YYYY-MM-DD HH:MM" in the club's timezone.
export function formatZonedDateTime(
  date: Date,
  timeZone: string = getClubTimezone(),
): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const z = getZonedParts(date, timeZone);
  return `${z.year}-${p(z.month)}-${p(z.day)} ${p(z.hour)}:${p(z.minute)}`;
}
