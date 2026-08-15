import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment } from "discord.js";

// Files live under web/uploads and are served by the web app at /uploads/<name>.
// Resolved from this file's location because the bot runs from both the repo
// root and bot/.
const here = dirname(fileURLToPath(import.meta.url)); // bot/src/lib
export const UPLOAD_DIR = resolve(here, "../../../web/uploads");

// Discord's own limit is 25 MB on an unboosted server; cap here too so a big
// file can't fill the Pi's disk.
const MAX_BYTES = 25 * 1024 * 1024;

export interface StoredFile {
  storedName: string;
  originalName: string;
  contentType: string | null;
}

// A stored name is "<uuid><.ext>", so the extension is the only part derived
// from user input — sanitise it hard since it becomes a filename and a URL.
function safeExtension(name: string): string {
  const ext = extname(name).slice(1).toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext ? `.${ext.slice(0, 8)}` : "";
}

// Download one Discord attachment to disk. Returns null (rather than throwing)
// so one bad file doesn't sink a whole /progupdate.
export async function storeAttachment(attachment: Attachment): Promise<StoredFile | null> {
  if (attachment.size > MAX_BYTES) return null;

  try {
    const res = await fetch(attachment.url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) return null;

    await mkdir(UPLOAD_DIR, { recursive: true });
    const storedName = `${randomUUID()}${safeExtension(attachment.name)}`;
    await writeFile(resolve(UPLOAD_DIR, storedName), buffer);

    return {
      storedName,
      originalName: attachment.name.slice(0, 200),
      contentType: attachment.contentType ?? null,
    };
  } catch (error) {
    console.warn(`Couldn't store attachment ${attachment.name}:`, error);
    return null;
  }
}
