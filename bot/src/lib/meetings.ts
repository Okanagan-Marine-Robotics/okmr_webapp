// Helpers for mirroring Discord Scheduled Events into our Meeting rows.

import type {
  GuildScheduledEvent,
  GuildScheduledEventRecurrenceRule,
  GuildScheduledEventRecurrenceRuleOptions,
  GuildScheduledEventRecurrenceRuleWeekday,
} from "discord.js";
import { GuildScheduledEventRecurrenceRuleFrequency } from "discord.js";
import { formatTimeOfDay } from "./weekdays.js";

// One-line human summary of a meeting, e.g.
// "**Design review** — Fri Jul 24 2026 · 15:00 — EDT-101 (weekly)".
export function formatMeetingLine(m: {
  title: string;
  startsAt: Date;
  location: string | null;
  recurrence: string;
}): string {
  const time = formatTimeOfDay(m.startsAt.getHours(), m.startsAt.getMinutes());
  const where = m.location ? ` — ${m.location}` : "";
  const rep = m.recurrence && m.recurrence !== "none" ? ` (${m.recurrence})` : "";
  return `**${m.title}** — ${m.startsAt.toDateString()} · ${time}${where}${rep}`;
}

// Map a Discord recurrence rule to our simple label ("none"|"weekly"|"biweekly").
export function recurrenceLabel(rule: GuildScheduledEventRecurrenceRule | null): string {
  if (!rule) return "none";
  if (rule.frequency === GuildScheduledEventRecurrenceRuleFrequency.Weekly) {
    return rule.interval === 2 ? "biweekly" : "weekly";
  }
  return "none";
}

// Build a Discord weekly/biweekly recurrence rule anchored on the start's
// weekday. Returns null for one-time meetings.
export function recurrenceRuleFor(
  recurrence: string,
  start: Date,
): GuildScheduledEventRecurrenceRuleOptions | null {
  if (recurrence !== "weekly" && recurrence !== "biweekly") return null;
  // JS getDay(): Sun=0..Sat=6. Discord weekday enum: Mon=0..Sun=6.
  const weekday = ((start.getDay() + 6) % 7) as GuildScheduledEventRecurrenceRuleWeekday;
  return {
    startAt: start,
    frequency: GuildScheduledEventRecurrenceRuleFrequency.Weekly,
    interval: recurrence === "biweekly" ? 2 : 1,
    byWeekday: [weekday],
  };
}

// The Meeting fields we mirror from a Discord Scheduled Event. Deliberately
// excludes teamId (owned by /meet) and discordEventId (the upsert key).
export function meetingSyncData(event: GuildScheduledEvent) {
  return {
    title: event.name,
    startsAt: event.scheduledStartAt ?? new Date(),
    endsAt: event.scheduledEndAt,
    location: event.entityMetadata?.location ?? event.channel?.name ?? null,
    recurrence: recurrenceLabel(event.recurrenceRule),
  };
}
