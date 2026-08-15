"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@club/db";

// Record that the signed-in user has looked at these tabs, clearing their
// unread dots. Called from the MarkSeen client component after a page renders.
export async function markSeen(keys: string[]) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || keys.length === 0) return;

  const seenAt = new Date();
  await prisma.$transaction(
    keys.map((key) =>
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
