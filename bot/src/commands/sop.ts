import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../types.js";
import { listSops, readSop, sopTitle } from "../lib/sops.js";

// Embed descriptions cap at 4096 characters; past this we send the file itself
// rather than silently cutting a procedure in half.
const INLINE_LIMIT = 3800;

export const SOP_BUTTON_PREFIX = "sop:";

export const sop: Command = {
  data: new SlashCommandBuilder()
    .setName("sop")
    .setDescription("Show a standard operating procedure and log whether it was completed")
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("Which procedure?")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().trim().toLowerCase();
    const names = await listSops();
    await interaction.respond(
      names
        .filter((name) => name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((name) => ({ name: sopTitle(name).slice(0, 100), value: name.slice(0, 100) })),
    );
  },

  async execute(interaction) {
    const name = interaction.options.getString("name", true).trim();
    const text = await readSop(name);

    if (text === null) {
      const available = await listSops();
      await interaction.reply({
        content:
          `No SOP called **${name}**.` +
          (available.length > 0
            ? `\nAvailable: ${available.join(", ")}`
            : "\nThere are no SOP files yet — add a .txt file to `web/sops/`."),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const title = sopTitle(name);
    const tooLong = text.length > INLINE_LIMIT;

    const embed = new EmbedBuilder()
      .setTitle(`📋 ${title}`)
      .setDescription(tooLong ? "Full procedure attached below." : `\`\`\`\n${text}\n\`\`\``)
      .setFooter({
        text: "Completed runs are logged on the web app. Not completed just closes this.",
      });

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${SOP_BUTTON_PREFIX}done:${name}`)
        .setLabel("Completed")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${SOP_BUTTON_PREFIX}miss:${name}`)
        .setLabel("Not completed")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      embeds: [embed],
      components: [buttons],
      files: tooLong
        ? [new AttachmentBuilder(Buffer.from(text, "utf8"), { name: `${name}.txt` })]
        : [],
    });
  },
};
