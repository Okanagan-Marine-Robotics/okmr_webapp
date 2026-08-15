// Server-side only: this reads the bot token, so it must never be imported
// into a "use client" component.
//
// The web app talks to Discord's REST API directly rather than going through
// the bot process. The token reaches us because @club/db loads the root .env.

// Delete a guild Scheduled Event, so removing a /meet meeting on the web also
// clears it from Discord's Events tab (and the bot's sync listener won't
// resurrect the row). Returns true if it's gone — including a 404, which means
// it already was. Best-effort: callers delete the DB row regardless.
export async function deleteScheduledEvent(eventId: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) {
    console.warn("Discord token/guild not set — skipping scheduled-event delete.");
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
export async function postToChannel(channelId: string, content: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("DISCORD_BOT_TOKEN is not set — skipping the Discord notification.");
    return false;
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      // allowed_mentions lets us ping the requester but nothing else, so a
      // request whose text happens to contain @everyone can't blast the server.
      body: JSON.stringify({ content, allowed_mentions: { parse: ["users"] } }),
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
