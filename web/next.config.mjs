import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load repo-root `.env` before Next.js spawns both Node and Edge Middleware
// workers in local dev (`npm run web:dev`) or standalone `next start`.
if (!process.env.AUTH_SECRET && !process.env.DISCORD_CLIENT_ID) {
  try {
    const { config } = await import("dotenv");
    const here = dirname(fileURLToPath(import.meta.url));
    config({ path: resolve(here, "../.env") });
  } catch {
    // Ignored in bundled/Cloudflare environments where secrets come from Worker bindings.
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shared @okmr_webapp/* workspace packages ship TypeScript source, so Next
  // must transpile them rather than expect pre-built JS.
  transpilePackages: [
    "@okmr_webapp/db",
    "@okmr_webapp/shared",
    "@okmr_webapp/storage",
  ],

  // Those packages use NodeNext-style relative imports with explicit ".js"
  // extensions (required by tsc). Teach webpack to resolve a ".js"
  // specifier to the ".ts" source so `./index.js` finds `index.ts`.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },

  async headers() {
    return [
      {
        // `/uploads/*` sets its own strict sandbox CSP in its Route Handler.
        source: "/((?!uploads/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://discord.com",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
