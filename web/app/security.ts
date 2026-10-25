// Shared server-side input validation and redirect sanitization helpers.

// Ensure a redirect target is strictly an internal relative path on this origin
// (e.g. "/tasks?forum=abc"), blocking open redirects via "//evil.com",
// "https://evil.com", backslash-prefixed paths, or control characters.
export function safeInternalPath(
  target: string | null | undefined,
  fallback: string,
): string {
  if (!target || typeof target !== "string") return fallback;
  const trimmed = target.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function clampText(raw: FormDataEntryValue | null, maxLength: number): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, maxLength);
}

// Parse a YYYY-MM-DD HTML date input safely into local midnight, returning null
// on empty or malformed input so Prisma never receives an `Invalid Date`.
export function parseIsoDateInput(raw: FormDataEntryValue | null): Date | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
