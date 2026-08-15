import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../types.js";
import { buildTaskModal } from "../lib/taskModal.js";

export const task: Command = {
  data: new SlashCommandBuilder()
    .setName("task")
    .setDescription("Open a form to create a task for this channel's team"),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Run this command in a server channel, not a DM.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Default the assignee picker to the person creating the task.
    const modal = buildTaskModal({
      mode: "new",
      defaultAssigneeDiscordIds: [interaction.user.id],
    });
    await interaction.showModal(modal);
  },
};
