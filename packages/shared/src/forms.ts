// Shared form definitions and ticket type labels used by both `bot` and `web`.

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

const FULL_NAME: FormField = {
  id: "fullName",
  label: "Your full name",
  kind: "short",
  required: true,
  placeholder: "First and last name",
};

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

export const FORM_TYPES: { type: string; label: string }[] = [
  ...FORMS.map((f) => ({ type: f.type, label: f.short })),
  { type: "sop", label: "SOP" },
  { type: "emergency", label: "Emergency" },
];

export function findForm(type: string): FormDef | undefined {
  return FORMS.find((f) => f.type === type);
}

export function typeLabel(type: string): string {
  return FORM_TYPES.find((t) => t.type === type)?.label ?? type.replace(/_/g, " ");
}

export function formSeenKey(type: string): string {
  return `forms:${type}`;
}
