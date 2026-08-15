import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam } from "../lib/context.js";
import { buildTaskModal } from "../lib/taskModal.js";

export const mdtask: Command = {
  data: new SlashCommandBuilder()
    .setName("mdtask")
    .setDescription("Find a task by name and open the form to edit it")
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("Part of the task name to find")
        .setRequired(true),
    ),

  async execute(interaction) {
    const team = await resolveTeam(interaction);
    if (!team) return;

    const query = interaction.options.getString("name", true);
    const task = await prisma.task.findFirst({
      where: { teamId: team.id, status: "open", title: { contains: query } },
      orderBy: { createdAt: "asc" },
      include: { assignees: { include: { user: true } } },
    });

    if (!task) {
      await interaction.reply({
        content: `No open task matching "${query}" in **${team.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = buildTaskModal({
      mode: "edit",
      taskId: task.id,
      title: task.title,
      dueDate: task.dueDate,
      notes: task.notes,
      importance: task.importance,
      defaultAssigneeDiscordIds: task.assignees.map((a) => a.user.discordId),
    });
    await interaction.showModal(modal);
  },
};
