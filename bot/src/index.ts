import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { env } from "./env.js";
import { commandsByName } from "./commands/index.js";
import { handleTaskForm } from "./interactions/taskForm.js";
import { handleMeetForm } from "./interactions/meetForm.js";
import { handleFormSubmit } from "./interactions/formSubmit.js";
import { handleSopButton } from "./interactions/sopButton.js";
import { startScheduler } from "./lib/schedule.js";
import { registerScheduledEventSync } from "./events/scheduledEvents.js";
import { registerRoleSync, startRoleSyncScheduler } from "./lib/roleSync.js";
import { isAllowedGuild } from "./lib/security.js";

function createBotClient(withMemberSync: boolean): Client {
  // Guilds for slash commands; GuildScheduledEvents to receive event
  // create/update/delete gateway events for the calendar sync; GuildMembers
  // (when Server Members Intent is enabled) for real-time combined role sync.
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildScheduledEvents];
  if (withMemberSync) {
    intents.push(GatewayIntentBits.GuildMembers);
  }

  const client = new Client({ intents });

  // Mirror Discord Scheduled Events into our Meeting rows.
  registerScheduledEventSync(client);

  if (withMemberSync) {
    registerRoleSync(client);
  }

  client.once(Events.ClientReady, (c) => {
    console.log(`Bot online as ${c.user.tag}`);
    // Start posting scheduled channel update messages (see /config).
    startScheduler(client);
    if (withMemberSync) {
      startRoleSyncScheduler(env.guildId, env.botToken);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // Fence all Gateway interactions strictly to the configured OKMR Discord server.
      if (!isAllowedGuild(interaction.guildId)) {
        if (interaction.isAutocomplete()) {
          await interaction.respond([]).catch(() => {});
        } else if (interaction.isRepliable()) {
          await interaction
            .reply({
              content: "This bot is restricted to the OKMR Discord server.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = commandsByName.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isAutocomplete()) {
        const command = commandsByName.get(interaction.commandName);
        await command?.autocomplete?.(interaction);
        return;
      }

      if (interaction.isButton()) {
        if (await handleSopButton(interaction)) return;
        return;
      }

      if (interaction.isModalSubmit()) {
        if (await handleTaskForm(interaction)) return;
        if (await handleMeetForm(interaction)) return;
        if (await handleFormSubmit(interaction)) return;
        return;
      }
    } catch (error) {
      console.error("Interaction error:", error);
      // Best-effort error reply so the user isn't left with "interaction failed".
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "Something went wrong.", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  });

  return client;
}

function isDisallowedIntentsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  const msg = err instanceof Error ? err.message : String(err);
  return code === "DisallowedIntents" || msg.includes("DisallowedIntents") || msg.includes("4014");
}

async function startBot(): Promise<void> {
  const client = createBotClient(true);
  try {
    await client.login(env.botToken);
  } catch (err) {
    if (!isDisallowedIntentsError(err)) {
      throw err;
    }
    await client.destroy().catch(() => {});
    console.warn(
      "⚠️ Server Members Intent is not enabled in the Discord Developer Portal (DisallowedIntents).\n" +
        "   Enable 'Server Members Intent' under Bot -> Privileged Gateway Intents to activate automatic combined role syncing.\n" +
        "   Reconnecting without GuildMembers intent so slash commands and channel updates stay online...",
    );
    const fallbackClient = createBotClient(false);
    await fallbackClient.login(env.botToken);
  }
}

void startBot();
