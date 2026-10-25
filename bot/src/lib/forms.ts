import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  FORMS,
  findForm,
  type FormDef,
  type FormField,
} from "@okmr_webapp/shared/forms";

export { FORMS, findForm, type FormDef, type FormField };

// Custom-id prefix the modal-submit handler (handleFormSubmit) routes on:
// "form:<type>", where <type> is also the Ticket.type stored in the database.
export const FORM_PREFIX = "form:";

export function buildFormModal(def: FormDef): ModalBuilder {
  const components = def.fields.map((field) => {
    const label = new LabelBuilder().setLabel(field.label);

    if (field.kind === "select") {
      const required = field.required ?? false;
      return label.setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(field.id)
          // In-modal selects are required by default; an optional one must say
          // so explicitly or Discord rejects min_values:0.
          .setRequired(required)
          .setMinValues(required ? 1 : 0)
          .setMaxValues(1)
          .addOptions(field.options),
      );
    }

    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setStyle(
        field.kind === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short,
      )
      .setRequired(field.required ?? false);
    if (field.placeholder) input.setPlaceholder(field.placeholder);

    return label.setTextInputComponent(input);
  });

  return new ModalBuilder()
    .setCustomId(`${FORM_PREFIX}${def.type}`)
    .setTitle(def.title)
    .addLabelComponents(...components);
}
