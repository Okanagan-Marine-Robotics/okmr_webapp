import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam, resolveUser } from "../lib/context.js";
import { formatLocalDateTime } from "../lib/date.js";

export const devlog: Command = {
  data: new SlashCommandBuilder()
    .setName("devlog")
    .setDescription("Log a quick design decision or note for this team's dev journal")
    .addStringOption((o) =>
      o
        .setName("entry")
        .setDescription("What changed or was decided (a sentence or two)")
        .setRequired(true)
        .setMaxLength(1000),
    ),

  async execute(interaction) {
    const body = interaction.options.getString("entry", true).trim();
    if (!body) {
      await interaction.reply({
        content: "Give the entry some text.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const team = await resolveTeam(interaction);
    if (!team) return;
    const author = await resolveUser(interaction.user);

    const log = await prisma.devLog.create({
      data: { teamId: team.id, authorId: author.id, kind: "note", body },
    });

    const embed = new EmbedBuilder()
      .setTitle("📓 Dev log added")
      .setDescription(body)
      .setFooter({
        text: `${team.name} · ${author.username} · ${formatLocalDateTime(log.createdAt)}`,
      });

    await interaction.reply({ embeds: [embed] });
  },
};
