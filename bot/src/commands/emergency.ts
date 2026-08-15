import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { prisma } from "@club/db";
import type { Command } from "../types.js";
import { resolveTeam, resolveUser } from "../lib/context.js";
import { formatLocalDateTime } from "../lib/date.js";
import { readEmergencyInfo } from "../lib/sops.js";

const INLINE_LIMIT = 3800;

export const emergency: Command = {
  data: new SlashCommandBuilder()
    .setName("911")
    .setDescription("Raise an emergency: prints the club's emergency info and logs it")
    .addStringOption((o) =>
      o.setName("what").setDescription("What's happening? (optional but helpful)"),
    ),

  async execute(interaction) {
    const what = interaction.options.getString("what")?.trim() ?? "";

    // Answer first and worry about bookkeeping after — the whole point of this
    // command is getting the information on screen fast.
    const info = await readEmergencyInfo();
    const tooLong = info !== null && info.length > INLINE_LIMIT;

    const embed = new EmbedBuilder()
      .setTitle("🚨 EMERGENCY")
      .setColor(0xe5484d)
      .setDescription(
        info === null
          ? "**No emergency info file found.** Add one at `web/emergency.txt`."
          : tooLong
            ? "Emergency information attached below."
            : `\`\`\`\n${info}\n\`\`\``,
      );

    if (what) embed.addFields({ name: "Reported", value: what.slice(0, 1024) });
    embed.addFields({
      name: "Raised by",
      value: `${interaction.user} at ${formatLocalDateTime(new Date())}`,
    });
    embed.setFooter({
      text: "If someone is seriously hurt, call emergency services first — don't wait on Discord.",
    });

    await interaction.reply({
      embeds: [embed],
      files:
        tooLong && info
          ? [new AttachmentBuilder(Buffer.from(info, "utf8"), { name: "emergency.txt" })]
          : [],
    });

    // Logged as an open ticket so it shows on the web app and someone closes
    // the loop. Never let a logging failure swallow the reply above.
    if (!interaction.inGuild()) return;

    try {
      // Safe to call after replying: we're in a guild, so resolveTeam won't
      // try to send its own "run this in a server" reply.
      const team = await resolveTeam(interaction);
      const user = await resolveUser(interaction.user);
      if (team) {
        await prisma.ticket.create({
          data: {
            type: "emergency",
            requesterId: user.id,
            teamId: team.id,
            status: "open",
            details: JSON.stringify({
              what: what || "(not described)",
              raisedBy: user.username,
            }),
          },
        });
      }
    } catch (error) {
      console.error("Couldn't log the emergency ticket:", error);
    }
  },
};
