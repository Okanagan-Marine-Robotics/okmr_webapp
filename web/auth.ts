import NextAuth from "next-auth";
import { upsertUser } from "@okmr_webapp/db/helpers";
import { verifyGuildMember } from "./app/discord-guild";
import { buildBaseAuthConfig, revalidateGuildJwt } from "./auth.config";

// Shape of the Discord OAuth profile returned by the `identify` scope.
interface DiscordProfile {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export const { handlers, signIn, signOut, auth } = NextAuth(() => {
  const base = buildBaseAuthConfig();

  return {
    ...base,
    callbacks: {
      ...base.callbacks,
      // Fence login strictly to members of the OKMR Discord server BEFORE any
      // database row is created or JWT cookie is issued.
      async signIn({ account, profile }) {
        if (account?.provider !== "discord" || !profile) {
          return "/?error=AccessDenied";
        }
        const p = profile as unknown as DiscordProfile;
        const check = await verifyGuildMember(p.id);
        if (!check.allowed) {
          return `/?error=${encodeURIComponent(check.reason)}`;
        }
        return true;
      },
      async jwt({ token, profile }) {
        if (profile) {
          const p = profile as unknown as DiscordProfile;
          const check = await verifyGuildMember(p.id);
          if (!check.allowed) {
            return null;
          }

          const user = await upsertUser({
            discordId: p.id,
            username: p.global_name ?? p.username,
            avatar: p.avatar ?? null,
          });

          token.uid = user.id;
          token.discordId = p.id;
          token.username = user.username;
          token.isLead = check.isLead;
          token.guildVerifiedAt = Date.now();
          return token;
        }

        return revalidateGuildJwt(token);
      },
    },
  };
});
