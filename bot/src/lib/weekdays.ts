// Helpers for the /config schedule: weekdays are stored as a comma-separated
// list of day numbers (0=Sun..6=Sat), e.g. "1,4" = Monday & Thursday.

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Parse user input like "Mon,Thu" or "mon tue wed" into day numbers.
// "off" / "none" / "never" clears the schedule; "daily" / "everyday" = all 7.
// Returns { days } on success or { error } on a bad token.
export function parseWeekdays(input: string): { days: number[] } | { error: string } {
  const cleaned = input.trim().toLowerCase();
  if (["off", "none", "never", "pause"].includes(cleaned)) return { days: [] };
  if (["daily", "everyday", "all"].includes(cleaned)) return { days: [0, 1, 2, 3, 4, 5, 6] };

  const tokens = cleaned.split(/[,\s]+/).filter(Boolean);
  const days = new Set<number>();
  for (const token of tokens) {
    const idx = WEEKDAY_NAMES.findIndex((n) => n.toLowerCase() === token.slice(0, 3));
    if (idx === -1) {
      return { error: `"${token}" isn't a weekday. Use e.g. Mon, Tue, ... or "off".` };
    }
    days.add(idx);
  }
  return { days: [...days].sort((a, b) => a - b) };
}

export function daysToCsv(days: number[]): string {
  return days.join(",");
}

export function csvToDays(csv: string): number[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "") // Number("") is 0 (=Sunday), so drop empties first
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export function formatDays(csv: string): string {
  const days = csvToDays(csv);
  if (days.length === 0) return "never (paused)";
  if (days.length === 7) return "every day";
  return days.map((d) => WEEKDAY_NAMES[d]).join(", ");
}

// Parse "HH:MM" (24-hour). Returns null if not a valid time.
export function parseTimeOfDay(input: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
