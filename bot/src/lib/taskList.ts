// Shared rendering for a channel's open tasks, used by /lstask and the
// scheduled update message so they always look the same.

import { importanceMeta } from "./importance.js";
import { daysUntil, describeDue } from "./date.js";

// The real ANSI escape byte. Discord ```ansi``` code blocks colour text with
// ESC[<code>m ... ESC[0m sequences.
const ESC = String.fromCharCode(27); // ANSI escape byte for Discord ```ansi``` blocks

// The shape we need from a task to render it. Kept loose so Prisma results with
// `assignees: { include: { user: true } }` satisfy it.
export interface RenderableTask {
  title: string;
  importance: string;
  dueDate: Date | null;
  assignees: { user: { username: string; discordId: string } }[];
}

// A task is "due soon" when it's within its importance level's reminder window
// (or already overdue). Higher importance = flagged more days ahead.
export function isDueSoon(task: RenderableTask): boolean {
  const d = daysUntil(task.dueDate);
  if (d === null) return false;
  return d <= importanceMeta(task.importance).reminderDays;
}

// Sort most-important first, then soonest due (no-due-date last), then title.
export function sortTasks<T extends RenderableTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const byImp = importanceMeta(a.importance).rank - importanceMeta(b.importance).rank;
    if (byImp !== 0) return byImp;
    const da = daysUntil(a.dueDate);
    const db = daysUntil(b.dueDate);
    if (da === null && db === null) return a.title.localeCompare(b.title);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

// Render tasks as a Discord ```ansi``` code block: one coloured line each,
// most-important first, with a text tag so it's readable without colour too.
export function renderTaskBlock(tasks: RenderableTask[], maxLines = 25): string {
  const sorted = sortTasks(tasks);
  const shown = sorted.slice(0, maxLines);

  const lines = shown.map((t) => {
    const meta = importanceMeta(t.importance);
    const tag = `[${meta.short.padEnd(5)}]`;
    const who =
      t.assignees.length > 0 ? t.assignees.map((a) => a.user.username).join(", ") : "unassigned";
    const soon = isDueSoon(t) ? "  <- DUE SOON" : "";
    return `${ESC}[${meta.ansi}m${tag} ${t.title} — ${who} — ${describeDue(t.dueDate)}${soon}${ESC}[0m`;
  });

  if (sorted.length > shown.length) {
    lines.push(`${ESC}[0;37m…and ${sorted.length - shown.length} more${ESC}[0m`);
  }

  return "```ansi\n" + lines.join("\n") + "\n```";
}
