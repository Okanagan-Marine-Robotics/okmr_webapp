import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { formatMeetingLine } from "../lib/meetings.js";

export const lsmeet: Command = {
  data: new SlashCommandBuilder()
    .setName("lsmeet")
    .setDescription("List upcoming meetings for a channel (defaults to the current one)")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Which channel's meetings to show (default: this channel)"),
    ),

  async execute(interaction) {
    // Use the picked channel, or fall back to the channel the command ran in.
    const target = interaction.options.getChannel("channel") ?? interaction.channel;
    if (!target) {
      await interaction.reply({
        content: "Couldn't work out which channel to use.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const label = "name" in target && target.name ? `#${target.name}` : "that channel";
    const team = await prisma.team.findUnique({
      where: { discordChannelId: target.id },
    });
    if (!team) {
      await interaction.reply({
        content: `No meetings for ${label} yet — a channel gets a team the first time a bot command is run in it.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const meetings = await prisma.meeting.findMany({
      where: { teamId: team.id, startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    });
    if (meetings.length === 0) {
      await interaction.reply({
        content: `No upcoming meetings for **${team.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📅 Upcoming meetings — ${team.name}`)
      .setDescription(meetings.map((m) => `• ${formatMeetingLine(m)}`).join("\n"));
    await interaction.reply({ embeds: [embed] });
  },
};
