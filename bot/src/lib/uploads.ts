import type { Attachment } from "discord.js";
import {
  inferContentType,
  putUpload,
  safeExtension,
  UploadsDisabledError,
  uploadsAreDisabled,
} from "@okmr_webapp/storage";

// Discord's own limit is 25 MB on an unboosted server; cap here too so a big
// file can't blow through Worker memory or storage limits.
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_DISCORD_CDN_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);

export interface StoredFile {
  storedName: string;
  originalName: string;
  contentType: string | null;
}

export type AttachmentLike = Pick<Attachment, "name" | "size" | "url" | "contentType">;

function isAllowedAttachmentUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" &&
      ALLOWED_DISCORD_CDN_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

async function readBoundedBytes(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declaredLen = res.headers.get("content-length");
  if (declaredLen !== null) {
    const parsedLen = Number(declaredLen);
    if (Number.isFinite(parsedLen) && parsedLen > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
  }

  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return null;
    return new Uint8Array(buf);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

// Download one Discord attachment and store it on local disk.
// The Cloudflare runtime has uploads disabled and throws UploadsDisabledError
// before any download. Other failures return null so one bad file does not
// sink a whole /progupdate.
export async function storeAttachment(
  attachment: AttachmentLike,
): Promise<StoredFile | null> {
  if (uploadsAreDisabled()) {
    throw new UploadsDisabledError();
  }
  if (attachment.size > MAX_BYTES || !isAllowedAttachmentUrl(attachment.url)) {
    return null;
  }

  try {
    const res = await fetch(attachment.url, { redirect: "error" });
    if (!res.ok) return null;
    const bytes = await readBoundedBytes(res, MAX_BYTES);
    if (!bytes) return null;

    const storedName = `${crypto.randomUUID()}${safeExtension(attachment.name)}`;
    const contentType = inferContentType(storedName);
    await putUpload(storedName, bytes, contentType);

    return {
      storedName,
      originalName: attachment.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200),
      contentType,
    };
  } catch (error) {
    console.warn(`Couldn't store attachment ${attachment.name}:`, error);
    return null;
  }
}
