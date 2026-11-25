# Marine Robotics club-app — Handoff / Continuation Guide

> **Purpose:** everything a new operator (or a fresh Claude session) needs to pick up this project. Written 2026-08-05.

> **Update:** production now runs on **Cloudflare Workers**, not the Pi. `okmrwebapp.ca` is a custom domain on the `okmr-web` Worker, the bot is the `okmr-bot` Worker, the database is D1 (`okmr-db`) and uploads are in Workers KV. The Pi is off. Sections 3, 4, 7 and 8 describe the Pi setup and are kept for reference only; see the "Cloudflare Workers" section of `README.md` for the current deployment.

---

## 1. What this is

**club-app** is a monorepo for **UBC Okanagan Marine Robotics** combining:
- a **Discord bot** (discord.js, run via `tsx`) — slash commands for tasks, forms/requests, meetings, dev logs, tool checkout, SOPs, `/911`, `/config`, `/resync`.
- a **Next.js 15 web app** (App Router, React 19, next-auth v5 Discord login) — Tasks / Calendar / Forms / Devlogs tabs.
- a shared **Prisma** database (D1 on Cloudflare, SQLite locally) both read/write, so Discord actions show up on the website instantly.

Both run as **Cloudflare Workers** (`okmr-web` and `okmr-bot`). The web app is served at **https://okmrwebapp.ca**. They previously ran on a Raspberry Pi 3 behind a Cloudflare Tunnel.

**Monorepo layout** (npm workspaces): `packages/db` (Prisma client + loads root `.env`), `web` (Next.js), `bot` (discord.js). One repo-root `.env` feeds all three.

---

## 2. Current status — IT IS LIVE ✅

| Piece | State |
|---|---|
| Web app | **Live** at https://okmrwebapp.ca, served by the `okmr-web` Worker |
| Discord bot | **Online** as the `okmr-bot` Worker (HTTP interactions + cron), on the **real** club server |
| Database | Cloudflare D1 `okmr-db`, shared by both Workers |
| Uploads | Workers KV namespace `okmr-uploads` |
| Deploys | Workers Builds deploys both Workers on every push to `main` |
| Raspberry Pi | **Off.** Its services, tunnel and SQLite database no longer serve production |

---

## 3. Access

### The Raspberry Pi (the server)
- **SSH:** `ssh -i ~/.ssh/id_ed25519 <pi-user>@<pi-host>` (keep host IP, MAC, Wi-Fi SSID, and sudo details in the club's private password manager, not in Git).
- Hardware: Raspberry Pi 3 Model B, **64-bit Raspberry Pi OS (Debian 13 trixie), aarch64**. Node 22 (system, `/usr/bin/node`).

> **⚠️ SSH from a new machine:** authorize a new SSH public key via `ssh-copy-id` in an interactive terminal rather than copying private keys between machines.

### The code
- On the Pi (the running deployment, source of truth): **`<app-dir>`**
- To deploy updates, sync `web/` or `bot/` (excluding `node_modules`, `.next`, `.env`, and `*.db*`) and restart the corresponding systemd service.

### Accounts / external services
- **Domain:** `okmrwebapp.ca`, registered via **Cloudflare Registrar** (in the club's Cloudflare account).
- **Cloudflare Tunnel (Pi only, no longer in use):** `cloudflared` tunnel that routed `https://okmrwebapp.ca` → `http://127.0.0.1:3000`. The domain now points at the `okmr-web` Worker.
- **Discord app:** OAuth login redirect required: `https://okmrwebapp.ca/api/auth/callback/discord`. Ensure **Public Bot** is toggled **OFF** in Discord Developer Portal → Bot.

### Secrets (values NOT in this doc)
All secrets live only in the server's `.env` (`chmod 600 .env`) or Cloudflare Worker secrets. Do **not** commit `.env`, database files (`*.db`), or backup snapshots (`*.db.bak*`) into Git.

---

## 4. The four systemd services (on the Pi, not running)

```
club-web        next start -H 127.0.0.1 -p 3000  (loopback only; fronted by cloudflared)
club-bot        tsx src/index.ts                 (Discord bot)
club-tunnel     cloudflared tunnel run           (Cloudflare tunnel → 127.0.0.1:3000)
club-powersave  unbinds USB/Ethernet on boot to reduce power draw (Wi-Fi is SDIO, unaffected)
```
Unit files in `/etc/systemd/system/club-*.service`. Common commands:
```
systemctl status club-web            # or club-bot / club-tunnel
sudo systemctl restart club-web
journalctl -u club-bot -n 50 -o cat  # logs (persistent journald is enabled)
```

---

## 5. Done ✅

- Re-flashed the Pi from old 32-bit Raspbian to 64-bit (required: Prisma has no 32-bit-ARM engine).
- Installed Node 22, deployed code + **live database** + uploads + `.env`.
- `next build` (production), systemd services for web + bot, auto-start on boot.
- Cloudflare tunnel + DNS (apex + `www`) → `okmrwebapp.ca` with auto-HTTPS.
- Production `.env`: strong `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `AUTH_URL=https://okmrwebapp.ca`.
- **Moved bot to the real Discord server**, redeployed 21 slash commands, wiped test data (kept logins).
- **Bot avatar** = Marine Robotics logo.
- **Reminder upgraded** (`bot/src/lib/schedule.ts`): the scheduled channel update now also lists **🆕 forms submitted this week** and **⏳ open forms older than a week (awaiting a decision)**, alongside the tasks + "meetings this week" it already had. (Split so no form is listed twice.)
- **Website branding — LIVE & verified** (2026-08-05): navy header bar + logo + wordmark, brand-blue accents, login-page logo hero, favicon. Colors sampled from the logo: navy `#1A3548`, blue `#47A9EB`. Files: `web/app/globals.css`, `web/app/layout.tsx`, `web/app/nav.tsx`, `web/app/pills.tsx`, `web/app/page.tsx`, logo at `web/public/logo.png`, favicon `web/app/icon.png`.

---

## 6. Pending / next steps ⬜

1. **User must run `/resync`** in the real Discord server → populates the website's channel pills (Team rows) from the real forums/posts. Until then the Tasks/Calendar/Forms/Devlogs channel filters are empty. (The website treats **only forum posts** as "channels" — not categories/forums/text channels.)
2. **Add the Discord login redirect** if not done: Discord Developer Portal → app → OAuth2 → Redirects → `https://okmrwebapp.ca/api/auth/callback/discord`. Without it, "Login with Discord" errors.
3. **Per-channel reminder config** is already independent (`/config` in each channel; stored per-team). Users set schedules with `/config days:Mon,Thu time:09:00 ping:true`.
4. **⚡ POWER — the one real reliability risk:** the Pi brown-out-rebooted once under load (`vcgencmd get_throttled` returned `0x50000` = under-voltage occurred). **Fix: use a proper 5.1 V / 2.5 A supply** (official Raspberry Pi 3 PSU — regulated 5.1 V beats cable voltage-drop; a generic "big" 5 V charger is not enough). Everything auto-restarts on boot, so outages self-heal in ~1 min, but this should be fixed.

---

## 7. Gotchas worth knowing

- **Raspberry Pi Imager customization silently did NOT apply** on this flash (no SSH/key/hostname/Wi-Fi-country). If re-flashing, verify each on first boot. Wi-Fi was rfkill-soft-blocked until a country was set (`sudo raspi-config nonint do_wifi_country CO`).
- **`tsx -e` compiles as CommonJS → rejects top-level `await`.** For one-off scripts, put code in a `.mts` file, or use `.then()` and import `@club/db` first (that's what loads the root `.env`).
- **The bot must be the ONLY instance on its token** — two running bots = every command fires twice. `okmr-bot` on Workers now runs it, so do not start `club-bot` on the Pi.
- **`DATABASE_URL="file:./prisma/dev.db"`** is relative (Prisma resolves it against `prisma/schema.prisma` → `prisma/prisma/dev.db`). Portable; don't "fix" it to an absolute path.
- **Local dev `.env`:** ensure `DISCORD_GUILD_ID` matches the target server ID when testing locally, as both web sign-in and bot commands reject interactions from any other guild.
- Keep database backups outside the Git working tree with `chmod 600` permissions.

---

## 8. Redeploy cheatsheet (Pi only)

Production deploys happen automatically from `main` through Workers Builds. The commands below apply only if the Pi is brought back.

**Web (after editing `web/`):**
```
rsync -az --exclude node_modules --exclude .next web/ <pi-user>@<pi-host>:<app-dir>/web/
ssh <pi-user>@<pi-host> 'cd <app-dir> && npm run build --workspace web && sudo systemctl restart club-web'
```
**Bot (after editing `bot/` — no build, tsx runs TS directly):**
```
rsync -az --exclude node_modules bot/ <pi-user>@<pi-host>:<app-dir>/bot/
ssh <pi-user>@<pi-host> 'sudo systemctl restart club-bot'
```
**New/changed slash commands:** `ssh <pi-user>@<pi-host> 'cd <app-dir> && npm run bot:deploy'`
**DB schema change:** edit `prisma/schema.prisma`, then on the Pi `npx prisma migrate deploy` + `npx prisma generate`, then rebuild/restart.

**Health check (production):** `curl -s -o /dev/null -w "%{http_code}" https://okmrwebapp.ca/` (want 200/307). This checks the `okmr-web` Worker, not the Pi.
**Health check (Pi):** `systemctl is-active club-web club-bot club-tunnel`.
