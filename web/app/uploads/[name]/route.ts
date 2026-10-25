import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUpload,
  SAFE_INLINE_CONTENT_TYPES,
  SAFE_UPLOAD_NAME,
} from "@okmr_webapp/storage";

// Serves dev-journal attachments uploaded by the bot via `@okmr_webapp/storage`
// (streams from Cloudflare R2 in production, or `web/uploads` in local dev).
// Fenced strictly to authenticated OKMR Discord members and sandboxed against XSS.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { name } = await params;
  if (!SAFE_UPLOAD_NAME.test(name)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const uploaded = await getUpload(name);
  if (!uploaded) {
    return new NextResponse("Not found", { status: 404 });
  }

  const allowInline = SAFE_INLINE_CONTENT_TYPES.has(uploaded.contentType);
  const contentType = allowInline ? uploaded.contentType : "application/octet-stream";
  const disposition = allowInline
    ? `inline; filename="${name}"`
    : `attachment; filename="${name}"`;

  return new NextResponse(uploaded.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(uploaded.size),
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
