// The bot's background scheduler: once a minute it checks every channel's
// /config schedule and posts the "update message" when a channel is due.
// Uses the machine's local time (the Pi / your laptop).

import type { Client } from "discord.js";
import { prisma } from "@club/db";
import { renderTaskBlock, isDueSoon, sortTasks } from "./taskList.js";
import { describeDue } from "./date.js";
import { csvToDays } from "./weekdays.js";
import { formatMeetingLine } from "./meetings.js";
import { formatTicketLine } from "./ticketList.js";

const CHECK_INTERVAL_MS = 60_000;
// A form counts as "new this week" if it was submitted within this window.
const RECENT_FORM_WINDOW_MS = 7 * 86_400_000;
// Keep each forms list short so a scheduled reminder stays scannable and well
// under Discord's 2000-char message limit.
const MAX_FORM_LINES = 5;
const MAX_MESSAGE_CHARS = 1990;

export function startScheduler(client: Client): void {
  const tick = () => {
    runDueUpdates(client).catch((e) => console.error("Scheduler error:", e));
  };
  // Run shortly after startup (to catch a missed slot while the bot was down),
  // then every minute.
  setTimeout(tick, 10_000);
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log("Update scheduler started (checks every minute).");
}

async function runDueUpdates(client: Client): Promise<void> {
  const now = new Date();
  const todayWeekday = now.getDay(); // 0=Sun..6=Sat

  // Only channels that have at least one scheduled day.
  const configs = await prisma.channelConfig.findMany({
    where: { NOT: { updateDays: "" } },
    include: { team: true },
  });

  for (const cfg of configs) {
    if (!csvToDays(cfg.updateDays).includes(todayWeekday)) continue;

    const scheduledToday = new Date(now);
    scheduledToday.setHours(cfg.updateHour, cfg.updateMinute, 0, 0);
    if (now < scheduledToday) continue; // not time yet today
    if (cfg.lastSentAt && cfg.lastSentAt >= scheduledToday) continue; // already sent

    try {
      await sendChannelUpdate(client, cfg.team.discordChannelId, cfg.team.id, cfg.team.name, cfg.pingAssignee);
      await prisma.channelConfig.update({
        where: { id: cfg.id },
        data: { lastSentAt: now },
      });
    } catch (e) {
      console.error(`Failed to post update for team ${cfg.team.name}:`, e);
    }
  }
}

// Build and send one channel's update message.
export async function sendChannelUpdate(
  client: Client,
  discordChannelId: string,
  teamId: string,
  teamName: string,
  pingAssignee: boolean,
): Promise<void> {
  const now = new Date();

  const tasks = await prisma.task.findMany({
    where: { team: { discordChannelId }, status: "open" },
    include: { assignees: { include: { user: true } } },
  });

  // Meetings starting in the next 7 days, for this team or club-wide (teamId null).
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  const meetings = await prisma.meeting.findMany({
    where: { startsAt: { gte: now, lte: weekAhead }, OR: [{ teamId }, { teamId: null }] },
    orderBy: { startsAt: "asc" },
  });

  // Forms filed from this channel. Split so nothing is listed twice:
  //  - "new this week": everything submitted in the window (open or resolved)
  //  - "still pending": open forms OLDER than the window (slipping through)
  const weekAgo = new Date(now.getTime() - RECENT_FORM_WINDOW_MS);
  const [recentForms, lingeringForms] = await Promise.all([
    prisma.ticket.findMany({
      where: { teamId, createdAt: { gte: weekAgo } },
      include: { requester: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ticket.findMany({
      where: { teamId, status: "open", createdAt: { lt: weekAgo } },
      include: { requester: true },
      orderBy: { createdAt: "asc" }, // oldest (most overdue) first
    }),
  ]);

  let content = buildUpdateContent(teamName, tasks, meetings, recentForms, lingeringForms, pingAssignee);
  if (content.length > MAX_MESSAGE_CHARS) {
    content = content.slice(0, MAX_MESSAGE_CHARS - 1) + "…";
  }

  const channel = await client.channels.fetch(discordChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  await channel.send({
    content,
    // Only ping when the channel opted in; otherwise suppress all mentions.
    allowedMentions: pingAssignee ? { parse: ["users"] } : { parse: [] },
  });
}

type UpdateTask = {
  title: string;
  importance: string;
  dueDate: Date | null;
  assignees: { user: { username: string; discordId: string } }[];
};

type UpdateMeeting = {
  title: string;
  startsAt: Date;
  location: string | null;
  recurrence: string;
};

type UpdateForm = {
  type: string;
  status: string;
  details: string;
  createdAt: Date;
  resolvedAt: Date | null;
  requester: { username: string };
};

// A titled block of form lines, capped so the reminder stays short.
function formsBlock(heading: string, forms: UpdateForm[]): string[] {
  const shown = forms.slice(0, MAX_FORM_LINES);
  const extra = forms.length - shown.length;
  const lines = ["", heading, ...shown.map(formatTicketLine)];
  if (extra > 0) lines.push(`_…and ${extra} more — run /lsforms_`);
  return lines;
}

function buildUpdateContent(
  teamName: string,
  tasks: UpdateTask[],
  meetings: UpdateMeeting[],
  recentForms: UpdateForm[],
  lingeringForms: UpdateForm[],
  pingAssignee: boolean,
): string {
  const header = `📋 **Update — ${teamName}** · ${new Date().toDateString()}`;
  const lines = [header];

  const nothing =
    tasks.length === 0 &&
    meetings.length === 0 &&
    recentForms.length === 0 &&
    lingeringForms.length === 0;
  if (nothing) {
    lines.push("No open tasks, meetings, or forms right now. 🎉");
    return lines.join("\n");
  }

  if (tasks.length > 0) {
    const dueSoon = sortTasks(tasks).filter(isDueSoon);
    if (dueSoon.length > 0) {
      lines.push("", "⚠️ **Due soon:**");
      for (const t of dueSoon) {
        const who =
          t.assignees.length === 0
            ? "unassigned"
            : t.assignees
                .map((a) => (pingAssignee ? `<@${a.user.discordId}>` : a.user.username))
                .join(", ");
        lines.push(`• ${who} — ${t.title} — ${describeDue(t.dueDate)}`);
      }
    }
    lines.push("", renderTaskBlock(tasks));
  }

  if (meetings.length > 0) {
    lines.push("", "📅 **Meetings this week:**");
    for (const m of meetings) {
      lines.push(`• ${formatMeetingLine(m)}`);
    }
  }

  if (recentForms.length > 0) {
    lines.push(...formsBlock(`🆕 **New forms this week (${recentForms.length}):**`, recentForms));
  }

  if (lingeringForms.length > 0) {
    lines.push(
      ...formsBlock(`⏳ **Still awaiting a decision (${lingeringForms.length}):**`, lingeringForms),
    );
  }

  return lines.join("\n");
}
