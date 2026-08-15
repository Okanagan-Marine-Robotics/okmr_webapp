import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

// Custom-id prefix the modal-submit handler (handleFormSubmit) routes on:
// "form:<type>", where <type> is also the Ticket.type stored in the database.
export const FORM_PREFIX = "form:";

// A field in a form. "when" is a plain short text input whose answer is
// additionally parsed as a date/time range, so the web view can sort by it.
export type FormField =
  | {
      id: string;
      label: string;
      kind: "short" | "paragraph" | "when";
      required?: boolean;
      placeholder?: string;
    }
  | {
      id: string;
      label: string;
      kind: "select";
      required?: boolean;
      options: { label: string; value: string }[];
    };

export interface FormDef {
  type: string; // Ticket.type, and the modal custom id
  label: string; // shown in the /form dropdown
  short: string; // compact name for list output and the web app
  title: string; // modal heading (Discord caps this at 45 chars)
  fields: FormField[];
}

// Shared first field: the Discord account is recorded automatically, but that's
// a username, not a real name — and these requests go to people outside the
// club who need to know who actually asked.
//
// Not on the part form: that one is already at the 5-component cap, and part
// orders are handled by the subteam lead rather than the requester.
const FULL_NAME: FormField = {
  id: "fullName",
  label: "Your full name",
  kind: "short",
  required: true,
  placeholder: "First and last name",
};

// The form catalogue. Adding a form here is all that's needed — the slash
// command's dropdown, the modal, and the web list are all driven off this.
//
// Discord modals allow at most 5 components, so no form may exceed 5 fields.
// That cap is also why a part order is submitted one part at a time.
export const FORMS: FormDef[] = [
  {
    type: "edt_space",
    label: "EDT — book building space",
    short: "EDT space",
    title: "Book EDT space",
    fields: [
      FULL_NAME,
      {
        id: "when",
        label: "When",
        kind: "when",
        required: true,
        placeholder: "e.g. fri 2pm-5pm, tomorrow 9am-noon",
      },
      {
        id: "purpose",
        label: "What do you need the space for?",
        kind: "short",
        required: true,
      },
      { id: "people", label: "How many people?", kind: "short" },
      { id: "notes", label: "Anything else?", kind: "paragraph" },
    ],
  },
  {
    type: "vehicle",
    label: "Vehicle — book a pickup",
    short: "Vehicle",
    title: "Book a vehicle",
    fields: [
      FULL_NAME,
      {
        id: "when",
        label: "When",
        kind: "when",
        required: true,
        placeholder: "e.g. sat 10am-1pm",
      },
      {
        id: "what",
        label: "What are you picking up?",
        kind: "short",
        required: true,
      },
      { id: "where", label: "Pickup location", kind: "short" },
      { id: "notes", label: "Anything else?", kind: "paragraph" },
    ],
  },
  {
    type: "part",
    label: "Part — request an order",
    short: "Part order",
    title: "Order a part",
    fields: [
      { id: "part", label: "Part name", kind: "short", required: true },
      {
        id: "link",
        label: "Link",
        kind: "short",
        required: true,
        placeholder: "https://...",
      },
      {
        id: "price",
        label: "Price",
        kind: "short",
        required: true,
        placeholder: "e.g. 24.99",
      },
      {
        id: "sourcer",
        label: "Where from?",
        kind: "short",
        required: true,
        placeholder: "e.g. Amazon, Mouser, DigiKey, McMaster-Carr",
      },
      { id: "quantity", label: "Quantity", kind: "short", placeholder: "default 1" },
    ],
  },
  {
    type: "machine_shop",
    label: "Machine shop — book time",
    short: "Machine shop",
    title: "Book machine-shop time",
    fields: [
      FULL_NAME,
      {
        id: "when",
        label: "When",
        kind: "when",
        required: true,
        placeholder: "e.g. mon 1pm-4pm",
      },
      {
        id: "what",
        label: "What are you making?",
        kind: "short",
        required: true,
      },
      { id: "notes", label: "Anything else?", kind: "paragraph" },
    ],
  },
];

export function findForm(type: string): FormDef | undefined {
  return FORMS.find((f) => f.type === type);
}

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
