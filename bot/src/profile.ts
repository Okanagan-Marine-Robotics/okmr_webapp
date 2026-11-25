// The bot's Discord profile. Edit these and run `npm run bot:deploy` to apply.
// Discord limits how often a bot can be renamed (about twice an hour).
export const BOT_PROFILE: { name: string; avatarPath: string | null } = {
  name: "okmr-webapp",
  // Image file relative to the repo root (png, jpg, gif or webp), or null to
  // leave the current avatar alone.
  avatarPath: "web/public/logo.png",
};
