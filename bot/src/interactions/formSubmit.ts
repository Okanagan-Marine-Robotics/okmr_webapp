import { EmbedBuilder, MessageFlags } from "discord.js";
import type { ModalSubmitInteraction } from "discord.js";
import { prisma } from "@club/db";
import { FORM_PREFIX, findForm } from "../lib/forms.js";
import type { FormDef } from "../lib/forms.js";
import { resolveTeam, resolveUser } from "../lib/context.js";
import { formatLocalDateTime, parseWhenRange } from "../lib/date.js";

// Handle submission of any /form modal. Returns true if it handled the
// interaction, false if the modal wasn't ours.
export async function handleFormSubmit(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  if (!interaction.customId.startsWith(FORM_PREFIX)) return false;
  const type = interaction.customId.slice(FORM_PREFIX.length);
  const def = findForm(type);
  if (!def) return false;

  // Collect every answer by field id. Empty optional answers are left out
  // entirely rather than stored as "".
  const details: Record<string, string> = {};
  for (const field of def.fields) {
    const value =
      field.kind === "select"
        ? (interaction.fields.getStringSelectValues(field.id)[0] ?? "")
        : interaction.fields.getTextInputValue(field.id).trim();
    if (value) details[field.id] = value;
  }

  // Normalise date/time answers so the web view can sort by them. The raw text
  // is kept as-is and is what gets displayed.
  for (const field of def.fields) {
    if (field.kind !== "when") continue;
    const raw = details[field.id];
    if (!raw) continue;

    const range = parseWhenRange(raw);
    if (!range) {
      await interaction.reply({
        content: `Couldn't read "${raw}" as a date/time. Try e.g. "fri 2pm-5pm" or "2026-08-01 14:00".`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    details[`${field.id}StartsAt`] = range.start.toISOString();
    if (range.end) details[`${field.id}EndsAt`] = range.end.toISOString();
  }

  // resolveTeam replies on failure, so it runs before deferring.
  const team = await resolveTeam(interaction);
  if (!team) return true;
  const requester = await resolveUser(interaction.user);

  await interaction.deferReply();

  const ticket = await prisma.ticket.create({
    data: {
      type: def.type,
      requesterId: requester.id,
      teamId: team.id,
      status: "open",
      details: JSON.stringify(details),
    },
  });

  await interaction.editReply({
    embeds: [submissionEmbed(def, details, requester.username, ticket.createdAt)],
  });
  return true;
}

function submissionEmbed(
  def: FormDef,
  details: Record<string, string>,
  username: string,
  submittedAt: Date,
): EmbedBuilder {
  const fields = def.fields
    .filter((field) => details[field.id])
    .map((field) => ({
      name: field.label,
      value: details[field.id].slice(0, 1024),
    }));

  fields.push({ name: "Submitted", value: formatLocalDateTime(submittedAt) });

  return new EmbedBuilder()
    .setTitle(`${def.label} — submitted`)
    .setDescription(`Filed by **${username}**. Leads can resolve it on the web app.`)
    .addFields(fields);
}
