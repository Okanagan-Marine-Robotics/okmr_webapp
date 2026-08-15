import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types.js";
import { runFormsList } from "../lib/ticketList.js";

export const lsalforms: Command = {
  data: new SlashCommandBuilder()
    .setName("lsalforms")
    .setDescription("List every form ever submitted in a channel, with its status")
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Which channel's forms to show (default: this channel)"),
    ),

  async execute(interaction) {
    await runFormsList(interaction, { all: true });
  },
};
