// Keep our Meeting rows in sync with Discord's native Scheduled Events, so an
// event created/edited/deleted in Discord's own UI is reflected in the DB (and
// therefore the web calendar and the channel update message).

import { Events } from "discord.js";
import type { Client, GuildScheduledEvent } from "discord.js";
import { prisma } from "@club/db";
import { meetingSyncData } from "../lib/meetings.js";

export function registerScheduledEventSync(client: Client): void {
  client.on(Events.GuildScheduledEventCreate, (event) => {
    upsertMeeting(event).catch(logError);
  });
  client.on(Events.GuildScheduledEventUpdate, (_old, event) => {
    upsertMeeting(event).catch(logError);
  });
  client.on(Events.GuildScheduledEventDelete, (event) => {
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

function logError(e: unknown): void {
  console.error("Scheduled-event sync error:", e);
}
