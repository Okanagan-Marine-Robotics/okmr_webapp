"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markSeen } from "./actions";

// Renders nothing. Once the page has rendered, it marks its tab keys as seen
// and refreshes so the nav's unread dots clear.
export function MarkSeen({ keys }: { keys: string[] }) {
  const router = useRouter();
  // Join to a stable string so a fresh array each render doesn't re-fire this.
  const signature = keys.join(",");

  useEffect(() => {
    let active = true;
    void markSeen(signature.split(",")).then(() => {
      if (active) router.refresh();
    });
    return () => {
      active = false;
    };
  }, [signature, router]);

  return null;
}
