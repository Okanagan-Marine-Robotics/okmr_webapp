import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@club/db";
import { FORM_TYPES, formSeenKey, typeLabel } from "../formTypes";
import { NO_BADGES, getBadges } from "../badges";
import { MarkSeen } from "../markSeen";
import { PillNav } from "../pills";
import { postToChannel } from "../discord";
import { buildAncestorIndex, forumPostsOf, inForum } from "../forums";

// Build a /forms URL keeping whichever of the two filters aren't being changed.
function formsUrl(type: string, forum: string) {
  const q = new URLSearchParams();
  if (type) q.set("type", type);
  if (forum) q.set("forum", forum);
  const s = q.toString();
  return s ? `/forms?${s}` : "/forms";
}

// Bucket for requests whose channel we don't know. Shouldn't happen for
// anything filed through the bot, which always records a team.
const NO_TEAM = "__no_team__";

// "when" -> "When", "pickupLocation" -> "Pickup location"
function fieldLabel(key: string) {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function parseDetails(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// The one answer that best identifies a request at a glance.
function summaryOf(details: Record<string, string>) {
  const sop = details.sop ? `${details.sop} — ${details.outcome ?? ""}`.trim() : null;
  return sop ?? details.part ?? details.purpose ?? details.what ?? details.when ?? "—";
}

function formatStamp(date: Date) {
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// The bot stores machine-readable copies of date answers alongside the raw
// text (e.g. "whenStartsAt"); those are for sorting, not for display.
function displayEntries(details: Record<string, string>) {
  return Object.entries(details).filter(
    ([key]) => !key.endsWith("StartsAt") && !key.endsWith("EndsAt"),
  );
}

// The decision arrives as a bound argument rather than a form field. Reading it
// from the clicked button's value meant a decision that didn't survive form
// serialization silently became "do nothing, then redirect" — which looked
// exactly like a working button that changed nothing.
const VERDICT_TEXT: Record<Decision, string> = {
  approved: "✅ **Approved**",
  denied: "❌ **Denied**",
  handled: "✅ **Marked handled**",
};

type Decision = "approved" | "denied" | "handled";

async function resolveTicket(id: string, decision: Decision, back: string) {
  "use server";

  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");

  const ticket = await prisma.ticket.update({
    where: { id },
    data: { status: decision, resolvedAt: new Date() },
    include: { requester: true, team: true },
  });

  // Tell the channel the request came from. Best-effort: the decision is
  // already saved, so a Discord failure must not surface as an error page.
  if (ticket.team?.discordChannelId) {
    const details = parseDetails(ticket.details);
    const by = session.user.name ? ` by ${session.user.name}` : "";
    const who = `<@${ticket.requester.discordId}>`;
    await postToChannel(
      ticket.team.discordChannelId,
      `${VERDICT_TEXT[decision]}${by} — **${typeLabel(ticket.type)}**: ${summaryOf(details)} (raised by ${who})`,
    );
  }

  revalidatePath("/forms");
  // Redirecting (rather than relying on revalidation alone) guarantees the list
  // actually re-renders after a decision.
  redirect(back);
}

export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; forum?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const params = await searchParams;
  const activeType = params.type ?? "";
  const activeForum = params.forum ?? "";
  const currentUrl = formsUrl(activeType, activeForum);

  const badges = session.user.id ? await getBadges(session.user.id) : NO_BADGES;

  const teams = await prisma.team.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const ancestors = buildAncestorIndex(teams);
  const posts = forumPostsOf(teams);

  // Channels are forum posts. Requests filed in text channels or elsewhere are
  // hidden entirely, so the query is always scoped to post team ids — narrowed
  // to the one selected post when a channel pill is active.
  const allowedTeamIds = (
    activeForum ? posts.filter((p) => inForum(p.id, activeForum, ancestors)) : posts
  ).map((p) => p.id);
  const teamFilter = { teamId: { in: allowedTeamIds } };

  const typeFilter = activeType ? { type: activeType } : {};

  const [open, resolved] = await Promise.all([
    prisma.ticket.findMany({
      where: { status: "open", ...typeFilter, ...teamFilter },
      include: { requester: true, team: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ticket.findMany({
      where: { status: { not: "open" }, ...typeFilter, ...teamFilter },
      include: { requester: true, team: true },
      orderBy: { resolvedAt: "desc" },
      take: 10,
    }),
  ]);

  const teamsById = new Map(teams.map((team) => [team.id, team]));

  // Group open requests the same way Tasks does: forum (or category) first,
  // then the individual channel or forum post inside it.
  type OpenTicket = (typeof open)[number];
  const groups = new Map<
    string,
    { name: string; channels: Map<string, { name: string; tickets: OpenTicket[] }> }
  >();

  for (const ticket of open) {
    const team = ticket.team;
    const groupId = team ? (team.parentId ?? team.id) : NO_TEAM;
    const groupName = team
      ? (teamsById.get(team.parentId ?? team.id)?.name ?? team.name)
      : "No channel";
    const channelId = team?.id ?? NO_TEAM;
    const channelName = team?.name ?? "No channel";

    let group = groups.get(groupId);
    if (!group) {
      group = { name: groupName, channels: new Map() };
      groups.set(groupId, group);
    }

    const channel = group.channels.get(channelId);
    if (channel) channel.tickets.push(ticket);
    else group.channels.set(channelId, { name: channelName, tickets: [ticket] });
  }

  const orderedGroups = [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  // Viewing "All" clears every form type; a subtab clears just its own.
  const seenKeys = activeType
    ? [formSeenKey(activeType)]
    : FORM_TYPES.map((t) => formSeenKey(t.type));

  const subtabs = [{ type: "", label: "All" }, ...FORM_TYPES];

  const activeForumName = activeForum
    ? (teamsById.get(activeForum)?.name ?? "that channel")
    : "";

  return (
    <main>
      <MarkSeen keys={seenKeys} />
      <h1>Forms</h1>

      {/* Row 1: form type. Row 2: which channel/forum it came from. The two
          combine, e.g. type=part + forum=hydrofoil-mech = part orders there. */}
      <PillNav
        pills={subtabs.map((tab) => ({
          href: formsUrl(tab.type, activeForum),
          label: tab.label,
          active: activeType === tab.type,
          badge: tab.type ? badges.formTypes[tab.type] : false,
        }))}
      />

      {posts.length > 0 && (
        <PillNav
          pills={[
            { href: formsUrl(activeType, ""), label: "All channels", active: !activeForum },
            ...posts.map((post) => ({
              href: formsUrl(activeType, post.id),
              label: post.name,
              active: activeForum === post.id,
            })),
          ]}
        />
      )}

      {open.length === 0 ? (
        <p>
          No open requests
          {activeType && ` for ${typeLabel(activeType)}`}
          {activeForum && ` in ${activeForumName}`}. Run <code>/form</code> in a channel to file
          one.
        </p>
      ) : (
        <p style={{ color: "#666" }}>
          {open.length} open request{open.length === 1 ? "" : "s"}
          {activeForum && ` in ${activeForumName}`}.
        </p>
      )}

      {orderedGroups.map(([groupId, group]) => {
        const channels = [...group.channels.entries()].sort((a, b) =>
          a[1].name.localeCompare(b[1].name),
        );
        // A plain channel with nothing nested under it is its own group, so
        // printing both headings would just say the same name twice.
        const showChannelHeadings = !(channels.length === 1 && channels[0][0] === groupId);

        return (
          <section key={groupId} style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.15rem" }}>{group.name}</h2>

            {channels.map(([channelId, channel]) => (
              <div key={channelId}>
                {showChannelHeadings && (
                  <h3 style={{ fontSize: "0.95rem", margin: "0.6rem 0 0.35rem", color: "#444" }}>
                    {channel.name}
                  </h3>
                )}

                {channel.tickets.map((ticket) => {
                  const details = parseDetails(ticket.details);
                  return (
                    <article
                      key={ticket.id}
                      style={{
                        border: "1px solid #e0e0e0",
                        borderRadius: 6,
                        padding: "0.85rem 1rem",
                        marginBottom: "0.85rem",
                      }}
                    >
                      <div
                        style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}
                      >
                        <strong>{typeLabel(ticket.type)}</strong>
                        <span
                          style={{ color: "#666", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                        >
                          {ticket.requester.username}
                        </span>
                      </div>

                      <dl
                        style={{
                          margin: "0.6rem 0 0.8rem",
                          display: "grid",
                          gridTemplateColumns: "auto 1fr",
                          gap: "0.25rem 0.75rem",
                        }}
                      >
                        {displayEntries(details).map(([key, value]) => (
                          <div key={key} style={{ display: "contents" }}>
                            <dt style={{ color: "#666", whiteSpace: "nowrap" }}>
                              {fieldLabel(key)}
                            </dt>
                            <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                              {/^https?:\/\//.test(value) ? (
                                <a href={value} target="_blank" rel="noreferrer noopener">
                                  {value}
                                </a>
                              ) : (
                                value
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>

                      <p style={{ color: "#666", fontSize: "0.85rem", margin: "0 0 0.6rem" }}>
                        Submitted {formatStamp(ticket.createdAt)}
                      </p>

                      {/* An emergency isn't a request — there's nothing to
                          approve or deny, only to close once it's dealt with. */}
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        {ticket.type === "emergency" ? (
                          <form action={resolveTicket.bind(null, ticket.id, "handled", currentUrl)}>
                            <button type="submit">Mark handled</button>
                          </form>
                        ) : (
                          <>
                            <form
                              action={resolveTicket.bind(null, ticket.id, "approved", currentUrl)}
                            >
                              <button type="submit">Approve</button>
                            </form>
                            <form
                              action={resolveTicket.bind(null, ticket.id, "denied", currentUrl)}
                            >
                              <button type="submit">Deny</button>
                            </form>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}

      {resolved.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.05rem" }}>Recently resolved</h2>
          <ul style={{ paddingLeft: "1.1rem" }}>
            {resolved.map((ticket) => {
              const details = parseDetails(ticket.details);
              return (
                <li key={ticket.id} style={{ color: "#666", marginBottom: "0.4rem" }}>
                  <span style={{ color: ticket.status === "denied" ? "#e5484d" : "#46a758" }}>
                    {ticket.status}
                  </span>
                  {" · "}
                  {typeLabel(ticket.type)} — {summaryOf(details)}
                  {" · "}
                  {ticket.requester.username}
                  {ticket.team && ` · ${ticket.team.name}`}
                  <br />
                  <span style={{ fontSize: "0.85rem" }}>
                    Submitted {formatStamp(ticket.createdAt)}
                    {ticket.resolvedAt && ` · ${ticket.status} ${formatStamp(ticket.resolvedAt)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
