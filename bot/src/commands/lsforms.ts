import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types.js";
import { runFormsList } from "../lib/ticketList.js";

export const lsforms: Command = {
  data: new SlashCommandBuilder()
    .setName("lsforms")
    .setDescription("List open forms for a channel, plus the last 5 resolved")
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Which channel's forms to show (default: this channel)"),
    ),

  async execute(interaction) {
    await runFormsList(interaction, { all: false });
  },
};
