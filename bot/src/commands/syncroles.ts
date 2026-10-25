import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../types.js";
import { env, isCloudflareWorkers } from "../env.js";
import { isAllowedGuild, isMemberLeadOrAdmin } from "../lib/security.js";
import {
  WORKER_MAX_ROLE_MUTATIONS,
  formatRoleSyncReport,
  syncGuildCombinedRoles,
} from "../lib/roleSync.js";

export const syncroles: Command = {
  data: new SlashCommandBuilder()
    .setName("syncroles")
    .setDescription(
      "Sync combined team + discipline roles (e.g. AUV Software) across all server members",
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild || !isAllowedGuild(interaction.guildId)) {
      await interaction.reply({
        content: "Run this command inside the OKMR Discord server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!isMemberLeadOrAdmin(interaction)) {
      await interaction.reply({
        content: "Only club leads or server admins can run `/syncroles`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const summary = await syncGuildCombinedRoles(guild.id, env.botToken, {
      maxMutations: isCloudflareWorkers() ? WORKER_MAX_ROLE_MUTATIONS : undefined,
    });

    await interaction.editReply(formatRoleSyncReport(summary).slice(0, 1990));
  },
};
