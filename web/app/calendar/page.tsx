import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@club/db";
import { MarkSeen } from "../markSeen";
import { PillNav } from "../pills";
import { NO_BADGES, getBadges } from "../badges";
import {
  buildAncestorIndex,
  calendarForumSeenKey,
  forumPostsOf,
  inForum,
  isForumPost,
  teamSelectGroups,
  teamsById,
} from "../forums";
import { fieldStyle, inputStyle } from "../formStyles";
import { deleteScheduledEvent } from "../discord";

const RECURRING = ["weekly", "biweekly"];
const RECURRENCE_OPTIONS = [
  { value: "once", label: "One-time" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
];

// Create a web-only meeting: a calendar row with no Discord Scheduled Event.
// For a full Discord event (reminders, RSVP) the club uses /meet instead.
async function createMeeting(back: string, formData: FormData) {
  "use server";

  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");

  const title = String(formData.get("title") ?? "").trim();
  const whenRaw = String(formData.get("when") ?? "");
  if (!title || !whenRaw) redirect(back);

  const startsAt = new Date(whenRaw); // datetime-local, parsed as local time
  if (Number.isNaN(startsAt.getTime())) redirect(back);

  const duration = Math.min(1440, Math.max(15, Number(formData.get("duration")) || 60));
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  const teamId = String(formData.get("teamId") ?? "") || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const recurrenceRaw = String(formData.get("recurrence") ?? "once");
  const recurrence = RECURRING.includes(recurrenceRaw) ? recurrenceRaw : "once";

  await prisma.meeting.create({
    data: { title, teamId, startsAt, endsAt, location, recurrence },
  });

  revalidatePath("/calendar");
  redirect(back);
}

// Remove a meeting. If it came from /meet it carries a Discord event id, so we
// delete that first — otherwise the bot's sync listener would recreate the row.
async function deleteMeeting(id: string, back: string) {
  "use server";

  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (meeting?.discordEventId) {
    await deleteScheduledEvent(meeting.discordEventId);
  }
  await prisma.meeting.delete({ where: { id } }).catch(() => {});

  revalidatePath("/calendar");
  redirect(back);
}

const RECURRENCE_LABEL: Record<string, string> = {
  weekly: "Repeats weekly",
  biweekly: "Repeats biweekly",
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// A recurring meeting is stored as one row holding its *original* start date, so
// rolling it forward is what keeps it on the calendar. setDate() is used rather
// than adding milliseconds so the local clock time survives a DST change.
function nextOccurrence(startsAt: Date, recurrence: string, from: Date) {
  if (!RECURRING.includes(recurrence) || startsAt >= from) return startsAt;
  const stepDays = recurrence === "biweekly" ? 14 : 7;
  const next = new Date(startsAt);
  while (next < from) next.setDate(next.getDate() + stepDays);
  return next;
}

function formatDayHeading(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ forum?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const params = await searchParams;
  const activeForum = params.forum ?? "";
  const currentUrl = activeForum ? `/calendar?forum=${activeForum}` : "/calendar";
  const today = startOfToday();

  const badges = session.user.id ? await getBadges(session.user.id) : NO_BADGES;

  // Pills come from the full team list (not just teams that have meetings) so
  // Tasks and Calendar always show the same set.
  const [teams, meetings] = await Promise.all([
    prisma.team.findMany({ select: { id: true, name: true, parentId: true } }),
    // Upcoming one-offs, plus every recurring meeting regardless of its stored
    // date — the ones that already passed get rolled forward below.
    prisma.meeting.findMany({
      where: {
        OR: [{ startsAt: { gte: today } }, { recurrence: { in: RECURRING } }],
      },
      include: { team: true },
    }),
  ]);

  const posts = forumPostsOf(teams);
  const ancestors = buildAncestorIndex(teams);
  const teamGroups = teamSelectGroups(teams);
  const byId = teamsById(teams);

  const postsInScope = posts.filter((post) => inForum(post.id, activeForum, ancestors));

  const upcoming = meetings
    .map((meeting) => {
      const occursAt = nextOccurrence(meeting.startsAt, meeting.recurrence, today);
      // Preserve the original duration when shifting a recurring meeting.
      const endsAt = meeting.endsAt
        ? new Date(occursAt.getTime() + (meeting.endsAt.getTime() - meeting.startsAt.getTime()))
        : null;
      return { meeting, occursAt, endsAt };
    })
    // Filtered here rather than in the query: folding the filter into the
    // existing startsAt/recurrence OR is easy to get subtly wrong, and the
    // dataset is small. Only meetings on a forum post show (text-channel
    // meetings like #general's are hidden); club-wide meetings (no team) show
    // under every filter, matching what the bot posts in each channel's digest.
    .filter(({ meeting }) => {
      if (meeting.teamId === null) return true;
      const team = byId.get(meeting.teamId);
      if (!team || !isForumPost(team, byId)) return false;
      return inForum(meeting.teamId, activeForum, ancestors);
    })
    .sort((a, b) => a.occursAt.getTime() - b.occursAt.getTime());

  // Group into day sections. Insertion order is already chronological.
  const days = new Map<string, typeof upcoming>();
  for (const entry of upcoming) {
    const key = entry.occursAt.toDateString();
    const bucket = days.get(key);
    if (bucket) bucket.push(entry);
    else days.set(key, [entry]);
  }

  const seenKeys = postsInScope.map((post) => calendarForumSeenKey(post.id));

  const pills = [
    { href: "/calendar", label: "All", active: !activeForum },
    ...posts.map((post) => ({
      href: `/calendar?forum=${post.id}`,
      label: post.name,
      active: activeForum === post.id,
      badge: badges.calendarForums[post.id],
    })),
  ];

  return (
    <main>
      <MarkSeen keys={seenKeys} />
      <h1>Calendar</h1>

      {posts.length > 0 && <PillNav pills={pills} />}

      <details style={{ marginBottom: "1.5rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Add meeting</summary>
        <form
          action={createMeeting.bind(null, currentUrl)}
          style={{
            display: "grid",
            gap: "0.5rem",
            maxWidth: 460,
            marginTop: "0.75rem",
            padding: "0.85rem 1rem",
            border: "1px solid #e0e0e0",
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#777" }}>
            Adds a web calendar entry. For a Discord event with reminders, use <code>/meet</code>.
          </p>

          <label style={fieldStyle}>
            Title
            <input name="title" required style={inputStyle} />
          </label>

          <label style={fieldStyle}>
            When
            <input type="datetime-local" name="when" required style={inputStyle} />
          </label>

          <label style={fieldStyle}>
            Duration (minutes)
            <input type="number" name="duration" defaultValue={60} min={15} max={1440} style={inputStyle} />
          </label>

          <label style={fieldStyle}>
            Channel
            <select name="teamId" defaultValue="" style={inputStyle}>
              <option value="">Club-wide (no channel)</option>
              {teamGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label style={fieldStyle}>
            Location
            <input name="location" style={inputStyle} />
          </label>

          <label style={fieldStyle}>
            Repeats
            <select name="recurrence" defaultValue="once" style={inputStyle}>
              {RECURRENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" style={{ justifySelf: "start" }}>
            Add meeting
          </button>
        </form>
      </details>

      {upcoming.length === 0 && (
        <p>
          No upcoming meetings. Run <code>/meet</code> in a channel to schedule one.
        </p>
      )}

      {[...days.entries()].map(([key, entries]) => (
        <section key={key} style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>
            {formatDayHeading(entries[0].occursAt)}
          </h2>
          <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
            {entries.map(({ meeting, occursAt, endsAt }) => (
              <li
                key={meeting.id}
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  padding: "0.4rem 0",
                  borderTop: "1px solid #f0f0f0",
                }}
              >
                <form action={deleteMeeting.bind(null, meeting.id, currentUrl)}>
                  <button
                    type="submit"
                    title="Remove meeting"
                    style={{
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "0.7rem",
                      lineHeight: 1.4,
                      padding: "0 5px",
                      color: "#e5484d",
                    }}
                  >
                    ✕
                  </button>
                </form>
                <span
                  style={{
                    color: "#666",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    minWidth: "7.5rem",
                  }}
                >
                  {formatTime(occursAt)}
                  {endsAt && ` – ${formatTime(endsAt)}`}
                </span>
                <span>
                  <strong>{meeting.title}</strong>
                  {" — "}
                  <span style={{ color: "#666" }}>{meeting.team?.name ?? "club-wide"}</span>
                  {meeting.location && (
                    <span style={{ color: "#666" }}> · {meeting.location}</span>
                  )}
                  {RECURRENCE_LABEL[meeting.recurrence] && (
                    <span
                      style={{
                        marginLeft: 8,
                        background: "#eef1f5",
                        color: "#425",
                        borderRadius: 4,
                        padding: "0 6px",
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {RECURRENCE_LABEL[meeting.recurrence]}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
