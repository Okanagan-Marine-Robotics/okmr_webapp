import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam } from "../lib/context.js";
import { renderTaskBlock } from "../lib/taskList.js";

export const lstask: Command = {
  data: new SlashCommandBuilder()
    .setName("lstask")
    .setDescription("List open tasks for this channel, most important first"),

  async execute(interaction) {
    const team = await resolveTeam(interaction);
    if (!team) return;

    const tasks = await prisma.task.findMany({
      where: { teamId: team.id, status: "open" },
      include: { assignees: { include: { user: true } } },
    });

    if (tasks.length === 0) {
      await interaction.reply({
        content: `No open tasks for **${team.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `**Open tasks — ${team.name}**\n${renderTaskBlock(tasks)}`,
    });
  },
};
