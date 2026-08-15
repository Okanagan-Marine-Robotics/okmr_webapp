import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    return (
      <main>
        <h1>Home</h1>
        <p>
          Signed in as <strong>{session.user.name}</strong>.
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
        Sign in with your Discord account to view tasks, the calendar, forms, and dev logs.
      </p>
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
