import Link from "next/link";
import { UnreadDot } from "./dot";

// Filter pills shared by the Tasks, Calendar, and Forms pages. Server-rendered
// on purpose: the active pill is worked out from searchParams by the page, so
// this needs no hooks. Using useSearchParams() here instead would force every
// page that renders pills to grow a Suspense boundary.

export interface Pill {
  href: string;
  label: string;
  active: boolean;
  badge?: boolean;
}

export function PillNav({ pills }: { pills: Pill[] }) {
  return (
    <nav
      style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", margin: "0 0 1.25rem" }}
    >
      {pills.map((pill) => (
        <Link
          key={pill.href}
          href={pill.href}
          style={{
            padding: "0.2rem 0.7rem",
            borderRadius: 999,
            border: "1px solid",
            borderColor: pill.active ? "var(--navy)" : "var(--line)",
            background: pill.active ? "var(--navy)" : "transparent",
            color: pill.active ? "#fff" : "var(--muted)",
            textDecoration: "none",
            fontSize: "0.85rem",
            fontWeight: pill.active ? 600 : 500,
          }}
        >
          {pill.label}
          {pill.badge && <UnreadDot />}
        </Link>
      ))}
    </nav>
  );
}
