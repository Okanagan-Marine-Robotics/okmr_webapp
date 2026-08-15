import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../types.js";
import { buildMeetModal } from "../lib/meetModal.js";

export const meet: Command = {
  data: new SlashCommandBuilder()
    .setName("meet")
    .setDescription("Open a form to schedule a meeting (Discord event + calendar entry)"),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Run this command in a server channel, not a DM.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(buildMeetModal());
  },
};
