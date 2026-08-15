import { EmbedBuilder, MessageFlags } from "discord.js";
import type { ModalSubmitInteraction } from "discord.js";
import { prisma } from "@club/db";
import { TASK_FORM_PREFIX } from "../lib/taskModal.js";
import { resolveTeam, resolveUser } from "../lib/context.js";
import { DEFAULT_IMPORTANCE, importanceMeta } from "../lib/importance.js";
import { describeDue, formatDate, parseDueDate } from "../lib/date.js";

// Handle submission of the /task (create) and /mdtask (edit) forms. Returns true
// if it handled the interaction, false if the modal wasn't one of ours.
export async function handleTaskForm(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  if (!interaction.customId.startsWith(TASK_FORM_PREFIX)) return false;

  await interaction.deferReply({ ephemeral: true });

  const rest = interaction.customId.slice(TASK_FORM_PREFIX.length);
  const title = interaction.fields.getTextInputValue("title").trim();
  const dueRaw = interaction.fields.getTextInputValue("due").trim();
  const notes = interaction.fields.getTextInputValue("notes").trim();
  const importance = importanceMeta(
    interaction.fields.getStringSelectValues("importance")[0] ?? DEFAULT_IMPORTANCE,
  ).value;

  if (dueRaw && !parseDueDate(dueRaw)) {
    await interaction.followUp({
      content: `Couldn't read "${dueRaw}" as a date. Try e.g. "tomorrow", "next fri", "aug 1", "in 2 weeks", or 2026-08-01.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const dueDate = dueRaw ? parseDueDate(dueRaw) : null;

  // The assignee picker can return several Discord users (or none = unassigned).
  const pickedUsers = interaction.fields.getSelectedUsers("assignee");
  const assignees = pickedUsers
    ? await Promise.all([...pickedUsers.values()].map((u) => resolveUser(u)))
    : [];
  const assigneeRows = assignees.map((a) => ({ userId: a.id }));
  const assigneeLabel =
    assignees.length > 0 ? assignees.map((a) => a.username).join(", ") : "unassigned";

  if (rest === "new") {
    const team = await resolveTeam(interaction);
    if (!team) return true;
    const creator = await resolveUser(interaction.user);

    const created = await prisma.task.create({
      data: {
        title,
        teamId: team.id,
        createdById: creator.id,
        dueDate,
        importance,
        notes: notes || null,
        assignees: { create: assigneeRows },
      },
    });

    await interaction.followUp({
      embeds: [taskEmbed("Task created", team.name, created, assigneeLabel)],
    });
    return true;
  }

  if (rest.startsWith("edit:")) {
    const taskId = rest.slice("edit:".length);
    // Replace the whole assignee set with whatever the form now holds.
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        title: title || undefined,
        dueDate,
        notes: notes || null,
        importance,
        assignees: { deleteMany: {}, create: assigneeRows },
      },
    });

    await interaction.followUp({
      content: `Updated **${updated.title}** — assigned to ${assigneeLabel}.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

function taskEmbed(
  heading: string,
  teamName: string,
  task: { title: string; dueDate: Date | null; importance: string },
  assigneeLabel: string,
): EmbedBuilder {
  const imp = importanceMeta(task.importance);
  return new EmbedBuilder().setTitle(heading).addFields(
    { name: "Task", value: task.title },
    { name: "Team", value: teamName, inline: true },
    { name: "Assigned to", value: assigneeLabel, inline: true },
    { name: "Importance", value: `${imp.emoji} ${imp.label}`, inline: true },
    {
      name: "Due",
      value: task.dueDate ? `${formatDate(task.dueDate)} (${describeDue(task.dueDate)})` : "—",
      inline: true,
    },
  );
}
