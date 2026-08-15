import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam, resolveUser } from "../lib/context.js";
import { formatLocalDateTime } from "../lib/date.js";
import { sameTool, suggestKnownTools } from "../lib/tools.js";

export const chkout: Command = {
  data: new SlashCommandBuilder()
    .setName("chkout")
    .setDescription("Check a tool out of the EDT for this team")
    .addStringOption((o) =>
      o
        .setName("tool")
        .setDescription("Which tool are you taking?")
        .setRequired(true)
        // Suggests tool names already in use so the same drill isn't recorded
        // three different ways.
        .setAutocomplete(true),
    ),

  autocomplete: suggestKnownTools,

  async execute(interaction) {
    const tool = interaction.options.getString("tool", true).trim();
    if (!tool) {
      await interaction.reply({
        content: "Give the tool a name.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const team = await resolveTeam(interaction);
    if (!team) return;
    const borrower = await resolveUser(interaction.user);

    // Anything still out anywhere, so we can say who has it rather than
    // silently recording the same tool as being in two places.
    const out = await prisma.toolLoan.findMany({
      where: { checkedInAt: null },
      include: { borrower: true, team: true },
    });
    const clash = out.find((loan) => sameTool(loan.tool, tool));

    if (clash) {
      const who =
        clash.teamId === team.id
          ? `you already have it out (${clash.borrower.username})`
          : `**${clash.team.name}** has it out (${clash.borrower.username})`;
      await interaction.reply({
        content:
          `⚠️ **${clash.tool}** is already checked out — ${who} since ${formatLocalDateTime(clash.checkedOutAt)}.\n` +
          `Have them run \`/chkin\` first. If this is a second one, give it a distinct name like "${tool} 2".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const loan = await prisma.toolLoan.create({
      data: { tool, teamId: team.id, borrowerId: borrower.id },
    });

    const embed = new EmbedBuilder()
      .setTitle("🔧 Tool checked out")
      .addFields(
        { name: "Tool", value: loan.tool },
        { name: "Team", value: team.name, inline: true },
        { name: "Taken by", value: borrower.username, inline: true },
        { name: "When", value: formatLocalDateTime(loan.checkedOutAt), inline: true },
      )
      .setFooter({ text: "Run /chkin when it goes back." });

    await interaction.reply({ embeds: [embed] });
  },
};
