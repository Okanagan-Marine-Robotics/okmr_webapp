import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "discord.js";
import { DEFAULT_IMPORTANCE, IMPORTANCE_LEVELS } from "./importance.js";
import { formatDate } from "./date.js";

// Custom-id prefix so index.ts can route form submissions to handleTaskForm.
// "taskform:new" creates a task; "taskform:edit:<taskId>" updates one.
export const TASK_FORM_PREFIX = "taskform:";

interface TaskModalOptions {
  mode: "new" | "edit";
  taskId?: string;
  title?: string;
  dueDate?: Date | null;
  notes?: string | null;
  importance?: string;
  // Discord user ids to pre-select in the assignee picker (the creator on "new",
  // the current assignees on "edit"). A task can have several.
  defaultAssigneeDiscordIds?: string[];
}

// Build the one task form used for both creating and editing. Modals allow at
// most 5 components, and we use exactly 5: title, assignee, importance, due, notes.
export function buildTaskModal(opts: TaskModalOptions): ModalBuilder {
  const importance = opts.importance ?? DEFAULT_IMPORTANCE;

  const titleField = new LabelBuilder().setLabel("Title").setTextInputComponent(
    new TextInputBuilder()
      .setCustomId("title")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(opts.title ?? ""),
  );

  const assigneePicker = new UserSelectMenuBuilder()
    .setCustomId("assignee")
    .setRequired(false) // optional: modal fields are required by default, and a
    .setMinValues(0) // required component may not have min_values 0
    .setMaxValues(10);
  if (opts.defaultAssigneeDiscordIds && opts.defaultAssigneeDiscordIds.length > 0) {
    assigneePicker.setDefaultUsers(opts.defaultAssigneeDiscordIds);
  }
  const assigneeField = new LabelBuilder()
    .setLabel("Assign to")
    .setDescription("Pick one or more people, or leave empty")
    .setUserSelectMenuComponent(assigneePicker);

  const importanceField = new LabelBuilder().setLabel("Importance").setStringSelectMenuComponent(
    new StringSelectMenuBuilder()
      .setCustomId("importance")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        IMPORTANCE_LEVELS.map((l) => ({
          label: l.label,
          value: l.value,
          emoji: l.emoji,
          default: l.value === importance,
        })),
      ),
  );

  const dueField = new LabelBuilder().setLabel("Due date (blank for none)").setTextInputComponent(
    new TextInputBuilder()
      .setCustomId("due")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("e.g. tomorrow, next fri, aug 1, in 2 weeks, 2026-08-01")
      .setValue(opts.dueDate ? formatDate(opts.dueDate) : ""),
  );

  const notesField = new LabelBuilder().setLabel("Notes").setTextInputComponent(
    new TextInputBuilder()
      .setCustomId("notes")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setValue(opts.notes ?? ""),
  );

  const customId =
    opts.mode === "new"
      ? `${TASK_FORM_PREFIX}new`
      : `${TASK_FORM_PREFIX}edit:${opts.taskId}`;

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(opts.mode === "new" ? "New task" : "Edit task")
    .addLabelComponents(titleField, assigneeField, importanceField, dueField, notesField);
}
