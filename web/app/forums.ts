// Grouping rules shared by the Tasks page, the Calendar page, and the unread
// badges, so the three can't drift apart.
//
// A team's "group" is its parent if it has one, otherwise itself. That's one
// hop and cannot recurse, so however deeply Discord nests things, the UI stays
// exactly two levels: group heading, then the channels inside it.

export interface TeamLike {
  id: string;
  name: string;
  parentId: string | null;
}

export function groupIdOf(team: TeamLike): string {
  return team.parentId ?? team.id;
}

// A "channel" in the webapp is a forum post — the place work actually lives.
// Structurally that's the only team with a grandparent: post -> forum ->
// category. Forums and text channels have just a parent (a category);
// categories have none. So this cleanly excludes categories, forums, and
// standalone text channels without needing the Discord channel type.
export function isForumPost(team: TeamLike, byId: Map<string, TeamLike>): boolean {
  if (!team.parentId) return false;
  const parent = byId.get(team.parentId);
  return Boolean(parent?.parentId);
}

export function teamsById(teams: TeamLike[]): Map<string, TeamLike> {
  return new Map(teams.map((t) => [t.id, t]));
}

// The forum posts, sorted by name — the pill set, dropdown options, and badge
// iteration set everywhere. Generic so callers keep their included relations.
export function forumPostsOf<T extends TeamLike>(teams: T[]): T[] {
  const byId = teamsById(teams);
  return teams
    .filter((team) => isForumPost(team, byId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Maps every team id to itself plus all of its ancestors.
//
// Display stays one hop (a post shows under its forum, never its category), but
// *filtering* walks the whole chain — otherwise a category pill like "Hydrofoil"
// looks empty, because its direct children are forums that hold nothing
// themselves while the real work sits one level further down in the posts.
export function buildAncestorIndex(teams: TeamLike[]): Map<string, Set<string>> {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const cache = new Map<string, Set<string>>();

  function ancestorsOf(id: string): Set<string> {
    const cached = cache.get(id);
    if (cached) return cached;

    const chain = new Set<string>([id]);
    // Cached before recursing so a parent cycle terminates instead of
    // overflowing the stack. Discord can't produce one, but a bad backfill could.
    cache.set(id, chain);

    const parentId = byId.get(id)?.parentId;
    if (parentId) for (const ancestor of ancestorsOf(parentId)) chain.add(ancestor);

    return chain;
  }

  for (const team of teams) ancestorsOf(team.id);
  return cache;
}

// Does this team fall under the selected filter? An empty filter means "All".
export function inForum(
  teamId: string | null,
  forumId: string,
  ancestors: Map<string, Set<string>>,
): boolean {
  if (!forumId) return true;
  if (!teamId) return false;
  return ancestors.get(teamId)?.has(forumId) ?? false;
}

// The groups to show as filter pills, sorted by name. A team is a group when
// something hangs off it, or when it has no parent of its own. Generic so
// callers keep whatever relations they included on the row.
export function groupsOf<T extends TeamLike>(teams: T[]): T[] {
  const groupIds = new Set(teams.map(groupIdOf));
  return teams
    .filter((team) => groupIds.has(team.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Forum posts arranged for a grouped <select>: one optgroup per forum (the
// post's parent), the posts as its options. Only posts are selectable — the
// forum is just a non-selectable heading, categories don't appear at all.
export function teamSelectGroups(teams: TeamLike[]): { label: string; teams: TeamLike[] }[] {
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const byForum = new Map<string, TeamLike[]>();
  for (const post of forumPostsOf(teams)) {
    const forumId = groupIdOf(post); // a post's group is its forum
    (byForum.get(forumId) ?? byForum.set(forumId, []).get(forumId)!).push(post);
  }
  return [...byForum.entries()]
    .map(([forumId, posts]) => ({
      label: nameOf.get(forumId) ?? "Other",
      teams: posts.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Seen keys for the unread dots. Per group, so a dot can light up one pill.
export const taskForumSeenKey = (groupId: string) => `tasks:${groupId}`;
export const calendarForumSeenKey = (groupId: string) => `calendar:${groupId}`;
export const devlogForumSeenKey = (groupId: string) => `devlogs:${groupId}`;
