import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Discord from "next-auth/providers/discord";
import { getRuntimeEnv, verifyGuildMember } from "./app/discord-guild";

// Re-verify active OKMR Discord guild membership & Lead roles every 5 minutes.
// If Discord has a brief 5xx/rate-limit blip during a background re-check, allow
// up to 30 minutes since last verified check before failing closed.
const GUILD_REVERIFY_INTERVAL_MS = 5 * 60 * 1000;
const GUILD_MAX_STALE_MS = 30 * 60 * 1000;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Discord's OAuth authorization server metadata:
// https://discord.com/.well-known/oauth-authorization-server
// issuer is https://discord.com and authorization_response_iss_parameter_supported is true.
// @auth/core 0.41.2 otherwise fills issuer with https://authjs.dev, and
// oauth4webapi 3.8.6 rejects Discord's iss on the callback.
export const DISCORD_OAUTH_ISSUER = "https://discord.com";

export async function revalidateGuildJwt(token: JWT): Promise<JWT | null> {
  // Reject any pre-fence legacy JWT that lacks a verified Discord snowflake or DB user id.
  if (
    !token.uid ||
    !token.discordId ||
    typeof token.guildVerifiedAt !== "number"
  ) {
    return null;
  }

  const age = Date.now() - token.guildVerifiedAt;
  if (age < GUILD_REVERIFY_INTERVAL_MS) {
    return token;
  }

  const check = await verifyGuildMember(token.discordId);
  if (check.allowed) {
    token.isLead = check.isLead;
    token.guildVerifiedAt = Date.now();
    return token;
  }

  // Immediately revoke if the member left/was kicked, failed role checks, or env is misconfigured.
  if (check.definitive || age > GUILD_MAX_STALE_MS) {
    return null;
  }

  return token;
}

// Edge-compatible NextAuth configuration (no Prisma or Node `fs` imports) so
// `middleware.ts` can verify JWE sessions and periodically re-check OKMR guild membership.
export function buildBaseAuthConfig(): NextAuthConfig {
  return {
    pages: {
      signIn: "/",
      error: "/",
    },
    session: {
      strategy: "jwt",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
    providers: [
      Discord({
        clientId: getRuntimeEnv("DISCORD_CLIENT_ID"),
        clientSecret: getRuntimeEnv("DISCORD_CLIENT_SECRET"),
        issuer: DISCORD_OAUTH_ISSUER,
        authorization: {
          params: {
            scope: "identify",
          },
        },
      }),
    ],
    callbacks: {
      authorized({ request, auth }) {
        const { pathname } = request.nextUrl;

        // Public routes: root login page and NextAuth OAuth endpoints.
        if (pathname === "/" || pathname.startsWith("/api/auth/")) {
          return true;
        }

        const isSignedIn = Boolean(auth?.user?.id);

        // Return 401 (rather than HTML redirect) for unauthenticated upload fetches.
        if (pathname.startsWith("/uploads/")) {
          if (!isSignedIn) {
            return new Response("Unauthorized", { status: 401 });
          }
          return true;
        }

        return isSignedIn;
      },
      async jwt({ token }) {
        return revalidateGuildJwt(token);
      },
      async session({ session, token }) {
        if (token.uid && session.user) {
          session.user.id = token.uid;
          session.user.discordId = token.discordId;
          session.user.isLead = Boolean(token.isLead);
          session.user.name = token.username ?? session.user.name;
        }
        return session;
      },
    },
  };
}
