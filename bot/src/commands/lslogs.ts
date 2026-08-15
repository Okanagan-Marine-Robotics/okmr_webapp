import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { formatLocalDateTime } from "../lib/date.js";

const SHOWN = 10;

export const lslogs: Command = {
  data: new SlashCommandBuilder()
    .setName("lslogs")
    .setDescription("List recent dev logs and updates for a channel")
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Which channel's log to show (default: this channel)"),
    ),

  async execute(interaction) {
    const target = interaction.options.getChannel("channel") ?? interaction.channel;
    if (!target) {
      await interaction.reply({
        content: "Couldn't work out which channel to use.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const label = "name" in target && target.name ? `#${target.name}` : "that channel";
    const team = await prisma.team.findUnique({ where: { discordChannelId: target.id } });
    if (!team) {
      await interaction.reply({
        content: `No dev journal for ${label} yet — a channel gets a team the first time a bot command is run in it.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [logs, total] = await Promise.all([
      prisma.devLog.findMany({
        where: { teamId: team.id },
        include: { author: true, _count: { select: { attachments: true } } },
        orderBy: { createdAt: "desc" },
        take: SHOWN,
      }),
      prisma.devLog.count({ where: { teamId: team.id } }),
    ]);

    if (total === 0) {
      await interaction.reply({
        content: `No dev logs for **${team.name}** yet. Add one with \`/devlog\` or \`/progupdate\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = logs.map((log) => {
      const icon = log.kind === "update" ? "📔" : "📓";
      const headline =
        log.kind === "update" ? (log.title ?? "Update") : log.body;
      const files = log._count.attachments > 0 ? ` 📎${log._count.attachments}` : "";
      return (
        `${icon} **${headline.slice(0, 120)}**${files}\n` +
        ` ${log.author.username} · ${formatLocalDateTime(log.createdAt)}`
      );
    });

    const embed = new EmbedBuilder()
      .setTitle(`📓 Dev journal — ${team.name}`)
      .setDescription(lines.join("\n"));

    if (total > SHOWN) {
      embed.setFooter({ text: `Showing ${SHOWN} of ${total}. See the full journal on the web app.` });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
