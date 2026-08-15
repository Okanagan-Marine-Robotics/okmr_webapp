// Display names and subtabs for everything that lands in the Ticket table.
// The first four mirror the bot's modal catalogue (bot/src/lib/forms.ts); "sop"
// and "emergency" come from /sop and /911 instead, which is why they have no
// entry there. Kept local since web and bot are separate workspaces — a type
// that isn't listed here still renders, just with its raw id tidied up.
export const FORM_TYPES = [
  { type: "edt_space", label: "EDT space" },
  { type: "vehicle", label: "Vehicle" },
  { type: "part", label: "Part order" },
  { type: "machine_shop", label: "Machine shop" },
  { type: "sop", label: "SOP" },
  { type: "emergency", label: "Emergency" },
];

export function typeLabel(type: string) {
  return FORM_TYPES.find((t) => t.type === type)?.label ?? type.replace(/_/g, " ");
}

// Seen-table key for a form type. Tasks and Calendar key off forum groups
// instead — see forums.ts — so they have no bare tab-level key either.
export const formSeenKey = (type: string) => `forms:${type}`;
