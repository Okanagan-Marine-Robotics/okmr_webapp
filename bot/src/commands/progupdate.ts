import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Attachment } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam, resolveUser } from "../lib/context.js";
import { formatLocalDateTime } from "../lib/date.js";
import { storeAttachment } from "../lib/uploads.js";

const FILE_OPTIONS = ["file", "file2", "file3", "file4"];

export const progupdate: Command = {
  data: (() => {
    const b = new SlashCommandBuilder()
      .setName("progupdate")
      .setDescription("Post a longer dev-journal update, with optional files/drawings")
      .addStringOption((o) =>
        o.setName("title").setDescription("Short title for this update").setRequired(true).setMaxLength(200),
      )
      .addStringOption((o) =>
        o
          .setName("body")
          .setDescription("The update — paste paragraphs here, or attach a doc below")
          .setRequired(true)
          .setMaxLength(4000),
      );
    // Discord modals can't upload files, so files come in as command options.
    for (const name of FILE_OPTIONS) {
      b.addAttachmentOption((o) =>
        o.setName(name).setDescription(`Attachment (image, PDF, drawing, ...)`),
      );
    }
    return b;
  })(),

  async execute(interaction) {
    const title = interaction.options.getString("title", true).trim();
    const body = interaction.options.getString("body", true).trim();

    const attachments = FILE_OPTIONS.map((name) =>
      interaction.options.getAttachment(name),
    ).filter((a): a is Attachment => a !== null);

    const team = await resolveTeam(interaction);
    if (!team) return;
    const author = await resolveUser(interaction.user);

    // Downloading can take a moment; defer so we don't hit the 3s deadline.
    await interaction.deferReply();

    const stored = [];
    for (const attachment of attachments) {
      const file = await storeAttachment(attachment);
      if (file) stored.push(file);
    }
    const failed = attachments.length - stored.length;

    await prisma.devLog.create({
      data: {
        teamId: team.id,
        authorId: author.id,
        kind: "update",
        title,
        body,
        attachments: { create: stored },
      },
    });

    const embed = new EmbedBuilder()
      .setTitle(`📔 ${title}`)
      .setDescription(body.length > 400 ? `${body.slice(0, 400)}…` : body)
      .setFooter({
        text: `${team.name} · ${author.username} · ${formatLocalDateTime(new Date())}`,
      });

    if (stored.length > 0) {
      embed.addFields({
        name: `Attachments (${stored.length})`,
        value: stored.map((f) => f.originalName).join("\n"),
      });
    }
    if (failed > 0) {
      embed.addFields({
        name: "⚠️ Skipped",
        value: `${failed} file(s) were too big (max 25 MB) or failed to download.`,
      });
    }

    await interaction.editReply({
      content: "Saved to the dev journal — view it with attachments on the web app.",
      embeds: [embed],
    });
  },
};
