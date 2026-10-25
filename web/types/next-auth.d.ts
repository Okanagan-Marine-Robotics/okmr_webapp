import type { DefaultSession } from "next-auth";

// Add our database user id, Discord snowflake, and OKMR Lead status to the session.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      discordId?: string;
      isLead?: boolean;
    } & DefaultSession["user"];
  }
}

// Fields we stash on the encrypted JWT in `auth.ts` / `auth.config.ts`.
declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    discordId?: string;
    username?: string;
    isLead?: boolean;
    guildVerifiedAt?: number;
  }
}
