// Keep our Meeting rows in sync with Discord's native Scheduled Events, so an
// event created/edited/deleted in Discord's own UI is reflected in the DB (and
// therefore the web calendar and the channel update message).
// Supports both Gateway listeners (`registerScheduledEventSync`) and stateless
// REST reconciliation (`syncGuildScheduledEventsViaRest`) for Cloudflare Workers.

import { Events, GuildScheduledEventRecurrenceRuleFrequency } from "discord.js";
import type { Client, GuildScheduledEvent } from "discord.js";
import { prisma } from "@okmr_webapp/db";
import { meetingSyncData } from "../lib/meetings.js";
import { listGuildScheduledEvents } from "../lib/discordRest.js";
import type { DiscordApiScheduledEvent } from "../lib/discordRest.js";
import { isAllowedGuild } from "../lib/security.js";

export function registerScheduledEventSync(client: Client): void {
  client.on(Events.GuildScheduledEventCreate, (event) => {
    if (!isAllowedGuild(event.guildId)) return;
    upsertMeeting(event).catch(logError);
  });
  client.on(Events.GuildScheduledEventUpdate, (_old, event) => {
    if (!isAllowedGuild(event.guildId)) return;
    upsertMeeting(event).catch(logError);
  });
  client.on(Events.GuildScheduledEventDelete, (event) => {
    if (!isAllowedGuild(event.guildId)) return;
    prisma.meeting.deleteMany({ where: { discordEventId: event.id } }).catch(logError);
  });
}

async function upsertMeeting(event: GuildScheduledEvent): Promise<void> {
  const data = meetingSyncData(event);
  await prisma.meeting.upsert({
    where: { discordEventId: event.id },
    create: { ...data, discordEventId: event.id },
    // Intentionally omits teamId so a team set by /meet survives later edits.
    update: data,
  });
}

function apiRecurrenceLabel(event: DiscordApiScheduledEvent): string {
  const rule = event.recurrence_rule;
  if (!rule) return "none";
  if (rule.frequency === GuildScheduledEventRecurrenceRuleFrequency.Weekly) {
    return rule.interval === 2 ? "biweekly" : "weekly";
  }
  return "none";
}

// Reconcile Discord's live Guild Scheduled Events via REST API (used by the
// Cloudflare Worker Cron Trigger where there is no persistent Gateway socket).
export async function syncGuildScheduledEventsViaRest(
  guildId: string,
  botToken: string,
): Promise<void> {
  const events = await listGuildScheduledEvents(guildId, botToken);
  if (!events) return;

  const liveEventIds = new Set<string>();

  for (const ev of events) {
    liveEventIds.add(ev.id);
    const data = {
      title: ev.name,
      startsAt: new Date(ev.scheduled_start_time),
      endsAt: ev.scheduled_end_time ? new Date(ev.scheduled_end_time) : null,
      location: ev.entity_metadata?.location ?? null,
      recurrence: apiRecurrenceLabel(ev),
    };
    await prisma.meeting.upsert({
      where: { discordEventId: ev.id },
      create: { ...data, discordEventId: ev.id },
      update: data,
    });
  }

  // Clean up any Meeting rows linked to a Discord Scheduled Event that was
  // deleted or completed in Discord's UI.
  const trackedMeetings = await prisma.meeting.findMany({
    where: { NOT: { discordEventId: null } },
    select: { id: true, discordEventId: true },
  });

  const removedIds = trackedMeetings
    .filter((m) => m.discordEventId && !liveEventIds.has(m.discordEventId))
    .map((m) => m.id);

  if (removedIds.length > 0) {
    await prisma.meeting.deleteMany({
      where: { id: { in: removedIds } },
    });
  }
}

function logError(e: unknown): void {
  console.error("Scheduled-event sync error:", e);
}
