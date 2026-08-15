"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UnreadDot } from "./dot";

// Client component because highlighting the active tab needs usePathname(),
// which is not available in server components.

const TABS = [
  { href: "/tasks", label: "Tasks", key: "tasks" },
  { href: "/calendar", label: "Calendar", key: "calendar" },
  { href: "/forms", label: "Forms", key: "forms" },
  { href: "/devlogs", label: "Devlogs", key: "devlogs" },
] as const;

export interface NavBadges {
  tasks: boolean;
  calendar: boolean;
  forms: boolean;
  devlogs: boolean;
}

export function Nav({ badges }: { badges: NavBadges }) {
  const pathname = usePathname();

  return (
    <nav
      style={{
        display: "flex",
        gap: "0.25rem",
        borderBottom: "1px solid var(--line)",
        marginBottom: "1.75rem",
      }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              padding: "0.5rem 0.9rem",
              textDecoration: "none",
              color: active ? "var(--navy)" : "var(--muted)",
              fontWeight: active ? 600 : 500,
              // Sits on top of the nav's own border so the active tab connects to it.
              borderBottom: `2px solid ${active ? "var(--blue)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {tab.label}
            {badges[tab.key] && <UnreadDot />}
          </Link>
        );
      })}
    </nav>
  );
}
