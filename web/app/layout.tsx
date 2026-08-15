import type { ReactNode } from "react";
import { auth } from "@/auth";
import { Nav } from "./nav";
import { NO_BADGES, getBadges } from "./badges";
import "./globals.css";

export const metadata = {
  title: "Marine Robotics",
  description: "UBC Okanagan Marine Robotics — tasks, calendar, files, and requests.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Tabs are only useful once signed in; the login page shouldn't show them.
  const session = await auth();
  const badges = session?.user?.id ? await getBadges(session.user.id) : NO_BADGES;

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "2rem",
          maxWidth: 720,
          marginInline: "auto",
          lineHeight: 1.5,
        }}
      >
        {session?.user && (
          <>
            <header className="app-header">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Marine Robotics" width={44} height={44} />
              <div className="wordmark">
                <b>Marine Robotics</b>
                <span>UBC Okanagan</span>
              </div>
            </header>
            <Nav badges={badges} />
          </>
        )}
        {children}
      </body>
    </html>
  );
}
