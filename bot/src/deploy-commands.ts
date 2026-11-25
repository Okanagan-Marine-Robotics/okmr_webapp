// Registers the bot's slash commands with your Discord server and applies the
// name and avatar from profile.ts.
// Run once after adding/changing commands or the profile:  npm run bot:deploy
// Guild-scoped registration updates instantly (global commands take ~1 hour).

import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REST, Routes } from "discord.js";
import { env } from "./env.js";
import { commands } from "./commands/index.js";
import { BOT_PROFILE } from "./profile.js";

const body = commands.map((c) => c.data.toJSON());

const rest = new REST().setToken(env.botToken);

try {
  console.log(`Registering ${body.length} commands to guild ${env.guildId}...`);
  await rest.put(
    Routes.applicationGuildCommands(env.clientId, env.guildId),
    { body },
  );
  console.log("Done. Commands are live in your server.");
} catch (error) {
  console.error("Failed to register commands:", error);
  process.exitCode = 1;
}

const AVATAR_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// A profile failure (e.g. Discord's rename rate limit) is reported but doesn't
// fail the run: the commands above are already registered.
try {
  const me = (await rest.get(Routes.user("@me"))) as { username: string };
  const patch: { username?: string; avatar?: string } = {};
  if (me.username !== BOT_PROFILE.name) patch.username = BOT_PROFILE.name;
  if (BOT_PROFILE.avatarPath) {
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    const mime = AVATAR_MIME[extname(BOT_PROFILE.avatarPath).toLowerCase()];
    if (!mime) throw new Error(`Unsupported avatar type: ${BOT_PROFILE.avatarPath}`);
    const bytes = await readFile(resolve(repoRoot, BOT_PROFILE.avatarPath));
    patch.avatar = `data:${mime};base64,${bytes.toString("base64")}`;
  }
  if (Object.keys(patch).length > 0) {
    await rest.patch(Routes.user("@me"), { body: patch });
    console.log(`Bot profile set: name "${BOT_PROFILE.name}"${patch.avatar ? ", avatar updated" : ""}.`);
  }
} catch (error) {
  console.warn("Could not update the bot profile:", error);
}
