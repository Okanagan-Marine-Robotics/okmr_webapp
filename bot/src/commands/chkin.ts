import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam, resolveUser } from "../lib/context.js";
import { formatLocalDateTime } from "../lib/date.js";
import { outstandingLoans, sameTool, suggestCheckedOutTools } from "../lib/tools.js";

export const chkin: Command = {
  data: new SlashCommandBuilder()
    .setName("chkin")
    .setDescription("Return a tool this team has checked out")
    .addStringOption((o) =>
      o
        .setName("tool")
        .setDescription("Which tool are you returning?")
        .setRequired(true)
        // Fills the dropdown with exactly what this channel's team still has
        // out, so nobody has to remember the name they used.
        .setAutocomplete(true),
    ),

  autocomplete: suggestCheckedOutTools,

  async execute(interaction) {
    const tool = interaction.options.getString("tool", true).trim();

    const team = await resolveTeam(interaction);
    if (!team) return;
    const returner = await resolveUser(interaction.user);

    const loans = await outstandingLoans(team.id);
    const loan = loans.find((l) => sameTool(l.tool, tool));

    if (!loan) {
      const has =
        loans.length > 0
          ? `\n**${team.name}** currently has: ${loans.map((l) => l.tool).join(", ")}.`
          : `\n**${team.name}** doesn't have anything checked out.`;
      await interaction.reply({
        content: `Couldn't find **${tool}** checked out to this team.${has}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const checkedInAt = new Date();
    await prisma.toolLoan.update({ where: { id: loan.id }, data: { checkedInAt } });

    const embed = new EmbedBuilder()
      .setTitle("✅ Tool returned")
      .addFields(
        { name: "Tool", value: loan.tool },
        { name: "Team", value: team.name, inline: true },
        { name: "Returned by", value: returner.username, inline: true },
        {
          name: "Out from → to",
          value: `${formatLocalDateTime(loan.checkedOutAt)} → ${formatLocalDateTime(checkedInAt)}`,
        },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
