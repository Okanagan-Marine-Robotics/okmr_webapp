import { prisma } from "@club/db";
import { FORM_TYPES, formSeenKey } from "./formTypes";
import {
  buildAncestorIndex,
  calendarForumSeenKey,
  devlogForumSeenKey,
  forumPostsOf,
  inForum,
  taskForumSeenKey,
} from "./forums";

export interface Badges {
  tasks: boolean;
  calendar: boolean;
  forms: boolean;
  devlogs: boolean;
  formTypes: Record<string, boolean>;
  taskForums: Record<string, boolean>;
  calendarForums: Record<string, boolean>;
  devlogForums: Record<string, boolean>;
}

export const NO_BADGES: Badges = {
  tasks: false,
  calendar: false,
  forms: false,
  devlogs: false,
  formTypes: {},
  taskForums: {},
  calendarForums: {},
  devlogForums: {},
};

// A user who has never opened a tab has no Seen row, so everything counts as
// new — which is what we want on first login.
const NEVER = new Date(0);

// Runs in the root layout on every page render, so it's the hottest query in
// the app. Scanning all tasks/meetings is fine well into the thousands on
// SQLite; if it ever bites, filter by the earliest relevant seenAt.
export async function getBadges(userId: string): Promise<Badges> {
  const seenRows = await prisma.seen.findMany({ where: { userId } });
  const seenAt = new Map(seenRows.map((row) => [row.key, row.seenAt]));
  const since = (key: string) => seenAt.get(key) ?? NEVER;

  const [teams, tasks, meetings, tickets, devlogs] = await Promise.all([
    prisma.team.findMany({ select: { id: true, name: true, parentId: true } }),
    prisma.task.findMany({ select: { teamId: true, createdAt: true } }),
    prisma.meeting.findMany({ select: { teamId: true, createdAt: true } }),
    prisma.ticket.findMany({ select: { type: true, createdAt: true } }),
    prisma.devLog.findMany({ select: { teamId: true, createdAt: true } }),
  ]);

  // Ancestor-aware, matching how the pages filter: a new task in a forum post
  // dots both its forum and the category above it. Anything narrower would mean
  // clicking a dotted pill showed nothing, or an undotted pill hid something new.
  const ancestors = buildAncestorIndex(teams);

  const taskForums: Record<string, boolean> = {};
  const calendarForums: Record<string, boolean> = {};
  const devlogForums: Record<string, boolean> = {};

  // Dots are keyed by forum post — the webapp's "channel". Work in non-post
  // teams (text channels, etc.) never appears, so it never dots anything.
  for (const post of forumPostsOf(teams)) {
    const taskCutoff = since(taskForumSeenKey(post.id));
    taskForums[post.id] = tasks.some(
      (task) => inForum(task.teamId, post.id, ancestors) && task.createdAt > taskCutoff,
    );

    // A club-wide meeting (teamId null) is displayed under every filter, so it
    // has to dot every pill — otherwise the dot would disagree with what
    // opening the pill actually shows.
    const calendarCutoff = since(calendarForumSeenKey(post.id));
    calendarForums[post.id] = meetings.some(
      (meeting) =>
        (meeting.teamId === null || inForum(meeting.teamId, post.id, ancestors)) &&
        meeting.createdAt > calendarCutoff,
    );

    const devlogCutoff = since(devlogForumSeenKey(post.id));
    devlogForums[post.id] = devlogs.some(
      (log) => inForum(log.teamId, post.id, ancestors) && log.createdAt > devlogCutoff,
    );
  }

  // Include any type present in the data as well as the known ones, so a form
  // added to the bot still lights up its dot before it's listed here.
  const allTypes = new Set([...FORM_TYPES.map((t) => t.type), ...tickets.map((t) => t.type)]);

  const formTypes: Record<string, boolean> = {};
  for (const type of allTypes) {
    const cutoff = since(formSeenKey(type));
    formTypes[type] = tickets.some((t) => t.type === type && t.createdAt > cutoff);
  }

  // Each top-level tab's dot is just "any of my pills has something new".
  return {
    tasks: Object.values(taskForums).some(Boolean),
    calendar: Object.values(calendarForums).some(Boolean),
    forms: Object.values(formTypes).some(Boolean),
    devlogs: Object.values(devlogForums).some(Boolean),
    formTypes,
    taskForums,
    calendarForums,
    devlogForums,
  };
}
