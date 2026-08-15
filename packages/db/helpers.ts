// Small reusable helpers shared by the bot commands (and later the web app)
// for the two things nearly every command needs: resolve the Discord user to a
// User row, and resolve the channel the command ran in to a Team row.

import { prisma } from "./index.js";

export async function upsertUser(input: {
  discordId: string;
  username: string;
  avatar?: string | null;
}) {
  return prisma.user.upsert({
    where: { discordId: input.discordId },
    update: { username: input.username, avatar: input.avatar ?? null },
    create: {
      discordId: input.discordId,
      username: input.username,
      avatar: input.avatar ?? null,
    },
  });
}

// A slash command run in a channel belongs to that channel's team. If we've
// never seen the channel before, create a Team for it named after the channel.
//
// Discord is the source of truth for the name and the parent, so this heals
// renames and moves — but only writes when Discord actually disagrees with us,
// so the common case (nothing changed) stays a single read.
export async function getOrCreateTeamForChannel(input: {
  discordChannelId: string;
  channelName: string;
  parentTeamId?: string | null;
}) {
  const parentId = input.parentTeamId ?? null;

  const existing = await prisma.team.findUnique({
    where: { discordChannelId: input.discordChannelId },
  });

  if (!existing) {
    return prisma.team.create({
      data: {
        name: input.channelName,
        discordChannelId: input.discordChannelId,
        parentId,
      },
    });
  }

  if (existing.name === input.channelName && existing.parentId === parentId) {
    return existing;
  }

  return prisma.team.update({
    where: { id: existing.id },
    data: { name: input.channelName, parentId },
  });
}

// The container a channel hangs off — a forum (for a post) or a category (for a
// text channel). Deliberately writes the name only and never touches parentId:
// a thread inside #general makes us upsert #general as a container, and if that
// also cleared #general's own parent, the next command run in #general itself
// would set it back, flip-flopping the row on every command.
export async function getOrCreateParentTeam(input: {
  discordChannelId: string;
  channelName: string;
}) {
  const existing = await prisma.team.findUnique({
    where: { discordChannelId: input.discordChannelId },
  });

  if (!existing) {
    return prisma.team.create({
      data: { name: input.channelName, discordChannelId: input.discordChannelId },
    });
  }

  if (existing.name === input.channelName) return existing;

  return prisma.team.update({
    where: { id: existing.id },
    data: { name: input.channelName },
  });
}
