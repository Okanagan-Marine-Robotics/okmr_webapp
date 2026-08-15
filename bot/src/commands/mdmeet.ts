import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam } from "../lib/context.js";
import { buildMeetModal } from "../lib/meetModal.js";
import { formatLocalDateTime } from "../lib/date.js";

export const mdmeet: Command = {
  data: new SlashCommandBuilder()
    .setName("mdmeet")
    .setDescription("Find a meeting by name and open the form to edit it")
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("Part of the meeting title to edit")
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

    const durationMinutes = meeting.endsAt
      ? Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000)
      : undefined;

    const modal = buildMeetModal({
      mode: "edit",
      meetingId: meeting.id,
      title: meeting.title,
      whenValue: formatLocalDateTime(meeting.startsAt),
      room: meeting.location,
      recurrence: meeting.recurrence,
      durationMinutes,
    });
    await interaction.showModal(modal);
  },
};
