// The single source of truth for task "importance" levels. Everything else
// (the /task form dropdown, /lstask colours, the reminder windows) reads from
// this table, so to add or rename a level you only edit here.

export interface ImportanceMeta {
  value: string; // stored in the DB
  label: string; // shown to humans
  short: string; // compact tag used in the coloured list, e.g. [ULTRA]
  emoji: string;
  ansi: string; // Discord ANSI code-block foreground colour code
  rank: number; // 0 = most important; used for sorting high -> low
  // How many days before the due date this level starts being flagged as
  // "due soon" in the update message. Higher importance = flagged earlier.
  reminderDays: number;
}

// Ordered most-important first.
export const IMPORTANCE_LEVELS: ImportanceMeta[] = [
  { value: "ultra",     label: "Mega Ultra Important", short: "ULTRA", emoji: "🔴", ansi: "1;31", rank: 0, reminderDays: 7 },
  { value: "important", label: "Important",            short: "IMPT",  emoji: "🟠", ansi: "1;33", rank: 1, reminderDays: 3 },
  { value: "medium",    label: "Medium",               short: "MED",   emoji: "🟡", ansi: "0;36", rank: 2, reminderDays: 1 },
  { value: "light",     label: "Light",                short: "LIGHT", emoji: "🟢", ansi: "0;32", rank: 3, reminderDays: 0 },
];

export const DEFAULT_IMPORTANCE = "medium";

const byValue = new Map(IMPORTANCE_LEVELS.map((l) => [l.value, l]));

// Look up a level, falling back to the default for unknown/legacy values.
export function importanceMeta(value: string | null | undefined): ImportanceMeta {
  return byValue.get(value ?? "") ?? byValue.get(DEFAULT_IMPORTANCE)!;
}
