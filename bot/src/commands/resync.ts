import { ChannelType, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { GuildBasedChannel, NonThreadGuildBasedChannel } from "discord.js";
import { getOrCreateParentTeam, getOrCreateTeamForChannel } from "@club/db/helpers";
import type { Command } from "../types.js";

// Channels a team can meaningfully hang off: forum posts and threads group
// under their forum/parent channel, plain channels under their category.
const GROUPABLE = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

export const resync: Command = {
  data: new SlashCommandBuilder()
    .setName("resync")
    .setDescription("Rebuild the website's channel list from this server (safe to re-run)"),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "Run this command in a server channel, not a DM.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetching refreshes the cache so forums nobody has posted in yet are seen.
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) {
      await interaction.editReply("Couldn't read this server's channels.");
      return;
    }

    // Active threads are not part of the channel list and have to be asked for
    // separately, otherwise forum posts stay invisible until someone runs a
    // command inside one.
    const threads = await guild.channels.fetchActiveThreads().catch(() => null);

    const nonThreads = [...channels.values()].filter(
      (c): c is NonThreadGuildBasedChannel => c !== null,
    );
    const all: GuildBasedChannel[] = [
      ...nonThreads,
      ...(threads ? [...threads.threads.values()] : []),
    ];

    let groups = 0;
    let linked = 0;

    for (const channel of all) {
      if (!GROUPABLE.has(channel.type)) continue;

      let parentTeamId: string | null = null;
      const parent = channel.parent;
      if (parent) {
        const parentTeam = await getOrCreateParentTeam({
          discordChannelId: parent.id,
          channelName: parent.name,
        });
        parentTeamId = parentTeam.id;
        groups++;
      }

      await getOrCreateTeamForChannel({
        discordChannelId: channel.id,
        channelName: channel.name,
        parentTeamId,
      });
      linked++;
    }

    await interaction.editReply(
      `Synced ${linked} channel${linked === 1 ? "" : "s"}${
        groups > 0 ? ` across ${new Set(all.map((c) => c.parentId).filter(Boolean)).size} group(s)` : ""
      }. The website's Tasks and Calendar filters are up to date.`,
    );
  },
};
