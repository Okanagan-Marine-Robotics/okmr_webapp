// OpenNext adapter for the existing Next.js app. vinext is the path Cloudflare
// recommends for new apps, but `vinext check` reports next-auth as incompatible.
// Defaults keep the incremental cache in-process ("dummy") so this config does
// not create an R2 cache bucket. Authenticated pages read D1 on each request.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
