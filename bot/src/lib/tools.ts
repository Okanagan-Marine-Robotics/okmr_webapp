import { prisma } from "@club/db";
import type { AutocompleteInteraction } from "discord.js";

// Discord caps an autocomplete response at 25 choices, and each name/value at
// 100 characters.
const MAX_CHOICES = 25;
const MAX_LEN = 100;

// Tool names are free text, so matching has to ignore case. Doing it in JS
// rather than the query avoids SQLite's case-sensitive `=` collation.
export function sameTool(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function teamForChannel(discordChannelId: string) {
  return prisma.team.findUnique({ where: { discordChannelId } });
}

export function outstandingLoans(teamId: string) {
  return prisma.toolLoan.findMany({
    where: { teamId, checkedInAt: null },
    include: { borrower: true },
    orderBy: { checkedOutAt: "asc" },
  });
}

function respond(interaction: AutocompleteInteraction, names: string[]) {
  const focused = interaction.options.getFocused().trim().toLowerCase();
  const choices = names
    .filter((name) => name.toLowerCase().includes(focused))
    .slice(0, MAX_CHOICES)
    .map((name) => ({ name: name.slice(0, MAX_LEN), value: name.slice(0, MAX_LEN) }));
  return interaction.respond(choices);
}

// /chkin: only what this channel's team actually has out — that list *is* the
// answer to "what do we still have".
export async function suggestCheckedOutTools(interaction: AutocompleteInteraction) {
  const team = await teamForChannel(interaction.channelId);
  if (!team) return interaction.respond([]);
  const loans = await outstandingLoans(team.id);
  return respond(interaction, loans.map((loan) => loan.tool));
}

// /chkout: every tool name used before, so the same drill doesn't end up
// recorded three different ways.
export async function suggestKnownTools(interaction: AutocompleteInteraction) {
  const loans = await prisma.toolLoan.findMany({
    select: { tool: true },
    distinct: ["tool"],
    orderBy: { tool: "asc" },
    take: 200,
  });
  return respond(interaction, loans.map((loan) => loan.tool));
}
