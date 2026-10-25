# Club App

One system, two front-ends over a shared database:

- **web/** — Next.js web app (task boards, calendar, files, tickets) with "Login with Discord".
- **bot/** — Discord bot (`/task`, `/lstask`, `/mdtask`, `/cltask`, `/config`, `/help`, etc.) that runs either as a **Cloudflare Worker** (HTTP Interactions + Cron Triggers) or as a standalone Node Gateway process.
- **packages/db/** (`@okmr_webapp/db`) — dual-mode Prisma client supporting **Cloudflare D1** and **local SQLite**.
- **packages/storage/** (`@okmr_webapp/storage`) — pluggable upload storage supporting **Cloudflare R2** and **local disk (`web/uploads/`)**.
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
4. Invite the bot to your server: **OAuth2 → URL Generator** → scopes `bot` + `applications.commands` → open the generated URL.
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

## Deploy Modularly to Cloudflare Pages & Workers (Free Tier)

1. **Create the shared Cloudflare D1 database and R2 bucket:**
   ```bash
   npx wrangler d1 create okmr-db
   npx wrangler r2 bucket create okmr-uploads
   ```
   Copy the returned `database_id` into both `bot/wrangler.toml` and `web/wrangler.toml`, then apply the Prisma migrations to D1:
   ```bash
   npm run db:d1:migrate:remote
   ```

2. **Deploy the Discord Bot Worker (`okmr-bot`):**
   ```bash
   npx wrangler secret put DISCORD_BOT_TOKEN --config bot/wrangler.toml
   npx wrangler secret put DISCORD_CLIENT_ID --config bot/wrangler.toml
   npx wrangler secret put DISCORD_GUILD_ID --config bot/wrangler.toml
   npx wrangler secret put DISCORD_PUBLIC_KEY --config bot/wrangler.toml
   npm run bot:cf:deploy
   ```
   In the [Discord Developer Portal](https://discord.com/developers/applications) → **General Information** → **Interactions Endpoint URL**, paste `https://okmr-bot.<your-subdomain>.workers.dev/interactions`.

3. **Deploy the Next.js Web App (`okmr-web`):**
   ```bash
   npx wrangler secret put DISCORD_CLIENT_ID --config web/wrangler.toml
   npx wrangler secret put DISCORD_CLIENT_SECRET --config web/wrangler.toml
   npx wrangler secret put DISCORD_BOT_TOKEN --config web/wrangler.toml
   npx wrangler secret put DISCORD_GUILD_ID --config web/wrangler.toml
   npx wrangler secret put AUTH_SECRET --config web/wrangler.toml
   npx wrangler secret put AUTH_URL --config web/wrangler.toml
   npm run web:cf:deploy
   ```

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
