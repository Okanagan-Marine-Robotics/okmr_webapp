import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@club/db";
import { MarkSeen } from "../markSeen";
import { PillNav } from "../pills";
import { NO_BADGES, getBadges } from "../badges";
import {
  buildAncestorIndex,
  devlogForumSeenKey,
  forumPostsOf,
  groupIdOf,
  inForum,
  teamsById as teamsByIdOf,
} from "../forums";

function formatStamp(date: Date) {
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function isImage(contentType: string | null) {
  return contentType?.startsWith("image/") ?? false;
}

export default async function DevlogsPage({
  searchParams,
}: {
  searchParams: Promise<{ forum?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const params = await searchParams;
  const activeForum = params.forum ?? "";

  const badges = session.user.id ? await getBadges(session.user.id) : NO_BADGES;

  const teams = await prisma.team.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const ancestors = buildAncestorIndex(teams);
  const posts = forumPostsOf(teams);
  const postsInScope = posts.filter((post) => inForum(post.id, activeForum, ancestors));

  // Channels are forum posts; entries elsewhere (text channels) are hidden, so
  // the query is always scoped to post ids (narrowed to one when a pill is on).
  const allowedTeamIds = (activeForum ? postsInScope : posts).map((p) => p.id);

  const logs = await prisma.devLog.findMany({
    where: { teamId: { in: allowedTeamIds } },
    include: { author: true, team: true, attachments: true },
    orderBy: { createdAt: "desc" },
  });

  const teamsById = teamsByIdOf(teams);

  // Group by forum → channel like Tasks, but entries stay newest-first (the
  // query order) within each channel.
  type Log = (typeof logs)[number];
  const grouped = new Map<
    string,
    { name: string; channels: Map<string, { name: string; logs: Log[] }> }
  >();

  for (const log of logs) {
    const groupId = groupIdOf(log.team);
    const groupName = teamsById.get(groupId)?.name ?? log.team.name;

    let group = grouped.get(groupId);
    if (!group) {
      group = { name: groupName, channels: new Map() };
      grouped.set(groupId, group);
    }
    const channel = group.channels.get(log.team.id);
    if (channel) channel.logs.push(log);
    else group.channels.set(log.team.id, { name: log.team.name, logs: [log] });
  }

  const orderedGroups = [...grouped.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  const seenKeys = postsInScope.map((post) => devlogForumSeenKey(post.id));

  const pills = [
    { href: "/devlogs", label: "All", active: !activeForum },
    ...posts.map((post) => ({
      href: `/devlogs?forum=${post.id}`,
      label: post.name,
      active: activeForum === post.id,
      badge: badges.devlogForums[post.id],
    })),
  ];

  return (
    <main>
      <MarkSeen keys={seenKeys} />
      <h1>Dev journal</h1>

      {posts.length > 0 && <PillNav pills={pills} />}

      {logs.length === 0 && (
        <p>
          No entries yet. Use <code>/devlog</code> for a quick note or <code>/progupdate</code>{" "}
          for a longer update with files.
        </p>
      )}

      {orderedGroups.map(([groupId, group]) => {
        const channels = [...group.channels.entries()].sort((a, b) =>
          a[1].name.localeCompare(b[1].name),
        );
        const showChannelHeadings = !(channels.length === 1 && channels[0][0] === groupId);

        return (
          <section key={groupId} style={{ marginBottom: "1.75rem" }}>
            <h2 style={{ fontSize: "1.15rem" }}>{group.name}</h2>

            {channels.map(([channelId, channel]) => (
              <div key={channelId}>
                {showChannelHeadings && (
                  <h3 style={{ fontSize: "0.95rem", margin: "0.6rem 0 0.35rem", color: "#444" }}>
                    {channel.name}
                  </h3>
                )}

                {channel.logs.map((log) => (
                  <article
                    key={log.id}
                    style={{
                      borderLeft: `3px solid ${log.kind === "update" ? "#4f7cff" : "#d0d0d0"}`,
                      padding: "0.4rem 0 0.4rem 0.85rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <div style={{ color: "#666", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
                      {log.kind === "update" ? "📔 Update" : "📓 Note"} · {log.author.username} ·{" "}
                      {formatStamp(log.createdAt)}
                    </div>

                    {log.title && (
                      <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>{log.title}</div>
                    )}

                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {log.body}
                    </div>

                    {log.attachments.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.5rem",
                          marginTop: "0.6rem",
                        }}
                      >
                        {log.attachments.map((file) => {
                          const href = `/uploads/${file.storedName}`;
                          return isImage(file.contentType) ? (
                            <a key={file.id} href={href} target="_blank" rel="noreferrer noopener">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={href}
                                alt={file.originalName}
                                style={{
                                  maxWidth: 160,
                                  maxHeight: 160,
                                  borderRadius: 6,
                                  border: "1px solid #e0e0e0",
                                  objectFit: "cover",
                                }}
                              />
                            </a>
                          ) : (
                            <a
                              key={file.id}
                              href={href}
                              target="_blank"
                              rel="noreferrer noopener"
                              style={{
                                fontSize: "0.85rem",
                                padding: "0.25rem 0.6rem",
                                border: "1px solid #d0d0d0",
                                borderRadius: 6,
                              }}
                            >
                              📎 {file.originalName}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </main>
  );
}
