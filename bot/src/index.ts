import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { env } from "./env.js";
import { commandsByName } from "./commands/index.js";
import { handleTaskForm } from "./interactions/taskForm.js";
import { handleMeetForm } from "./interactions/meetForm.js";
import { handleFormSubmit } from "./interactions/formSubmit.js";
import { handleSopButton } from "./interactions/sopButton.js";
import { startScheduler } from "./lib/schedule.js";
import { registerScheduledEventSync } from "./events/scheduledEvents.js";

const client = new Client({
  // Guilds for slash commands; GuildScheduledEvents to receive event
  // create/update/delete gateway events for the calendar sync.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildScheduledEvents],
});

// Mirror Discord Scheduled Events into our Meeting rows.
registerScheduledEventSync(client);

client.once(Events.ClientReady, (c) => {
  console.log(`Bot online as ${c.user.tag}`);
  // Start posting scheduled channel update messages (see /config).
  startScheduler(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
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

client.login(env.botToken);
