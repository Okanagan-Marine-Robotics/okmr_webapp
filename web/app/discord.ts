// Server-side only: this reads the bot token, so it must never be imported
// into a "use client" component.
//
// The web app talks to Discord's REST API directly rather than going through
// the bot process. The token reaches us via Cloudflare env vars or @okmr_webapp/db loading .env.

import { getRuntimeEnv, isDiscordSnowflake } from "./discord-guild";

// Delete a guild Scheduled Event, so removing a /meet meeting on the web also
// clears it from Discord's Events tab (and the bot's sync listener won't
// resurrect the row). Returns true if it's gone — including a 404, which means
// it already was. Best-effort: callers delete the DB row regardless.
export async function deleteScheduledEvent(eventId: string): Promise<boolean> {
  const token = getRuntimeEnv("DISCORD_BOT_TOKEN");
  const guildId = getRuntimeEnv("DISCORD_GUILD_ID");
  if (!token || !isDiscordSnowflake(guildId) || !isDiscordSnowflake(eventId)) {
    console.warn("Discord token/guild/eventId invalid or not set — skipping scheduled-event delete.");
    return false;
  }

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/scheduled-events/${eventId}`,
      { method: "DELETE", headers: { Authorization: `Bot ${token}` } },
    );
    if (res.ok || res.status === 404) return true;
    console.warn(`Scheduled-event delete failed (${res.status}): ${await res.text()}`);
    return false;
  } catch (error) {
    console.warn("Scheduled-event delete failed:", error);
    return false;
  }
}

// Works for forum posts and threads too — their id is just a channel id, and
// Discord un-archives a thread when a message arrives.
// `mentionUserIds` explicitly allowlists the exact Discord user IDs permitted
// to be pinged so `<@id>` inside user-submitted text cannot ping others.
export async function postToChannel(
  channelId: string,
  content: string,
  mentionUserIds: string[] = [],
): Promise<boolean> {
  const token = getRuntimeEnv("DISCORD_BOT_TOKEN");
  if (!token || !isDiscordSnowflake(channelId)) {
    console.warn("DISCORD_BOT_TOKEN or valid channelId not set — skipping Discord notification.");
    return false;
  }

  const safeMentions = [...new Set(mentionUserIds.filter(isDiscordSnowflake))];

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: content.slice(0, 2000),
        allowed_mentions: { parse: [], users: safeMentions },
      }),
    });

    if (!res.ok) {
      console.warn(`Discord notification failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    // Never let a Discord outage turn an approval into an error page — the
    // decision is already saved by the time we get here.
    console.warn("Discord notification failed:", error);
    return false;
  }
}
