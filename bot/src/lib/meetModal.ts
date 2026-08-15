import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

// Custom-id prefix the modal-submit handler (handleMeetForm) routes on.
// "meetform:new" creates a meeting; "meetform:edit:<meetingId>" updates one.
export const MEET_FORM_PREFIX = "meetform:";

interface MeetModalOptions {
  mode: "new" | "edit";
  meetingId?: string;
  title?: string;
  whenValue?: string; // pre-filled "when" text, e.g. "2026-07-24 15:00"
  room?: string | null;
  recurrence?: string;
  durationMinutes?: number;
}

// The /meet + /mdmeet form. Modals allow at most 5 components, so date + time
// are merged into one "When" field (chrono reads "next fri 3pm" happily).
export function buildMeetModal(opts: MeetModalOptions = { mode: "new" }): ModalBuilder {
  const recurrence = opts.recurrence ?? "once";

  const title = new LabelBuilder().setLabel("Title").setTextInputComponent(
    new TextInputBuilder()
      .setCustomId("title")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(opts.title ?? ""),
  );

  const when = new LabelBuilder().setLabel("When (date and time)").setTextInputComponent(
    new TextInputBuilder()
      .setCustomId("when")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("e.g. next fri 3pm, tomorrow 14:00, 2026-08-01 15:00")
      .setValue(opts.whenValue ?? ""),
  );

  const room = new LabelBuilder().setLabel("Room / location").setTextInputComponent(
    new TextInputBuilder()
      .setCustomId("room")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("e.g. EDT-101 (optional)")
      .setValue(opts.room ?? ""),
  );

  const repeats = new LabelBuilder().setLabel("Repeats").setStringSelectMenuComponent(
    new StringSelectMenuBuilder()
      .setCustomId("recurrence")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        { label: "One-time", value: "once", default: recurrence === "once" },
        { label: "Weekly", value: "weekly", default: recurrence === "weekly" },
        { label: "Biweekly", value: "biweekly", default: recurrence === "biweekly" },
      ),
  );

  const duration = new LabelBuilder().setLabel("Duration in minutes").setTextInputComponent(
    new TextInputBuilder()
      .setCustomId("duration")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("default 60")
      .setValue(opts.durationMinutes ? String(opts.durationMinutes) : ""),
  );

  const customId =
    opts.mode === "new"
      ? `${MEET_FORM_PREFIX}new`
      : `${MEET_FORM_PREFIX}edit:${opts.meetingId}`;

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(opts.mode === "new" ? "New meeting" : "Edit meeting")
    .addLabelComponents(title, when, room, repeats, duration);
}
