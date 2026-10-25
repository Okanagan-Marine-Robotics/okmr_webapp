// Discord HTTP Interactions adapter for Cloudflare Workers.
// Verifies Ed25519 signatures using standard Web Crypto API and adapts raw
// Discord Interaction JSON payloads to the discord.js-compatible interface used
// by all 18 commands and 4 modal/button handlers.

import { MessageFlags, PermissionsBitField } from "discord.js";
import {
  createFollowupInteractionMessage,
  createGuildScheduledEvent,
  deleteGuildScheduledEvent,
  editGuildScheduledEvent,
  editOriginalInteractionResponse,
  fetchDiscordChannel,
  fetchGuildActiveThreads,
  fetchGuildChannels,
  type DiscordApiChannel,
  type WebhookFileAttachment,
} from "./discordRest.js";

// Discord Interaction Types
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

// Discord Interaction Callback Types
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
} as const;

export interface RawDiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface RawDiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  content_type?: string | null;
}

export interface RawCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
  options?: RawCommandOption[];
}

export interface RawModalComponent {
  type: number;
  custom_id?: string;
  value?: string;
  values?: string[];
  component?: RawModalComponent;
  components?: RawModalComponent[];
}

export interface RawDiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: DiscordApiChannel;
  member?: {
    user: RawDiscordUser;
    roles?: string[];
    permissions?: string;
  };
  user?: RawDiscordUser;
  data?: {
    id?: string;
    name?: string;
    custom_id?: string;
    component_type?: number;
    options?: RawCommandOption[];
    components?: RawModalComponent[];
    resolved?: {
      users?: Record<string, RawDiscordUser>;
      channels?: Record<string, DiscordApiChannel>;
      attachments?: Record<string, RawDiscordAttachment>;
    };
  };
}

function hexToUint8Array(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i / 2] = byte;
  }
  return bytes;
}

const MAX_SIGNATURE_AGE_SECONDS = 300; // 5-minute replay window

// Verify Discord's X-Signature-Ed25519 and X-Signature-Timestamp headers using
// the Web Crypto API supported natively in Cloudflare Workers and Node 20+,
// enforcing a 5-minute timestamp freshness window against replay attacks.
export async function verifyDiscordSignature(
  rawBody: string,
  signatureHex: string | null,
  timestamp: string | null,
  publicKeyHex: string,
): Promise<boolean> {
  if (!signatureHex || !timestamp || !publicKeyHex) return false;
  if (!/^\d{9,12}$/.test(timestamp)) return false;

  const tsSeconds = Number.parseInt(timestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsSeconds) || Math.abs(nowSeconds - tsSeconds) > MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }

  const sigBytes = hexToUint8Array(signatureHex);
  const pubKeyBytes = hexToUint8Array(publicKeyHex);
  if (!sigBytes || !pubKeyBytes) return false;

  try {
    const keyBuf = new ArrayBuffer(pubKeyBytes.byteLength);
    new Uint8Array(keyBuf).set(pubKeyBytes);

    const sigBuf = new ArrayBuffer(sigBytes.byteLength);
    new Uint8Array(sigBuf).set(sigBytes);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    const messageBytes = new TextEncoder().encode(timestamp + rawBody);
    const msgBuf = new ArrayBuffer(messageBytes.byteLength);
    new Uint8Array(msgBuf).set(messageBytes);

    return await crypto.subtle.verify("Ed25519", cryptoKey, sigBuf, msgBuf);
  } catch (err) {
    console.error("Ed25519 verification error:", err);
    return false;
  }
}

function toJsonable(item: unknown): unknown {
  if (
    item &&
    typeof item === "object" &&
    "toJSON" in item &&
    typeof (item as { toJSON: () => unknown }).toJSON === "function"
  ) {
    return (item as { toJSON: () => unknown }).toJSON();
  }
  return item;
}

function extractFiles(rawFiles?: unknown[]): WebhookFileAttachment[] {
  if (!rawFiles || rawFiles.length === 0) return [];
  const out: WebhookFileAttachment[] = [];
  for (const f of rawFiles) {
    if (!f || typeof f !== "object") continue;
    const attachment = (f as { attachment?: unknown }).attachment;
    const name = (f as { name?: string }).name ?? "file.txt";
    if (attachment instanceof Uint8Array) {
      out.push({ name, data: attachment });
    } else if (typeof attachment === "string") {
      out.push({ name, data: new TextEncoder().encode(attachment) });
    }
  }
  return out;
}

function isEphemeralOption(opts?: Record<string, unknown>): boolean {
  if (!opts) return false;
  if (opts.ephemeral === true) return true;
  if (typeof opts.flags === "number" && (opts.flags & Number(MessageFlags.Ephemeral)) !== 0) {
    return true;
  }
  return false;
}

function serializeMessageData(opts: string | Record<string, unknown>): {
  json: Record<string, unknown>;
  files: WebhookFileAttachment[];
} {
  if (typeof opts === "string") {
    return { json: { content: opts }, files: [] };
  }

  const json: Record<string, unknown> = {};
  if ("content" in opts && opts.content !== undefined) json.content = opts.content;
  if ("embeds" in opts && Array.isArray(opts.embeds)) {
    json.embeds = opts.embeds.map(toJsonable);
  }
  if ("components" in opts && Array.isArray(opts.components)) {
    json.components = opts.components.map(toJsonable);
  }
  if ("attachments" in opts && Array.isArray(opts.attachments)) {
    json.attachments = opts.attachments;
  }
  if (isEphemeralOption(opts)) {
    json.flags = Number(MessageFlags.Ephemeral);
  }

  const files = extractFiles(opts.files as unknown[] | undefined);
  return { json, files };
}

function buildCallbackHttpResponse(
  type: number,
  data?: Record<string, unknown>,
  files?: WebhookFileAttachment[],
): Response {
  const payload = data ? { type, data } : { type };

  if (files && files.length > 0) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    files.forEach((f, idx) => {
      const buf = new ArrayBuffer(f.data.byteLength);
      new Uint8Array(buf).set(f.data);
      const blob = new Blob([buf], {
        type: f.contentType ?? "application/octet-stream",
      });
      form.append(`files[${idx}]`, blob, f.name);
    });
    return new Response(form);
  }

  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
}

export class HttpInteractionAdapter {
  public replied = false;
  public deferred = false;
  public readonly commandName: string;
  public readonly customId: string;
  public readonly guildId: string | null;
  public readonly channelId: string;
  public readonly member: {
    roles: string[];
    permissions?: string;
  } | null;
  public readonly memberPermissions: Readonly<PermissionsBitField> | null;
  public readonly user: {
    id: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
    toString(): string;
  };
  public readonly channel: {
    id: string;
    name: string;
    type: number;
    parentId: string | null;
    isDMBased(): boolean;
  } | null;
  public readonly guild: {
    id: string;
    channels: {
      fetch(id?: string): Promise<unknown>;
      fetchActiveThreads(): Promise<{ threads: Map<string, unknown> }>;
    };
    scheduledEvents: {
      create(opts: Record<string, unknown>): Promise<{ id: string }>;
      edit(eventId: string, opts: Record<string, unknown>): Promise<{ id: string }>;
      delete(eventId: string): Promise<boolean>;
    };
  } | null;
  public readonly options: {
    getString(name: string, required?: boolean): string | null;
    getBoolean(name: string, required?: boolean): boolean | null;
    getChannel(name: string): {
      id: string;
      name: string;
      type: number;
      parentId: string | null;
      permissions?: string;
    } | null;
    getAttachment(name: string): {
      id: string;
      name: string;
      size: number;
      url: string;
      contentType: string | null;
    } | null;
    getFocused(): string;
  };
  public readonly fields: {
    getTextInputValue(customId: string): string;
    getStringSelectValues(customId: string): string[];
    getSelectedUsers(customId: string): Map<
      string,
      { id: string; username: string; globalName: string | null; avatar: string | null }
    > | null;
  };

  private resolveHttpResponse!: (res: Response) => void;
  private readonly httpResponsePromise: Promise<Response>;
  private readonly raw: RawDiscordInteraction;
  private readonly botToken: string;

  constructor(
    raw: RawDiscordInteraction,
    botToken: string,
  ) {
    this.raw = raw;
    this.botToken = botToken;
    this.httpResponsePromise = new Promise<Response>((resolve) => {
      this.resolveHttpResponse = resolve;
    });

    this.commandName = raw.data?.name ?? "";
    this.customId = raw.data?.custom_id ?? "";
    this.guildId = raw.guild_id ?? null;
    this.channelId = raw.channel_id ?? raw.channel?.id ?? "";
    this.member = raw.member
      ? {
          roles: Array.isArray(raw.member.roles) ? raw.member.roles : [],
          permissions: raw.member.permissions,
        }
      : null;

    let parsedPerms: Readonly<PermissionsBitField> | null = null;
    if (raw.member?.permissions) {
      try {
        parsedPerms = new PermissionsBitField(BigInt(raw.member.permissions)).freeze();
      } catch {
        parsedPerms = null;
      }
    }
    this.memberPermissions = parsedPerms;

    const rawUser = raw.member?.user ?? raw.user ?? { id: "0", username: "user" };
    this.user = {
      id: rawUser.id,
      username: rawUser.username,
      globalName: rawUser.global_name ?? null,
      avatar: rawUser.avatar ?? null,
      toString() {
        return `<@${rawUser.id}>`;
      },
    };

    const rawChannel = raw.channel;
    this.channel = this.channelId
      ? {
          id: this.channelId,
          name: rawChannel?.name ?? "channel",
          type: rawChannel?.type ?? 0,
          parentId: rawChannel?.parent_id ?? null,
          isDMBased: () => !this.guildId,
        }
      : null;

    this.guild = this.guildId ? this.buildGuildHelper(this.guildId) : null;
    this.options = this.buildOptionsHelper();
    this.fields = this.buildFieldsHelper();
  }

  public getHttpResponse(): Promise<Response> {
    return this.httpResponsePromise;
  }

  public inGuild(): boolean {
    return Boolean(this.guildId);
  }

  public isRepliable(): boolean {
    return this.raw.type !== InteractionType.PING;
  }

  public isChatInputCommand(): boolean {
    return this.raw.type === InteractionType.APPLICATION_COMMAND;
  }

  public isAutocomplete(): boolean {
    return this.raw.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE;
  }

  public isButton(): boolean {
    return this.raw.type === InteractionType.MESSAGE_COMPONENT;
  }

  public isModalSubmit(): boolean {
    return this.raw.type === InteractionType.MODAL_SUBMIT;
  }

  public async reply(opts: string | Record<string, unknown>): Promise<void> {
    const { json, files } = serializeMessageData(opts);
    if (this.deferred || this.replied) {
      await createFollowupInteractionMessage(
        this.raw.application_id,
        this.raw.token,
        json,
        files,
      );
      return;
    }
    this.replied = true;
    this.resolveHttpResponse(
      buildCallbackHttpResponse(
        InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        json,
        files,
      ),
    );
  }

  public async deferReply(opts?: Record<string, unknown>): Promise<void> {
    if (this.deferred || this.replied) return;
    this.deferred = true;
    const data = isEphemeralOption(opts)
      ? { flags: Number(MessageFlags.Ephemeral) }
      : undefined;
    this.resolveHttpResponse(
      buildCallbackHttpResponse(
        InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data,
      ),
    );
  }

  public async editReply(opts: string | Record<string, unknown>): Promise<void> {
    const { json, files } = serializeMessageData(opts);
    await editOriginalInteractionResponse(
      this.raw.application_id,
      this.raw.token,
      json,
      files,
    );
  }

  public async followUp(opts: string | Record<string, unknown>): Promise<void> {
    const { json, files } = serializeMessageData(opts);
    await createFollowupInteractionMessage(
      this.raw.application_id,
      this.raw.token,
      json,
      files,
    );
  }

  public async showModal(modal: unknown): Promise<void> {
    this.replied = true;
    const data = toJsonable(modal) as Record<string, unknown>;
    this.resolveHttpResponse(
      buildCallbackHttpResponse(InteractionResponseType.MODAL, data),
    );
  }

  public async update(opts: Record<string, unknown>): Promise<void> {
    this.replied = true;
    const { json, files } = serializeMessageData(opts);
    this.resolveHttpResponse(
      buildCallbackHttpResponse(InteractionResponseType.UPDATE_MESSAGE, json, files),
    );
  }

  public async respond(choices: Array<{ name: string; value: string }>): Promise<void> {
    this.replied = true;
    this.resolveHttpResponse(
      buildCallbackHttpResponse(
        InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
        { choices },
      ),
    );
  }

  private buildOptionsHelper() {
    const optionMap = new Map<string, RawCommandOption>();
    for (const opt of this.raw.data?.options ?? []) {
      optionMap.set(opt.name, opt);
    }

    return {
      getString: (name: string, required?: boolean): string | null => {
        const opt = optionMap.get(name);
        if (opt?.value === undefined || opt?.value === null) {
          if (required) throw new Error(`Missing required option: ${name}`);
          return null;
        }
        return String(opt.value);
      },
      getBoolean: (name: string, required?: boolean): boolean | null => {
        const opt = optionMap.get(name);
        if (typeof opt?.value !== "boolean") {
          if (required) throw new Error(`Missing required boolean option: ${name}`);
          return null;
        }
        return opt.value;
      },
      getChannel: (name: string) => {
        const opt = optionMap.get(name);
        const id = typeof opt?.value === "string" ? opt.value : null;
        if (!id) return null;
        const resolved = this.raw.data?.resolved?.channels?.[id];
        if (!resolved) return null;
        return {
          id,
          name: resolved.name ?? "channel",
          type: resolved.type ?? 0,
          parentId: resolved.parent_id ?? null,
          permissions: resolved.permissions,
        };
      },
      getAttachment: (name: string) => {
        const opt = optionMap.get(name);
        const id = typeof opt?.value === "string" ? opt.value : null;
        if (!id) return null;
        const att = this.raw.data?.resolved?.attachments?.[id];
        if (!att) return null;
        return {
          id: att.id,
          name: att.filename,
          size: att.size,
          url: att.url,
          contentType: att.content_type ?? null,
        };
      },
      getFocused: (): string => {
        for (const opt of this.raw.data?.options ?? []) {
          if (opt.focused) return String(opt.value ?? "");
        }
        return "";
      },
    };
  }

  private buildFieldsHelper() {
    const componentMap = new Map<string, RawModalComponent>();

    const walk = (items?: RawModalComponent[]) => {
      if (!items) return;
      for (const item of items) {
        if (item.custom_id) {
          componentMap.set(item.custom_id, item);
        }
        if (item.component) {
          walk([item.component]);
        }
        if (item.components) {
          walk(item.components);
        }
      }
    };
    walk(this.raw.data?.components);

    return {
      getTextInputValue: (customId: string): string => {
        const comp = componentMap.get(customId);
        return typeof comp?.value === "string" ? comp.value : "";
      },
      getStringSelectValues: (customId: string): string[] => {
        const comp = componentMap.get(customId);
        return Array.isArray(comp?.values) ? comp.values : [];
      },
      getSelectedUsers: (customId: string) => {
        const comp = componentMap.get(customId);
        const ids = Array.isArray(comp?.values) ? comp.values : [];
        if (ids.length === 0) return null;

        const usersMap = new Map<
          string,
          { id: string; username: string; globalName: string | null; avatar: string | null }
        >();
        const resolvedUsers = this.raw.data?.resolved?.users ?? {};
        for (const uid of ids) {
          const u = resolvedUsers[uid];
          if (u) {
            usersMap.set(uid, {
              id: u.id,
              username: u.username,
              globalName: u.global_name ?? null,
              avatar: u.avatar ?? null,
            });
          }
        }
        return usersMap;
      },
    };
  }

  private buildGuildHelper(guildId: string) {
    const botToken = this.botToken;

    const toChannelObj = (
      c: DiscordApiChannel,
      byId?: Map<string, DiscordApiChannel>,
    ) => {
      const parentRaw = c.parent_id && byId ? byId.get(c.parent_id) : null;
      return {
        id: c.id,
        name: c.name ?? "channel",
        type: c.type,
        parentId: c.parent_id ?? null,
        parent: parentRaw
          ? {
              id: parentRaw.id,
              name: parentRaw.name ?? "channel",
              type: parentRaw.type,
              parentId: parentRaw.parent_id ?? null,
            }
          : null,
      };
    };

    const serializeScheduledEventPayload = (opts: Record<string, unknown>) => {
      const payload: Record<string, unknown> = {};
      if ("name" in opts) payload.name = opts.name;
      if (opts.scheduledStartTime instanceof Date) {
        payload.scheduled_start_time = opts.scheduledStartTime.toISOString();
      }
      if (opts.scheduledEndTime instanceof Date) {
        payload.scheduled_end_time = opts.scheduledEndTime.toISOString();
      }
      if ("privacyLevel" in opts) payload.privacy_level = opts.privacyLevel;
      if ("entityType" in opts) payload.entity_type = opts.entityType;
      if ("entityMetadata" in opts) payload.entity_metadata = opts.entityMetadata;
      if ("recurrenceRule" in opts) {
        const rule = opts.recurrenceRule as
          | {
              startAt: Date;
              frequency: number;
              interval: number;
              byWeekday?: number[];
            }
          | null
          | undefined;
        payload.recurrence_rule = rule
          ? {
              start: rule.startAt.toISOString(),
              frequency: rule.frequency,
              interval: rule.interval,
              by_weekday: rule.byWeekday,
            }
          : null;
      }
      return payload;
    };

    return {
      id: guildId,
      channels: {
        fetch: async (id?: string) => {
          if (id) {
            const c = await fetchDiscordChannel(id, botToken);
            return c ? toChannelObj(c) : null;
          }
          const list = await fetchGuildChannels(guildId, botToken);
          if (!list) return null;
          const byId = new Map(list.map((c) => [c.id, c]));
          return new Map(list.map((c) => [c.id, toChannelObj(c, byId)]));
        },
        fetchActiveThreads: async () => {
          const [threads, channels] = await Promise.all([
            fetchGuildActiveThreads(guildId, botToken),
            fetchGuildChannels(guildId, botToken),
          ]);
          const byId = new Map((channels ?? []).map((c) => [c.id, c]));
          const map = new Map(
            (threads ?? []).map((t) => [t.id, toChannelObj(t, byId)]),
          );
          return { threads: map };
        },
      },
      scheduledEvents: {
        create: async (opts: Record<string, unknown>) => {
          return createGuildScheduledEvent(
            guildId,
            serializeScheduledEventPayload(opts),
            botToken,
          );
        },
        edit: async (eventId: string, opts: Record<string, unknown>) => {
          return editGuildScheduledEvent(
            guildId,
            eventId,
            serializeScheduledEventPayload(opts),
            botToken,
          );
        },
        delete: async (eventId: string) => {
          return deleteGuildScheduledEvent(guildId, eventId, botToken);
        },
      },
    };
  }
}
