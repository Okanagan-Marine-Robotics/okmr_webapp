# Club App

One system, two front-ends over a shared database:

- **web/** — Next.js web app (task boards, calendar, files, tickets) with "Login with Discord".
- **bot/** — Discord bot (`/task`, `/lstask`, `/mdtask`, `/cltask`, `/config`, `/help`, etc.) that runs either as a **Cloudflare Worker** (HTTP Interactions + Cron Triggers) or as a standalone Node Gateway process.
- **packages/db/** (`@okmr_webapp/db`) — dual-mode Prisma client supporting **Cloudflare D1** and **local SQLite**.
- **packages/storage/** (`@okmr_webapp/storage`) — local disk (`web/uploads/`) on Node. The Cloudflare Worker has uploads disabled and does not use R2.
- **packages/shared/** (`@okmr_webapp/shared`) — shared SOPs, emergency info, form definitions, importance levels, and timezone helpers.
- **prisma/schema.prisma** — the single source of truth for the database.

See `../.claude/plans/how-do-i-make-moonlit-sphinx.md` for the full roadmap.

## Prerequisites

- **Node.js 20+** and npm. (Already installed on this machine via nvm — v24.18.0. Just restart your shell so `node`/`npm` are on your PATH. On a fresh machine, see "Install Node" below.)
- A Discord account and a server you can manage.

## One-time setup

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **OAuth2** tab → copy **Client ID** and **Client Secret**.
   - Under **Redirects**, add: `http://localhost:3000/api/auth/callback/discord`
     (and later your Cloudflare URL: `https://club.example.com/api/auth/callback/discord`).
3. **Bot** tab → **Reset Token** → copy the **Bot Token**.
   - Under **Privileged Gateway Intents**, toggle on **Server Members Intent** (used to iterate members and auto-assign combined subteam roles like `AUV Software`).
4. Invite the bot to your server: **OAuth2 → URL Generator** → scopes `bot` + `applications.commands` → grant **Manage Roles** permission → open the generated URL. In Discord **Server Settings → Roles**, drag the bot's role **above** any combined subteam roles (`AUV Software`, `Hydrofoil Mechanical`, etc.) so it can assign and remove them.
5. In Discord, enable **Developer Mode** (Settings → Advanced), then right-click your server → **Copy Server ID**.

### 2. Configure environment

```bash
cp .env.example .env
# then fill in DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN,
# DISCORD_GUILD_ID, and AUTH_SECRET (openssl rand -base64 32)
```

### 3. Install dependencies and set up the database

```bash
npm install
npm run db:generate        # generate the Prisma client
npm run db:migrate         # create the SQLite database (prisma/dev.db)
```

## Run it (local)

Two processes, in separate terminals:

```bash
npm run web:dev            # web app at http://localhost:3000
```

```bash
npm run bot:deploy         # register slash commands to your server (run once, and after command changes)
npm run bot:dev            # start the bot
```

## Verify Phase 0 + 1

- **Login:** open <http://localhost:3000>, click **Login with Discord**, confirm your name appears. Check the DB with `npm run db:studio`.
- **Tasks:** in a server channel run `/task` — a **form** opens (title, assignee, importance, due date, notes). Submit it, then `/lstask` shows open tasks colour-coded most-important-first. Refresh <http://localhost:3000/tasks> — the task appears with an importance badge. Edit with `/mdtask <name>`, finish with `/fin <name>`.
- **Scheduled updates:** `/config days:Mon,Thu time:09:00` sets when the bot posts a per-channel "update message" (days till due, importance, assignee). Add `ping:true` to also @-ping assignees of due-soon tasks; `days:off` pauses. Run `/config` with no options to see current settings. Times use the host machine's local timezone.

> Note: run `npm run bot:deploy` again whenever slash commands change (e.g. after pulling new bot code), or Discord won't show the updated commands.

## Install Node (this machine)

Fedora, user-local (no sudo), via nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart your shell, then:
nvm install --lts
node --version
```

## Cloudflare Workers (prepared, not deployed)

The web app is a full-stack Next.js app, so it deploys as one Worker with static assets (`okmr-web`). Do not create a Pages project. `vinext check` reports `next-auth` as incompatible, so the Worker uses the OpenNext adapter already started in this repo.

The Worker is configured as the main script on `workers.dev` only. It has no routes and no custom domain. Do not attach `okmrwebapp.ca` or `okmarinerobotics.com`, and do not modify the existing Worker `okmarinerobotics-com`.

`npm run web:cf:check` confirms that guard. `npm run web:cf:dry-run` builds and packages without uploading. A real deploy, a remote D1 migration, and a bot deploy each require an explicit `OKMR_ALLOW_*=1` flag. A `workers.dev` URL is public until Worker-scoped Cloudflare Access is enabled; do not turn on account-wide Access.

This configuration has no R2 binding. On the Worker, dev-journal files fail closed with “File attachments are disabled on this deployment.” Notes, tasks, calendar, forms, and Discord login still use D1. Local Node and the Pi keep saving files under `web/uploads/`.

Publish only on the Workers Free plan, where exhausted request, CPU, log, and D1 quotas fail the operation. The Workers Paid plan bills overages, so it does not meet the zero-incremental-cost condition. Do not enable R2 or any other paid product for this deploy. Workers Free includes 100,000 requests/day and 10 ms CPU per request; D1 Free includes 5 million row reads/day, 100,000 row writes/day, and 5 GB. Workers Logs on Free include 200,000 events/day. Static asset requests are unlimited.

Secret names for the web Worker are `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `AUTH_SECRET`, and `AUTH_URL`. Optional names are `DISCORD_REQUIRED_ROLE_IDS` and `DISCORD_LEAD_ROLE_IDS`. `CLUB_TIMEZONE` is a plain var. The bot Worker also needs `DISCORD_PUBLIC_KEY`. Do not deploy the bot while the Pi process is using the same bot token.

## Deploy to the Raspberry Pi (Phase 0, step 3–4)

1. Copy the repo to the Pi, install Node, run the setup steps above.
2. Install `cloudflared` and create a named tunnel pointing `club.<yourdomain>` → `http://localhost:3000`.
3. Use `pm2` to keep both processes alive:
   ```bash
   npm i -g pm2
   pm2 start "npm run start --workspace web" --name web
   pm2 start "npm run start --workspace bot" --name bot
   pm2 save && pm2 startup
   ```
