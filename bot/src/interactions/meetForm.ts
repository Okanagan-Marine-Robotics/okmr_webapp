import {
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
} from "discord.js";
import type { ModalSubmitInteraction } from "discord.js";
import { prisma } from "@club/db";
import { MEET_FORM_PREFIX } from "../lib/meetModal.js";
import { resolveTeam } from "../lib/context.js";
import { parseWhen } from "../lib/date.js";
import { formatTimeOfDay } from "../lib/weekdays.js";
import { recurrenceRuleFor } from "../lib/meetings.js";

// Handle submission of the /meet (create) and /mdmeet (edit) forms. Returns true
// if it handled the interaction, false if the modal wasn't ours.
export async function handleMeetForm(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  if (!interaction.customId.startsWith(MEET_FORM_PREFIX)) return false;
  const rest = interaction.customId.slice(MEET_FORM_PREFIX.length);

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "Meetings can only be managed in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const title = interaction.fields.getTextInputValue("title").trim();
  const whenRaw = interaction.fields.getTextInputValue("when").trim();
  const room = interaction.fields.getTextInputValue("room").trim() || "TBD";
  const durationRaw = interaction.fields.getTextInputValue("duration").trim();
  const recurrence = interaction.fields.getStringSelectValues("recurrence")[0] ?? "once";

  const parsed = parseWhen(whenRaw);
  if (!parsed) {
    await interaction.reply({
      content: `Couldn't read "${whenRaw}" as a date/time. Try e.g. "next fri 3pm" or "2026-08-01 15:00".`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (!parsed.hasTime) {
    await interaction.reply({
      content: `Please include a **time**, e.g. "next fri **3pm**" or "2026-08-01 **15:00**" — not just a date.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const start = parsed.date;
  if (start.getTime() <= Date.now()) {
    await interaction.reply({
      content: "That start time is in the past — pick a future time.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const durationParsed = parseInt(durationRaw, 10);
  const duration = Number.isFinite(durationParsed)
    ? Math.min(1440, Math.max(15, durationParsed))
    : 60;
  const end = new Date(start.getTime() + duration * 60_000);
  const rule = recurrenceRuleFor(recurrence, start);

  if (rest === "new") {
    const team = await resolveTeam(interaction);
    if (!team) return true;
    await interaction.deferReply();

    const baseOptions = {
      name: title,
      scheduledStartTime: start,
      scheduledEndTime: end, // External events require an end time
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: room },
    };

    let event;
    try {
      event = await guild.scheduledEvents.create(
        rule ? { ...baseOptions, recurrenceRule: rule } : baseOptions,
      );
    } catch (err) {
      if (rule) {
        console.warn("Recurrence rule rejected; creating a single event instead:", err);
        event = await guild.scheduledEvents.create(baseOptions);
      } else {
        throw err;
      }
    }

    await prisma.meeting.upsert({
      where: { discordEventId: event.id },
      create: { discordEventId: event.id, teamId: team.id, title, startsAt: start, endsAt: end, location: room, recurrence },
      update: { teamId: team.id, title, startsAt: start, endsAt: end, location: room, recurrence },
    });

    await interaction.editReply({ embeds: [meetingEmbed("Meeting scheduled", title, start, end, room, recurrence)] });
    return true;
  }

  if (rest.startsWith("edit:")) {
    const meetingId = rest.slice("edit:".length);
    const existing = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!existing) {
      await interaction.reply({
        content: "That meeting no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    await interaction.deferReply();

    // Best-effort edit of the live Discord event (retry without the recurrence
    // rule if Discord rejects it).
    let discordOk = false;
    if (existing.discordEventId) {
      const edit = { name: title, scheduledStartTime: start, scheduledEndTime: end, entityMetadata: { location: room } };
      try {
        await guild.scheduledEvents.edit(existing.discordEventId, { ...edit, recurrenceRule: rule });
        discordOk = true;
      } catch (err) {
        try {
          await guild.scheduledEvents.edit(existing.discordEventId, { ...edit, recurrenceRule: null });
          discordOk = true;
        } catch (err2) {
          console.warn("Couldn't edit the Discord event:", err2);
        }
      }
    }

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { title, startsAt: start, endsAt: end, location: room, recurrence },
    });

    const embed = meetingEmbed("Meeting updated", title, start, end, room, recurrence);
    if (existing.discordEventId && !discordOk) {
      embed.setFooter({ text: "⚠️ Calendar updated, but the Discord event couldn't be changed." });
    }
    await interaction.editReply({ embeds: [embed] });
    return true;
  }

  return false;
}

function meetingEmbed(
  heading: string,
  title: string,
  start: Date,
  end: Date,
  room: string,
  recurrence: string,
): EmbedBuilder {
  return new EmbedBuilder().setTitle(heading).addFields(
    { name: "What", value: title },
    {
      name: "When",
      value: `${start.toDateString()} · ${formatTimeOfDay(start.getHours(), start.getMinutes())}–${formatTimeOfDay(end.getHours(), end.getMinutes())}`,
      inline: true,
    },
    { name: "Where", value: room, inline: true },
    { name: "Repeats", value: recurrence === "once" ? "one-time" : recurrence, inline: true },
  );
}
