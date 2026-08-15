import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam } from "../lib/context.js";
import {
  daysToCsv,
  formatDays,
  formatTimeOfDay,
  parseTimeOfDay,
  parseWeekdays,
} from "../lib/weekdays.js";

interface ConfigLike {
  updateDays: string;
  updateHour: number;
  updateMinute: number;
  pingAssignee: boolean;
}

const DEFAULTS: ConfigLike = {
  updateDays: "",
  updateHour: 9,
  updateMinute: 0,
  pingAssignee: false,
};

function describeConfig(c: ConfigLike): string {
  const when = formatDays(c.updateDays);
  const time = formatTimeOfDay(c.updateHour, c.updateMinute);
  const schedule =
    c.updateDays === "" ? "**never** (paused)" : `**${when}** at **${time}**`;
  return [
    `• Update message posts: ${schedule}`,
    `• Ping assignees of due-soon tasks: **${c.pingAssignee ? "on" : "off"}**`,
  ].join("\n");
}

export const config: Command = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("View or change this channel's update-message schedule")
    .addStringOption((o) =>
      o
        .setName("days")
        .setDescription('Weekdays to post, e.g. "Mon,Thu" — or "off" to pause'),
    )
    .addStringOption((o) =>
      o.setName("time").setDescription('Time to post, 24h "HH:MM", e.g. 09:00'),
    )
    .addBooleanOption((o) =>
      o
        .setName("ping")
        .setDescription("Also @-ping assignees of due-soon tasks"),
    ),

  async execute(interaction) {
    const team = await resolveTeam(interaction);
    if (!team) return;

    const existing = await prisma.channelConfig.findUnique({
      where: { teamId: team.id },
    });
    const current: ConfigLike = existing ?? DEFAULTS;

    const daysOpt = interaction.options.getString("days");
    const timeOpt = interaction.options.getString("time");
    const pingOpt = interaction.options.getBoolean("ping");

    // No options → just show the current settings.
    if (daysOpt === null && timeOpt === null && pingOpt === null) {
      await interaction.reply({
        content: `**Update settings — ${team.name}**\n${describeConfig(current)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const next: ConfigLike = { ...current };

    if (daysOpt !== null) {
      const parsed = parseWeekdays(daysOpt);
      if ("error" in parsed) {
        await interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });
        return;
      }
      next.updateDays = daysToCsv(parsed.days);
    }

    if (timeOpt !== null) {
      const time = parseTimeOfDay(timeOpt);
      if (!time) {
        await interaction.reply({
          content: `Couldn't read "${timeOpt}" as a time. Use 24-hour HH:MM, e.g. 09:00.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      next.updateHour = time.hour;
      next.updateMinute = time.minute;
    }

    if (pingOpt !== null) next.pingAssignee = pingOpt;

    await prisma.channelConfig.upsert({
      where: { teamId: team.id },
      create: { teamId: team.id, ...next },
      update: next,
    });

    await interaction.reply({
      content: `**Update settings saved — ${team.name}**\n${describeConfig(next)}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
