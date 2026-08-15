// Registers the bot's slash commands with your Discord server.
// Run once after adding/changing commands:  npm run bot:deploy
// Guild-scoped registration updates instantly (global commands take ~1 hour).

import { REST, Routes } from "discord.js";
import { env } from "./env.js";
import { commands } from "./commands/index.js";

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
