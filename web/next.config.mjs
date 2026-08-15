/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shared @club/db workspace package ships TypeScript source, so Next
  // must transpile it rather than expect pre-built JS.
  transpilePackages: ["@club/db"],

  // That package uses NodeNext-style relative imports with explicit ".js"
  // extensions (required by the bot's tsc). Teach webpack to resolve a ".js"
  // specifier to the ".ts" source so `./index.js` finds `index.ts`.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
