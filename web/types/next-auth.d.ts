import type { DefaultSession } from "next-auth";

// Add our own database user id to the session's user object.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

// Fields we stash on the JWT in the auth.ts `jwt` callback.
declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    username?: string;
  }
}
