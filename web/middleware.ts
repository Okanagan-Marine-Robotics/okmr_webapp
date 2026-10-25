import NextAuth from "next-auth";
import { buildBaseAuthConfig } from "./auth.config";

const { auth } = NextAuth(() => buildBaseAuthConfig());

export default auth;

export const config = {
  // Run auth fence across all pages and /uploads/*, excluding static assets and NextAuth routes.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico|icon\\.png|logo\\.png).*)",
  ],
};
