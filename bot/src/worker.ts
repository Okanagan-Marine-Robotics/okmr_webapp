// Cloudflare Worker entrypoint for the Discord bot.
// - `fetch`: Handles Discord HTTP Interactions (`POST /` or `POST /interactions`)
//   verified via Ed25519 Web Crypto, plus `GET /health`.
// - `scheduled`: Runs on Cloudflare Cron Triggers (`*/5 * * * *`) to post
//   scheduled channel update messages (/config) and sync Discord Scheduled Events.

import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { setD1Database, type D1DatabaseLike } from "@okmr_webapp/db";
import { setR2Bucket, type R2BucketLike } from "@okmr_webapp/storage";
import { commandsByName } from "./commands/index.js";
import { handleTaskForm } from "./interactions/taskForm.js";
import { handleMeetForm } from "./interactions/meetForm.js";
import { handleFormSubmit } from "./interactions/formSubmit.js";
import { handleSopButton } from "./interactions/sopButton.js";
import { runDueUpdates } from "./lib/schedule.js";
import { syncGuildScheduledEventsViaRest } from "./events/scheduledEvents.js";
import {
  HttpInteractionAdapter,
  InteractionResponseType,
  InteractionType,
  verifyDiscordSignature,
  type RawDiscordInteraction,
} from "./lib/httpInteraction.js";

export interface BotWorkerEnv {
  DB?: D1DatabaseLike;
  UPLOADS_BUCKET?: R2BucketLike;
  DISCORD_BOT_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_GUILD_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_LEAD_ROLE_IDS?: string;
  CLUB_TIMEZONE?: string;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
}

function configureWorkerBindings(workerEnv: BotWorkerEnv): void {
  if (workerEnv.DB) {
    setD1Database(workerEnv.DB);
  }
  if (workerEnv.UPLOADS_BUCKET) {
    setR2Bucket(workerEnv.UPLOADS_BUCKET);
  }
  if (typeof process !== "undefined" && process.env) {
    if (workerEnv.DISCORD_BOT_TOKEN) process.env.DISCORD_BOT_TOKEN = workerEnv.DISCORD_BOT_TOKEN;
    if (workerEnv.DISCORD_CLIENT_ID) process.env.DISCORD_CLIENT_ID = workerEnv.DISCORD_CLIENT_ID;
    if (workerEnv.DISCORD_GUILD_ID) process.env.DISCORD_GUILD_ID = workerEnv.DISCORD_GUILD_ID;
    if (workerEnv.DISCORD_PUBLIC_KEY) process.env.DISCORD_PUBLIC_KEY = workerEnv.DISCORD_PUBLIC_KEY;
    if (workerEnv.DISCORD_LEAD_ROLE_IDS !== undefined) {
      process.env.DISCORD_LEAD_ROLE_IDS = workerEnv.DISCORD_LEAD_ROLE_IDS;
    }
    if (workerEnv.CLUB_TIMEZONE) process.env.CLUB_TIMEZONE = workerEnv.CLUB_TIMEZONE;
  }
}

export async function dispatchAdapterInteraction(
  interaction: HttpInteractionAdapter,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command) {
        await interaction.reply({
          content: `Unknown command: ${interaction.commandName}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await command.execute(interaction as unknown as ChatInputCommandInteraction);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = commandsByName.get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction as unknown as AutocompleteInteraction);
      } else {
        await interaction.respond([]);
      }
      return;
    }

    if (interaction.isButton()) {
      const asButton = interaction as unknown as ButtonInteraction;
      if (await handleSopButton(asButton)) return;
    } else if (interaction.isModalSubmit()) {
      const asModal = interaction as unknown as ModalSubmitInteraction;
      if (await handleTaskForm(asModal)) return;
      if (await handleMeetForm(asModal)) return;
      if (await handleFormSubmit(asModal)) return;
    }

    // Never leave `getHttpResponse()` unresolved if an unknown custom_id or
    // unsupported interaction type arrives.
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Unsupported or expired interaction.",
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error("Worker interaction error:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    } else if (interaction.deferred) {
      await interaction
        .editReply({ content: "Something went wrong." })
        .catch(() => {});
    }
  }
}

const worker = {
  async fetch(
    request: Request,
    workerEnv: BotWorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<Response> {
    configureWorkerBindings(workerEnv);

    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json({ ok: true, service: "okmr-bot" });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    const rawBody = await request.text();

    const isValid = await verifyDiscordSignature(
      rawBody,
      signature,
      timestamp,
      workerEnv.DISCORD_PUBLIC_KEY,
    );
    if (!isValid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    let payload: RawDiscordInteraction;
    try {
      payload = JSON.parse(rawBody) as RawDiscordInteraction;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    if (payload.type === InteractionType.PING) {
      return Response.json({ type: InteractionResponseType.PONG });
    }

    // Fence all HTTP Interactions strictly to the configured OKMR Discord server.
    if (
      !workerEnv.DISCORD_GUILD_ID ||
      !payload.guild_id ||
      payload.guild_id !== workerEnv.DISCORD_GUILD_ID
    ) {
      if (payload.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
        return Response.json({
          type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
          data: { choices: [] },
        });
      }
      return Response.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "This bot is restricted to the OKMR Discord server.",
          flags: Number(MessageFlags.Ephemeral),
        },
      });
    }

    const interaction = new HttpInteractionAdapter(payload, workerEnv.DISCORD_BOT_TOKEN);
    const executionPromise = dispatchAdapterInteraction(interaction);
    ctx.waitUntil(executionPromise);

    return interaction.getHttpResponse();
  },

  async scheduled(
    _controller: ScheduledControllerLike,
    workerEnv: BotWorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<void> {
    configureWorkerBindings(workerEnv);

    const work = async () => {
      await Promise.allSettled([
        runDueUpdates(workerEnv.DISCORD_BOT_TOKEN),
        workerEnv.DISCORD_GUILD_ID && workerEnv.DISCORD_BOT_TOKEN
          ? syncGuildScheduledEventsViaRest(
              workerEnv.DISCORD_GUILD_ID,
              workerEnv.DISCORD_BOT_TOKEN,
            )
          : Promise.resolve(),
      ]);
    };

    ctx.waitUntil(work());
  },
};

export default worker;
