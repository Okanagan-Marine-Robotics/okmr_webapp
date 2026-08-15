import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam } from "../lib/context.js";

export const cltask: Command = {
  data: new SlashCommandBuilder()
    .setName("cltask")
    .setDescription("Close a task (mark it done)")
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("Part of the task name to close")
        .setRequired(true),
    ),

  async execute(interaction) {
    const team = await resolveTeam(interaction);
    if (!team) return;

    const query = interaction.options.getString("name", true);
    const task = await prisma.task.findFirst({
      where: { teamId: team.id, status: "open", title: { contains: query } },
      orderBy: { createdAt: "asc" },
    });

    if (!task) {
      await interaction.reply({
        content: `No open task matching "${query}" in **${team.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await prisma.task.update({
      where: { id: task.id },
      data: { status: "done" },
    });

    await interaction.reply({ content: `✅ Closed **${task.title}** (marked done).` });
  },
};
