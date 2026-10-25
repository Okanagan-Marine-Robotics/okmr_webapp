// The single source of truth for task "importance" levels across both `bot` and `web`.

export interface ImportanceMeta {
  value: string; // stored in the DB
  label: string; // shown to humans in Discord
  webLabel: string; // compact label shown on web badges
  short: string; // compact tag used in the coloured list, e.g. [ULTRA]
  emoji: string;
  ansi: string; // Discord ANSI code-block foreground colour code
  color: string; // Web CSS hex color
  rank: number; // 0 = most important; used for sorting high -> low
  reminderDays: number;
}

export const IMPORTANCE_LEVELS: ImportanceMeta[] = [
  {
    value: "ultra",
    label: "Mega Ultra Important",
    webLabel: "Mega Ultra",
    short: "ULTRA",
    emoji: "🔴",
    ansi: "1;31",
    color: "#e5484d",
    rank: 0,
    reminderDays: 7,
  },
  {
    value: "important",
    label: "Important",
    webLabel: "Important",
    short: "IMPT",
    emoji: "🟠",
    ansi: "1;33",
    color: "#f76808",
    rank: 1,
    reminderDays: 3,
  },
  {
    value: "medium",
    label: "Medium",
    webLabel: "Medium",
    short: "MED",
    emoji: "🟡",
    ansi: "0;36",
    color: "#f5a623",
    rank: 2,
    reminderDays: 1,
  },
  {
    value: "light",
    label: "Light",
    webLabel: "Light",
    short: "LIGHT",
    emoji: "🟢",
    ansi: "0;32",
    color: "#46a758",
    rank: 3,
    reminderDays: 0,
  },
];

export const DEFAULT_IMPORTANCE = "medium";

const byValue = new Map(IMPORTANCE_LEVELS.map((l) => [l.value, l]));

export function importanceMeta(value: string | null | undefined): ImportanceMeta {
  return byValue.get(value ?? "") ?? byValue.get(DEFAULT_IMPORTANCE)!;
}
