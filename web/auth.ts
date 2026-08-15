import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { upsertUser } from "@club/db/helpers";

// Shape of the Discord OAuth profile we care about.
interface DiscordProfile {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
    }),
  ],
  // JWT sessions: no session tables needed. We keep our own User row (keyed by
  // discordId) as the shared identity between the web app and the bot.
  session: { strategy: "jwt" },
  callbacks: {
    // Runs on sign-in (when `profile` is present). Upsert our User row and
    // stash its id + name on the token.
    async jwt({ token, profile }) {
      if (profile) {
        const p = profile as unknown as DiscordProfile;
        const user = await upsertUser({
          discordId: p.id,
          username: p.global_name ?? p.username,
          avatar: p.avatar ?? null,
        });
        token.uid = user.id;
        token.username = user.username;
      }
      return token;
    },
    // Expose our db user id + name on the session object.
    async session({ session, token }) {
      if (token.uid && session.user) {
        session.user.id = token.uid as string;
        session.user.name = (token.username as string) ?? session.user.name;
      }
      return session;
    },
  },
});
