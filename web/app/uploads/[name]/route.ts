import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ReadStream } from "node:fs";
import { NextResponse } from "next/server";

// Serves dev-journal attachments the bot downloaded into web/uploads. A route
// (rather than the public/ folder) keeps serving explicit and lets us validate
// the name, since it comes from the URL.
const UPLOAD_DIR = resolve(process.cwd(), "uploads");

// Stored names are "<uuid>.<ext>" — nothing else is allowed near the filesystem.
const SAFE_NAME = /^[a-zA-Z0-9-]+(\.[a-z0-9]{1,8})?$/;

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!SAFE_NAME.test(name)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const filePath = resolve(UPLOAD_DIR, name);
  // Defence in depth: never serve anything outside the uploads dir.
  if (!filePath.startsWith(`${UPLOAD_DIR}/`)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  const nodeStream = createReadStream(filePath);
  const body = nodeToWebStream(nodeStream);

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function nodeToWebStream(stream: ReadStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) =>
        controller.enqueue(new Uint8Array(chunk as Buffer)),
      );
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
}
