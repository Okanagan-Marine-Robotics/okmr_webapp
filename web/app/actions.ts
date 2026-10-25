"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@okmr_webapp/db";

const SAFE_SEEN_KEY_RE = /^(tasks|calendar|devlogs|forms):[a-zA-Z0-9_-]{1,64}$/;
const MAX_SEEN_KEYS = 100;

// Record that the signed-in user has looked at these tabs, clearing their
// unread dots. Called from the MarkSeen client component after a page renders.
export async function markSeen(keys: string[]) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !Array.isArray(keys) || keys.length === 0) return;

  const validKeys = [...new Set(keys)]
    .filter((k): k is string => typeof k === "string" && SAFE_SEEN_KEY_RE.test(k))
    .slice(0, MAX_SEEN_KEYS);
  if (validKeys.length === 0) return;

  const seenAt = new Date();
  await Promise.all(
    validKeys.map((key) =>
      prisma.seen.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, seenAt },
        update: { seenAt },
      }),
    ),
  );

  // The dots are rendered by the nav in the root layout.
  revalidatePath("/", "layout");
}
