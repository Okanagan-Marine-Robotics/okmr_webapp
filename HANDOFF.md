# Marine Robotics club-app — Handoff / Continuation Guide

> **Purpose:** everything a new operator (or a fresh Claude session) needs to pick up this project. Written 2026-08-05.

---

## 1. What this is

**club-app** is a monorepo for **UBC Okanagan Marine Robotics** combining:
- a **Discord bot** (discord.js, run via `tsx`) — slash commands for tasks, forms/requests, meetings, dev logs, tool checkout, SOPs, `/911`, `/config`, `/resync`.
- a **Next.js 15 web app** (App Router, React 19, next-auth v5 Discord login) — Tasks / Calendar / Forms / Devlogs tabs.
- a shared **Prisma + SQLite** database both read/write, so Discord actions show up on the website instantly.

Both run on a **Raspberry Pi 3** at home, exposed to the internet via a **Cloudflare Tunnel** at **https://okmrwebapp.ca**.

**Monorepo layout** (npm workspaces): `packages/db` (Prisma client + loads root `.env`), `web` (Next.js), `bot` (discord.js). One repo-root `.env` feeds all three.

---

## 2. Current status — IT IS LIVE ✅

| Piece | State |
|---|---|
| Web app | **Live** at https://okmrwebapp.ca (valid HTTPS via Cloudflare Universal SSL) |
| Discord bot | **Online**, on the **real** club server, avatar = Marine Robotics logo |
| Database | SQLite on the Pi, **test data wiped** (fresh; 5 user logins kept) |
| Auto-start | All services `enabled` on boot + auto-restart on crash |
| LAN access | Also reachable at `http://192.168.0.3:3000` on the club Wi-Fi |

---

## 3. Access

### The Raspberry Pi (the server)
- **SSH:** `ssh -i ~/.ssh/id_ed25519 pi@192.168.0.3` — user `pi`, **passwordless sudo** enabled.
- Hardware: Raspberry Pi 3 Model B, **64-bit Raspberry Pi OS (Debian 13 trixie), aarch64**. Node 22 (system, `/usr/bin/node`).
- IP `192.168.0.3` is **DHCP** — may change. Rediscover by MAC `B8:27:EB:07:FC:BA` (Raspberry Pi OUI) or hostname `raspberrypi.local`.
- Wi-Fi: `TP-Link_4204` (2.4 GHz — Pi 3 can't do 5 GHz). Country code `CO`.

> **⚠️ SSH from a new machine:** the private key lives on the original dev machine (`~/.ssh/id_ed25519`). To manage the Pi from a different computer you must either copy that key pair over, **or** generate a new key there and authorize it:
> `ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@192.168.0.3` (run in a **real terminal** — needs the `pi` password once; the in-app `!` shell has no TTY for the prompt).

### The code
- On the Pi (the running deployment, source of truth): **`/home/pi/club-app`**
- On the original dev machine: `/home/mateobravo/ClaudeCode/club-app`
- To get the code on a new machine: `rsync -az --exclude node_modules --exclude .next pi@192.168.0.3:/home/pi/club-app/ ./club-app/` then `npm install`.

### Accounts / external services
- **Domain:** `okmrwebapp.ca`, registered via **Cloudflare Registrar** (in the club's Cloudflare account).
- **Cloudflare Tunnel:** name `club-app`, ID `607e0d5a-ff16-4804-97ec-f019e748ad39`. Config at `/home/pi/.cloudflared/config.yml` (ingress → `localhost:3000`). Cert at `/home/pi/.cloudflared/cert.pem`.
- **Discord app:** client ID `1528184959066574951`. Real server (guild) ID `1534345322342518948`. OAuth login redirect required: `https://okmrwebapp.ca/api/auth/callback/discord`.

### Secrets (values NOT in this doc — read them on the Pi)
All secrets live in **`/home/pi/club-app/.env`** (bot token, `AUTH_SECRET`, Discord client secret, Wi-Fi PSK is in NetworkManager). Read with `ssh ... 'cat /home/pi/club-app/.env'`. Do **not** paste secrets into shared docs.

---

## 4. The four systemd services (on the Pi)

```
club-web        next start -p 3000   (web app; binds 0.0.0.0 so LAN works too)
club-bot        tsx src/index.ts     (Discord bot)
club-tunnel     cloudflared tunnel run  (Cloudflare tunnel → localhost:3000)
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
- **The bot must be the ONLY instance on its token** — two running bots = every command fires twice. Only `club-bot` on the Pi should run it.
- **`DATABASE_URL="file:./prisma/dev.db"`** is relative (Prisma resolves it against `prisma/schema.prisma` → `prisma/prisma/dev.db`). Portable; don't "fix" it to an absolute path.
- **The local dev machine's `.env` still has the TEST guild ID** (`865495463343685643`); only the Pi's `.env` was switched to the real guild. Update the dev `.env` if doing local bot testing.
- DB backup before the wipe is on the Pi: `prisma/prisma/dev.db.bak-before-wipe-20260805-051539`.

---

## 8. Redeploy cheatsheet

**Web (after editing `web/`):**
```
rsync -az --exclude node_modules --exclude .next web/ pi@192.168.0.3:/home/pi/club-app/web/
ssh pi@192.168.0.3 'cd /home/pi/club-app && npm run build --workspace web && sudo systemctl restart club-web'
```
**Bot (after editing `bot/` — no build, tsx runs TS directly):**
```
rsync -az --exclude node_modules bot/ pi@192.168.0.3:/home/pi/club-app/bot/
ssh pi@192.168.0.3 'sudo systemctl restart club-bot'
```
**New/changed slash commands:** `ssh pi@192.168.0.3 'cd /home/pi/club-app && npm run bot:deploy'`
**DB schema change:** edit `prisma/schema.prisma`, then on the Pi `npx prisma migrate deploy` + `npx prisma generate`, then rebuild/restart.

**Health check:** `curl -s -o /dev/null -w "%{http_code}" https://okmrwebapp.ca/` (want 200/307), and `systemctl is-active club-web club-bot club-tunnel`.
