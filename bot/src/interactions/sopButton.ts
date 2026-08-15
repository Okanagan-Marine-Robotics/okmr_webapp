import { EmbedBuilder, MessageFlags } from "discord.js";
import type { ButtonInteraction } from "discord.js";
import { prisma } from "@club/db";
import { SOP_BUTTON_PREFIX } from "../commands/sop.js";
import { sopTitle } from "../lib/sops.js";
import { resolveTeam, resolveUser } from "../lib/context.js";
import { formatLocalDateTime } from "../lib/date.js";

// Handle the Completed / Not completed buttons under a /sop message. Returns
// true if it handled the interaction, false if the button wasn't ours.
//
// Both verdicts use interaction.update() rather than reply(): update() edits
// the very message the button sits on, so we can strip the buttons and leave a
// resolved state behind. reply() (the old behaviour) posted a *new* message and
// left the original SOP bubble open with its buttons still live.
export async function handleSopButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith(SOP_BUTTON_PREFIX)) return false;

  // customId is "sop:<verdict>:<name>"; the name can't contain ":" because
  // listSops only accepts [A-Za-z0-9_-].
  const rest = interaction.customId.slice(SOP_BUTTON_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator === -1) return false;

  const verdict = rest.slice(0, separator);
  const name = rest.slice(separator + 1);
  const completed = verdict === "done";

  // "Not completed" is just dismissing the procedure — a SOP is reference
  // material, so not doing it isn't an event worth recording. Close the bubble
  // (drop the embed, attachment and buttons) and log nothing.
  if (!completed) {
    await interaction.update({
      content: `🚪 **${sopTitle(name)}** closed — not marked complete, nothing logged.`,
      embeds: [],
      components: [],
      attachments: [],
    });
    return true;
  }

  const team = await resolveTeam(interaction);
  if (!team) {
    // Can't record it without a team — leave the buttons so they can retry.
    await interaction.reply({
      content: "Couldn't work out this channel's team — run the SOP in a normal server channel.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const user = await resolveUser(interaction.user);

  const ticket = await prisma.ticket.create({
    data: {
      type: "sop",
      requesterId: user.id,
      teamId: team.id,
      // A completed run is a record, not a request — there's nothing to approve.
      status: "approved",
      resolvedAt: new Date(),
      details: JSON.stringify({
        sop: sopTitle(name),
        outcome: "Completed",
        by: user.username,
      }),
    },
  });

  const embed = new EmbedBuilder()
    .setTitle("✅ SOP completed")
    .addFields(
      { name: "Procedure", value: sopTitle(name) },
      { name: "Team", value: team.name, inline: true },
      { name: "Logged by", value: user.username, inline: true },
      { name: "When", value: formatLocalDateTime(ticket.createdAt), inline: true },
    );

  // Replace the interactive SOP message with the completed record and drop the
  // buttons so it reads as resolved and can't be double-logged.
  await interaction.update({ embeds: [embed], components: [], attachments: [] });
  return true;
}
