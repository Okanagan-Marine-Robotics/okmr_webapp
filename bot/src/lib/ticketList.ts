import { EmbedBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "@club/db";
import { findForm } from "./forms.js";
import { formatLocalDateTime } from "./date.js";

const STATUS_EMOJI: Record<string, string> = {
  open: "🕓",
  approved: "✅",
  denied: "❌",
  // Emergencies are closed with "handled" — nothing about them is approved.
  handled: "✅",
};

// Discord embeds cap the description at 4096 characters; this keeps us well
// clear of that on a channel with a long history.
const MAX_LINES = 40;

export function parseTicketDetails(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// The one answer that best identifies a request at a glance. Falls back through
// the fields the different forms use for "what is this about".
export function ticketSummary(details: Record<string, string>): string {
  const sop = details.sop ? `${details.sop} — ${details.outcome ?? ""}`.trim() : null;
  return sop ?? details.part ?? details.purpose ?? details.what ?? details.when ?? "—";
}

// Ticket types that don't come from a modal form, so aren't in the catalogue.
const EXTRA_LABELS: Record<string, string> = {
  sop: "SOP",
  emergency: "Emergency",
};

export function typeName(type: string): string {
  return findForm(type)?.short ?? EXTRA_LABELS[type] ?? type.replace(/_/g, " ");
}

interface ListableTicket {
  type: string;
  status: string;
  details: string;
  createdAt: Date;
  resolvedAt: Date | null;
  requester: { username: string };
}

export function formatTicketLine(ticket: ListableTicket): string {
  const details = parseTicketDetails(ticket.details);
  const emoji = STATUS_EMOJI[ticket.status] ?? "•";
  // fullName is what the submitter typed; fall back to their Discord name.
  const who = details.fullName ?? ticket.requester.username;

  // Second line carries the timestamps so the first stays scannable.
  const stamps = [`submitted ${formatLocalDateTime(ticket.createdAt)}`];
  if (ticket.resolvedAt) {
    stamps.push(`${ticket.status} ${formatLocalDateTime(ticket.resolvedAt)}`);
  }

  return (
    `${emoji} **${typeName(ticket.type)}** — ${ticketSummary(details)} · ${who}\n` +
    ` ${stamps.join(" · ")}`
  );
}

function section(heading: string, lines: string[]): string {
  const shown = lines.slice(0, MAX_LINES);
  const extra = lines.length - shown.length;
  return [
    `**${heading}**`,
    ...shown,
    extra > 0 ? `_…and ${extra} more_` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// Shared body of /lsforms and /lsalforms. `all` lists every form ever
// submitted in the channel; otherwise only open ones plus the last 5 resolved.
export async function runFormsList(
  interaction: ChatInputCommandInteraction,
  opts: { all: boolean },
) {
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
      content: `No forms for ${label} yet — a channel gets a team the first time a bot command is run in it.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tickets = await prisma.ticket.findMany({
    where: { teamId: team.id },
    include: { requester: true },
    orderBy: { createdAt: "desc" },
  });

  if (tickets.length === 0) {
    await interaction.reply({
      content: `No forms have been submitted in **${team.name}** yet.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const open = tickets.filter((t) => t.status === "open");
  const resolved = tickets.filter((t) => t.status !== "open");

  const parts: string[] = [];
  if (opts.all) {
    parts.push(section(`All forms (${tickets.length})`, tickets.map(formatTicketLine)));
  } else {
    parts.push(
      open.length > 0
        ? section(`Open (${open.length})`, open.map(formatTicketLine))
        : "**Open (0)**\n_Nothing waiting._",
    );
    if (resolved.length > 0) {
      const recent = resolved.slice(0, 5);
      parts.push(
        section(
          `Resolved${resolved.length > recent.length ? ` (latest 5 of ${resolved.length})` : ""}`,
          recent.map(formatTicketLine),
        ),
      );
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 Forms — ${team.name}`)
    .setDescription(parts.join("\n\n"));

  if (!opts.all && resolved.length > 5) {
    embed.setFooter({ text: "Run /lsalforms to see every form for this channel." });
  }

  await interaction.reply({ embeds: [embed] });
}
