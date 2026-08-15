import type { CSSProperties } from "react";

// Shared look for the Tasks and Calendar add/edit forms.
export const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  fontSize: "0.85rem",
  color: "#444",
};

export const inputStyle: CSSProperties = {
  padding: "0.35rem 0.5rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  font: "inherit",
};
