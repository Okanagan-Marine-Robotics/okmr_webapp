import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../types.js";
import { IMPORTANCE_LEVELS } from "../lib/importance.js";

// Grouped rather than listed flat: with 18 commands, a single alphabetical wall
// is unreadable. Each section is one embed field, so the naming patterns
// (ls… = list, m… = modify, cl… = close) are visible at a glance.
//
// Field values cap at 1024 characters — keep entries terse when adding one.
const SECTIONS: { name: string; lines: string[] }[] = [
  {
    name: "📋 Tasks",
    lines: [
      "`/task` — open a form to create a task (assignees, importance, due date).",
      "`/lstask` — list this channel's open tasks, most important first.",
      "`/mdtask <name>` — edit a task.",
      "`/cltask <name>` — close a task.",
    ],
  },
  {
    name: "📅 Meetings",
    lines: [
      "`/meet` — schedule a meeting; creates a Discord event too.",
      "`/lsmeet [channel]` — list upcoming meetings.",
      "`/mdmeet <name>` — edit a meeting.",
      "`/clmeet <name>` — cancel a meeting.",
    ],
  },
  {
    name: "📝 Requests",
    lines: [
      "`/form <name>` — file a request: EDT space, vehicle, part order, or machine-shop time.",
      "`/lsforms [channel]` — open requests plus the last 5 resolved.",
      "`/lsalforms [channel]` — every request ever filed here.",
      "Leads approve or deny on the web app; the result gets posted back here.",
    ],
  },
  {
    name: "🔧 Tools",
    lines: [
      "`/chkout <tool>` — sign a tool out of the EDT for this team.",
      "`/chkin <tool>` — return it. The dropdown shows what your team still has.",
    ],
  },
  {
    name: "📓 Dev journal",
    lines: [
      "`/devlog <entry>` — log a quick design decision, one or two sentences.",
      "`/progupdate` — a longer update with a title, body and optional files/drawings.",
      "`/lslogs [channel]` — recent journal entries for a channel.",
    ],
  },
  {
    name: "📖 Procedures & emergencies",
    lines: [
      "`/sop <name>` — show a standard operating procedure and mark it done.",
      "`/911 [what]` — print the club's emergency info and log it.",
      "**If someone is seriously hurt, call emergency services first — don't wait on Discord.**",
    ],
  },
  {
    name: "⚙️ Setup",
    lines: [
      "`/config [days] [time] [ping]` — this channel's update schedule, e.g. `days:Mon,Thu time:09:00`. `days:off` pauses it.",
      "`/resync` — rebuild the website's channel list after adding a forum.",
      "`/help` — this menu.",
    ],
  },
];

export const help: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all bot commands and how to use them"),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle("Club Bot — Commands")
      .setDescription(
        "Everything is scoped to the channel you run it in, so run commands in your subteam's channel or forum post.\n" +
          "Naming: `ls…` lists, `m…`/`md…` modifies, `cl…` closes.",
      )
      .addFields(
        ...SECTIONS.map((section) => ({
          name: section.name,
          value: section.lines.join("\n"),
        })),
        {
          name: "Importance levels",
          value: IMPORTANCE_LEVELS.map((l) => `${l.emoji} ${l.label}`).join(" · "),
        },
      )
      .setFooter({ text: "Dates understand plain English — “next fri 3pm”, “tomorrow”, “in 2 weeks”." });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
