import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../types.js";
import { FORMS, buildFormModal, findForm } from "../lib/forms.js";

export const form: Command = {
  data: new SlashCommandBuilder()
    .setName("form")
    .setDescription("Open a request form (EDT space, vehicle, part order, machine shop)")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Which form to open")
        .setRequired(true)
        // Choices give a dropdown instead of free text, so nobody has to guess
        // the spelling of a form name.
        .addChoices(...FORMS.map((f) => ({ name: f.label, value: f.type }))),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Run this command in a server channel, not a DM.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const type = interaction.options.getString("name", true);
    const def = findForm(type);
    if (!def) {
      await interaction.reply({
        content: `There's no form called "${type}".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(buildFormModal(def));
  },
};
