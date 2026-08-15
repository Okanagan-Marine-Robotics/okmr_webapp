import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@club/db";
import { MarkSeen } from "../markSeen";
import { PillNav } from "../pills";
import { NO_BADGES, getBadges } from "../badges";
import {
  buildAncestorIndex,
  forumPostsOf,
  groupIdOf,
  inForum,
  isForumPost,
  taskForumSeenKey,
  teamSelectGroups,
  teamsById,
} from "../forums";
import { fieldStyle, inputStyle } from "../formStyles";

// Display info for each importance level. Mirrors the bot's importance.ts;
// kept small and local since web and bot are separate workspaces.
const IMPORTANCE: Record<string, { label: string; color: string; rank: number }> = {
  ultra: { label: "Mega Ultra", color: "#e5484d", rank: 0 },
  important: { label: "Important", color: "#f76808", rank: 1 },
  medium: { label: "Medium", color: "#f5a623", rank: 2 },
  light: { label: "Light", color: "#46a758", rank: 3 },
};
const IMPORTANCE_ORDER = ["ultra", "important", "medium", "light"];

function impInfo(value: string) {
  return IMPORTANCE[value] ?? IMPORTANCE.medium;
}

// Create a task from the add form. Fields mirror the bot's /task modal.
async function createTask(back: string, formData: FormData) {
  "use server";

  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");

  const title = String(formData.get("title") ?? "").trim();
  const teamId = String(formData.get("teamId") ?? "");
  if (!title || !teamId) redirect(back);

  const importance = String(formData.get("importance") ?? "medium");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const dueRaw = String(formData.get("due") ?? "").trim();
  // A date input gives YYYY-MM-DD; store local midnight like the bot does.
  const dueDate = dueRaw ? new Date(`${dueRaw}T00:00:00`) : null;

  const assigneeIds = formData
    .getAll("assignees")
    .map((v) => String(v))
    .filter(Boolean);

  await prisma.task.create({
    data: {
      title,
      teamId,
      createdById: session.user.id,
      importance: IMPORTANCE[importance] ? importance : "medium",
      notes,
      dueDate,
      assignees: { create: assigneeIds.map((userId) => ({ userId })) },
    },
  });

  revalidatePath("/tasks");
  redirect(back);
}

// "Remove" on the board = mark done, matching the bot's /cltask. The task
// leaves the board (which only shows open tasks) but stays in the database.
async function closeTask(id: string, back: string) {
  "use server";

  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");

  await prisma.task.update({ where: { id }, data: { status: "done" } });

  revalidatePath("/tasks");
  redirect(back);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ forum?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const params = await searchParams;
  const activeForum = params.forum ?? "";
  const currentUrl = activeForum ? `/tasks?forum=${activeForum}` : "/tasks";

  const badges = session.user.id ? await getBadges(session.user.id) : NO_BADGES;

  const [teams, users] = await Promise.all([
    prisma.team.findMany({
      orderBy: { name: "asc" },
      include: {
        tasks: {
          where: { status: "open" },
          include: { assignees: { include: { user: true } } },
        },
      },
    }),
    prisma.user.findMany({ orderBy: { username: "asc" } }),
  ]);

  // Channels are the forum posts; forums and categories are just structure.
  const posts = forumPostsOf(teams);
  const ancestors = buildAncestorIndex(teams);
  const teamGroups = teamSelectGroups(teams);
  const byId = teamsById(teams);

  // A post is in scope when it matches the active pill (a post filter is an
  // exact match, since a post has no children).
  const postsInScope = posts.filter((post) => inForum(post.id, activeForum, ancestors));

  // Bucket posts (that have open tasks) under their forum for display. Only
  // forum posts count — work in text channels like #general is not shown.
  const channelsByGroup = new Map<string, typeof teams>();
  for (const team of teams) {
    if (team.tasks.length === 0 || !isForumPost(team, byId)) continue;
    if (!inForum(team.id, activeForum, ancestors)) continue;
    const id = groupIdOf(team); // the post's forum
    const bucket = channelsByGroup.get(id);
    if (bucket) bucket.push(team);
    else channelsByGroup.set(id, [team]);
  }

  // Forum display headers (h2) that have at least one post with open tasks.
  const shownGroups = [...channelsByGroup.keys()]
    .map((id) => ({ id, name: byId.get(id)?.name ?? "Unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Opening a post pill (or "All") marks the posts you can now see as seen.
  const seenKeys = postsInScope.map((post) => taskForumSeenKey(post.id));

  const pills = [
    { href: "/tasks", label: "All", active: !activeForum },
    ...posts.map((post) => ({
      href: `/tasks?forum=${post.id}`,
      label: post.name,
      active: activeForum === post.id,
      badge: badges.taskForums[post.id],
    })),
  ];

  return (
    <main>
      <MarkSeen keys={seenKeys} />
      <h1>Tasks</h1>

      {posts.length > 0 && <PillNav pills={pills} />}

      {teams.length > 0 && (
        <details style={{ marginBottom: "1.5rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Add task</summary>
          <form
            action={createTask.bind(null, currentUrl)}
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
            <label style={fieldStyle}>
              Title
              <input name="title" required style={inputStyle} />
            </label>

            <label style={fieldStyle}>
              Channel
              <select name="teamId" required defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Choose a channel…
                </option>
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
              Importance
              <select name="importance" defaultValue="medium" style={inputStyle}>
                {IMPORTANCE_ORDER.map((key) => (
                  <option key={key} value={key}>
                    {IMPORTANCE[key].label}
                  </option>
                ))}
              </select>
            </label>

            <label style={fieldStyle}>
              Due date
              <input type="date" name="due" style={inputStyle} />
            </label>

            <label style={fieldStyle}>
              Assignees (Ctrl/Cmd-click for several)
              <select name="assignees" multiple size={Math.min(5, Math.max(2, users.length))} style={inputStyle}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
              </select>
            </label>

            <label style={fieldStyle}>
              Notes
              <textarea name="notes" rows={2} style={inputStyle} />
            </label>

            <button type="submit" style={{ justifySelf: "start" }}>
              Add task
            </button>
          </form>
        </details>
      )}

      {teams.length === 0 && (
        <p>No teams yet. Run a bot command in a channel to create one.</p>
      )}
      {teams.length > 0 && shownGroups.length === 0 && <p>No open tasks.</p>}

      {shownGroups.map((group) => {
        const channels = channelsByGroup.get(group.id) ?? [];
        // A plain channel with nothing nested under it is its own group, so
        // printing both headings would just say the same name twice.
        const showChannelHeadings = !(channels.length === 1 && channels[0].id === group.id);

        return (
          <section key={group.id} style={{ marginBottom: "1.5rem" }}>
            <h2>{group.name}</h2>

            {channels.map((team) => {
              // Most important first, then soonest due date, then oldest.
              const tasks = [...team.tasks].sort((a, b) => {
                const byImp = impInfo(a.importance).rank - impInfo(b.importance).rank;
                if (byImp !== 0) return byImp;
                const da = a.dueDate ? a.dueDate.getTime() : Infinity;
                const db = b.dueDate ? b.dueDate.getTime() : Infinity;
                if (da !== db) return da - db;
                return a.createdAt.getTime() - b.createdAt.getTime();
              });

              return (
                <div key={team.id} style={{ marginBottom: "0.75rem" }}>
                  {showChannelHeadings && (
                    <h3 style={{ fontSize: "0.95rem", margin: "0.5rem 0 0.25rem", color: "#444" }}>
                      {team.name}
                    </h3>
                  )}
                  <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                    {tasks.map((task) => {
                      const imp = impInfo(task.importance);
                      return (
                        <li
                          key={task.id}
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: "0.5rem",
                            marginBottom: "0.35rem",
                          }}
                        >
                          <form action={closeTask.bind(null, task.id, currentUrl)}>
                            <button
                              type="submit"
                              title="Mark done"
                              style={{
                                border: "1px solid #ccc",
                                borderRadius: 4,
                                background: "transparent",
                                cursor: "pointer",
                                fontSize: "0.7rem",
                                lineHeight: 1.4,
                                padding: "0 5px",
                              }}
                            >
                              ✓
                            </button>
                          </form>
                          <span>
                            <span
                              style={{
                                background: imp.color,
                                color: "#fff",
                                borderRadius: 4,
                                padding: "0 6px",
                                fontSize: "0.72rem",
                                fontWeight: 600,
                                marginRight: 8,
                                verticalAlign: "middle",
                              }}
                            >
                              {imp.label}
                            </span>
                            <strong>{task.title}</strong>
                            {task.assignees.length > 0 && (
                              <> — {task.assignees.map((a) => a.user.username).join(", ")}</>
                            )}
                            {task.dueDate && <> — due {task.dueDate.toISOString().slice(0, 10)}</>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </main>
  );
}
