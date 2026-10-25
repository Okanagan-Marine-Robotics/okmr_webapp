// Pure fetch-based Discord REST API v10 helpers.
// Used by the Cloudflare Worker (HTTP Interactions + Cron Triggers) as well as
// shared bot utilities so nothing requires a persistent Gateway WebSocket.

const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordApiChannel {
  id: string;
  name?: string;
  type: number;
  parent_id?: string | null;
  guild_id?: string;
  permissions?: string;
}

export interface DiscordApiRecurrenceRule {
  start: string;
  end?: string | null;
  frequency: number;
  interval: number;
  by_weekday?: number[] | null;
}

export interface DiscordApiScheduledEvent {
  id: string;
  guild_id: string;
  channel_id: string | null;
  name: string;
  scheduled_start_time: string;
  scheduled_end_time: string | null;
  privacy_level: number;
  entity_type: number;
  entity_metadata?: { location?: string } | null;
  recurrence_rule?: DiscordApiRecurrenceRule | null;
}

function authHeaders(botToken: string, json = true): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bot ${botToken}`,
  };
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export async function fetchDiscordChannel(
  channelId: string,
  botToken: string,
): Promise<DiscordApiChannel | null> {
  try {
    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}`, {
      headers: authHeaders(botToken, false),
    });
    if (!res.ok) return null;
    return (await res.json()) as DiscordApiChannel;
  } catch {
    return null;
  }
}

export async function fetchGuildChannels(
  guildId: string,
  botToken: string,
): Promise<DiscordApiChannel[] | null> {
  try {
    const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
      headers: authHeaders(botToken, false),
    });
    if (!res.ok) return null;
    return (await res.json()) as DiscordApiChannel[];
  } catch {
    return null;
  }
}

export async function fetchGuildActiveThreads(
  guildId: string,
  botToken: string,
): Promise<DiscordApiChannel[] | null> {
  try {
    const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/threads/active`, {
      headers: authHeaders(botToken, false),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { threads?: DiscordApiChannel[] };
    return data.threads ?? [];
  } catch {
    return null;
  }
}

export async function postDiscordChannelMessage(
  channelId: string,
  body: {
    content?: string;
    embeds?: unknown[];
    allowed_mentions?: { parse: string[]; users?: string[] };
  },
  botToken: string,
): Promise<boolean> {
  const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: authHeaders(botToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Discord message send failed (${res.status}): ${await res.text()}`);
  }
  return true;
}

export async function listGuildScheduledEvents(
  guildId: string,
  botToken: string,
): Promise<DiscordApiScheduledEvent[] | null> {
  try {
    const res = await fetch(
      `${DISCORD_API_BASE}/guilds/${guildId}/scheduled-events?with_user_count=false`,
      { headers: authHeaders(botToken, false) },
    );
    if (!res.ok) return null;
    return (await res.json()) as DiscordApiScheduledEvent[];
  } catch {
    return null;
  }
}

export async function createGuildScheduledEvent(
  guildId: string,
  payload: Record<string, unknown>,
  botToken: string,
): Promise<DiscordApiScheduledEvent> {
  const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/scheduled-events`, {
    method: "POST",
    headers: authHeaders(botToken),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Discord create scheduled event failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as DiscordApiScheduledEvent;
}

export async function editGuildScheduledEvent(
  guildId: string,
  eventId: string,
  payload: Record<string, unknown>,
  botToken: string,
): Promise<DiscordApiScheduledEvent> {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${guildId}/scheduled-events/${eventId}`,
    {
      method: "PATCH",
      headers: authHeaders(botToken),
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(`Discord edit scheduled event failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as DiscordApiScheduledEvent;
}

export async function deleteGuildScheduledEvent(
  guildId: string,
  eventId: string,
  botToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${DISCORD_API_BASE}/guilds/${guildId}/scheduled-events/${eventId}`,
      {
        method: "DELETE",
        headers: authHeaders(botToken, false),
      },
    );
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export interface WebhookFileAttachment {
  name: string;
  data: Uint8Array;
  contentType?: string;
}

export async function sendInteractionWebhookRequest(
  url: string,
  method: "PATCH" | "POST",
  jsonPayload: Record<string, unknown>,
  files?: WebhookFileAttachment[],
): Promise<void> {
  if (files && files.length > 0) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(jsonPayload));
    files.forEach((f, idx) => {
      const buf = new ArrayBuffer(f.data.byteLength);
      new Uint8Array(buf).set(f.data);
      const blob = new Blob([buf], {
        type: f.contentType ?? "application/octet-stream",
      });
      form.append(`files[${idx}]`, blob, f.name);
    });
    const res = await fetch(url, { method, body: form });
    if (!res.ok) {
      console.warn(`Interaction webhook ${method} failed (${res.status}): ${await res.text()}`);
    }
    return;
  }

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonPayload),
  });
  if (!res.ok) {
    console.warn(`Interaction webhook ${method} failed (${res.status}): ${await res.text()}`);
  }
}

export async function editOriginalInteractionResponse(
  appId: string,
  interactionToken: string,
  payload: Record<string, unknown>,
  files?: WebhookFileAttachment[],
): Promise<void> {
  const url = `${DISCORD_API_BASE}/webhooks/${appId}/${interactionToken}/messages/@original`;
  await sendInteractionWebhookRequest(url, "PATCH", payload, files);
}

export async function createFollowupInteractionMessage(
  appId: string,
  interactionToken: string,
  payload: Record<string, unknown>,
  files?: WebhookFileAttachment[],
): Promise<void> {
  const url = `${DISCORD_API_BASE}/webhooks/${appId}/${interactionToken}`;
  await sendInteractionWebhookRequest(url, "POST", payload, files);
}
