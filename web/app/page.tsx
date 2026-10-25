import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  not_in_guild:
    "Access denied: your Discord account is not a member of the UBC Okanagan Marine Robotics Discord server.",
  pending_screening:
    "Access denied: please finish accepting the server rules in the OKMR Discord server first, then sign in again.",
  missing_role:
    "Access denied: your Discord account does not have the required member role in the OKMR Discord server.",
  misconfigured:
    "Sign-in is temporarily unavailable because server Discord verification is not configured.",
};

function describeAuthError(code: string | undefined): string | null {
  if (!code) return null;
  return (
    AUTH_ERROR_MESSAGES[code] ??
    "Sign-in was denied. Access is restricted to members of the OKMR Discord server."
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const session = await auth();

  if (session?.user?.id) {
    return (
      <main>
        <h1>Home</h1>
        <p>
          Signed in as <strong>{session.user.name}</strong>
          {session.user.isLead && (
            <span
              style={{
                marginLeft: 8,
                fontSize: "0.75rem",
                padding: "1px 7px",
                borderRadius: 999,
                background: "var(--navy)",
                color: "#fff",
                verticalAlign: "middle",
              }}
            >
              Lead
            </span>
          )}
          .
        </p>
        <p>
          <Link href="/tasks">View tasks →</Link>
          {" · "}
          <Link href="/calendar">View calendar →</Link>
          {" · "}
          <Link href="/forms">Forms →</Link>
          {" · "}
          <Link href="/devlogs">Dev journal →</Link>
        </p>
        <form
          action={async () => {
            "use server";
            await signOut();
          }}
          style={{ marginTop: "1.5rem" }}
        >
          <button type="submit">Sign out</button>
        </form>
      </main>
    );
  }

  const params = searchParams ? await searchParams : undefined;
  const errorMessage = describeAuthError(params?.error);

  return (
    <main className="login-hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Marine Robotics" width={190} height={190} />
      <h1 style={{ marginBottom: "0.1rem" }}>Marine Robotics</h1>
      <p
        style={{
          color: "var(--muted)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          fontSize: "0.72rem",
          marginTop: 0,
        }}
      >
        UBC Okanagan
      </p>
      <p style={{ maxWidth: 360, margin: "1rem auto 1.5rem", color: "var(--muted)" }}>
        Sign in with your OKMR Discord account to view tasks, the calendar, forms, and dev logs.
      </p>
      {errorMessage && (
        <p
          role="alert"
          style={{
            maxWidth: 400,
            margin: "0 auto 1.25rem",
            padding: "0.65rem 0.9rem",
            borderRadius: 6,
            border: "1px solid #f3c6c8",
            background: "#fff5f5",
            color: "#b42318",
            fontSize: "0.85rem",
          }}
        >
          {errorMessage}
        </p>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("discord");
        }}
      >
        <button type="submit">Login with Discord</button>
      </form>
    </main>
  );
}
