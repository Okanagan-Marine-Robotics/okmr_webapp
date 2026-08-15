import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam } from "../lib/context.js";
import { formatMeetingLine } from "../lib/meetings.js";

export const clmeet: Command = {
  data: new SlashCommandBuilder()
    .setName("clmeet")
    .setDescription("Cancel a meeting for this channel")
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("Part of the meeting title to cancel")
        .setRequired(true),
    ),

  async execute(interaction) {
    const team = await resolveTeam(interaction);
    if (!team) return;

    const query = interaction.options.getString("name", true);

    // Prefer the nearest upcoming match; fall back to any match (e.g. a
    // recurring meeting whose first occurrence is already in the past).
    let meeting = await prisma.meeting.findFirst({
      where: { teamId: team.id, title: { contains: query }, startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    });
    if (!meeting) {
      meeting = await prisma.meeting.findFirst({
        where: { teamId: team.id, title: { contains: query } },
        orderBy: { startsAt: "desc" },
      });
    }

    if (!meeting) {
      await interaction.reply({
        content: `No meeting matching "${query}" in **${team.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Delete the Discord event (this also fires the sync listener, which removes
    // the Meeting row). Then delete the row directly so it's gone even if the
    // Discord event was already removed.
    if (meeting.discordEventId && interaction.guild) {
      await interaction.guild.scheduledEvents.delete(meeting.discordEventId).catch(() => {});
    }
    await prisma.meeting.deleteMany({ where: { id: meeting.id } });

    await interaction.reply({ content: `🗑️ Cancelled meeting: ${formatMeetingLine(meeting)}` });
  },
};
