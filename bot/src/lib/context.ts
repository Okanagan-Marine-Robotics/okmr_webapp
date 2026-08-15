import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  User as DiscordUser,
} from "discord.js";
import {
  getOrCreateParentTeam,
  getOrCreateTeamForChannel,
  upsertUser,
} from "@club/db/helpers";
import type { Team, User } from "@club/db";

// Interactions that carry a channel + can reply: slash commands, form submits
// and button clicks.
type ChannelInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction;

// Resolve the Team for the channel a command ran in, creating it on first use.
// Returns null (and replies with an error) if the command wasn't run in a
// guild text channel.
export async function resolveTeam(
  interaction: ChannelInteraction,
): Promise<Team | null> {
  const channel = interaction.channel;
  if (!interaction.guildId || !channel || channel.isDMBased()) {
    await interaction.reply({
      content: "Run this command in a server channel, not a DM.",
      ephemeral: true,
    });
    return null;
  }

  const channelName = "name" in channel ? channel.name : "channel";

  // A forum post's parent is its forum; a text channel's parent is its
  // category. Discord calls those different things, but both are "the thing
  // this groups under", so no channel-type branching is needed here.
  //
  // We deliberately stop after one hop: a forum inside a category groups under
  // the forum, not the category, which is what gives one pill per forum.
  const parentId = "parentId" in channel ? channel.parentId : null;
  let parentTeamId: string | null = null;

  if (parentId) {
    // The Guilds intent keeps forums and categories cached; fall back to an API
    // fetch for one the bot hasn't seen this session.
    const parentChannel =
      ("parent" in channel ? channel.parent : null) ??
      (await interaction.guild?.channels.fetch(parentId).catch(() => null)) ??
      null;

    if (parentChannel && "name" in parentChannel) {
      const parentTeam = await getOrCreateParentTeam({
        discordChannelId: parentId,
        channelName: parentChannel.name,
      });
      parentTeamId = parentTeam.id;
    }
  }

  return getOrCreateTeamForChannel({
    discordChannelId: channel.id,
    channelName,
    parentTeamId,
  });
}

// Resolve a Discord user (invoker or a mentioned member) to our User row.
export async function resolveUser(discordUser: DiscordUser): Promise<User> {
  return upsertUser({
    discordId: discordUser.id,
    username: discordUser.globalName ?? discordUser.username,
    avatar: discordUser.avatar,
  });
}
