// Pluggable blob storage for DevLog attachments (/progupdate).
// Uses Cloudflare R2 (`env.UPLOADS_BUCKET`) when running on Cloudflare Pages
// or Workers, and falls back to `web/uploads/` on the local disk during
// standard local Node.js development.

export interface R2ObjectBodyLike {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly httpMetadata?: {
    contentType?: string;
  };
}

export interface R2BucketLike {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
    },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
}

export interface StoredUploadObject {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
}

export interface StorageAdapter {
  putUpload(
    storedName: string,
    bytes: Uint8Array,
    contentType?: string | null,
  ): Promise<void>;
  getUpload(storedName: string): Promise<StoredUploadObject | null>;
}

// Stored names are "<uuid>.<ext>" — nothing else is allowed.
export const SAFE_UPLOAD_NAME = /^[a-zA-Z0-9-]+(\.[a-z0-9]{1,8})?$/;

// Only non-scriptable raster image, PDF, and plain-text extensions get an
// inline MIME type; active/scriptable formats (.svg, .html, .xml, .js, etc.)
// always resolve to `application/octet-stream` to prevent Stored XSS.
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
};

export const SAFE_INLINE_CONTENT_TYPES = new Set<string>(Object.values(CONTENT_TYPES));

export function inferContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export function safeExtension(name: string): string {
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx <= 0) return "";
  const ext = name
    .slice(dotIdx + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return ext ? `.${ext.slice(0, 8)}` : "";
}

export class R2StorageAdapter implements StorageAdapter {
  private readonly bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.bucket = bucket;
  }

  async putUpload(
    storedName: string,
    bytes: Uint8Array,
    _contentType?: string | null,
  ): Promise<void> {
    if (!SAFE_UPLOAD_NAME.test(storedName)) {
      throw new Error(`Invalid upload name: ${storedName}`);
    }
    const resolvedType = inferContentType(storedName);
    await this.bucket.put(storedName, bytes, {
      httpMetadata: {
        contentType: resolvedType,
        cacheControl: "private, no-store",
      },
    });
  }

  async getUpload(storedName: string): Promise<StoredUploadObject | null> {
    if (!SAFE_UPLOAD_NAME.test(storedName)) return null;
    const obj = await this.bucket.get(storedName);
    if (!obj) return null;
    return {
      body: obj.body,
      size: obj.size,
      contentType: inferContentType(storedName),
    };
  }
}

export class LocalFsStorageAdapter implements StorageAdapter {
  private uploadDirPromise: Promise<string> | null = null;

  private async getUploadDir(): Promise<string> {
    if (!this.uploadDirPromise) {
      this.uploadDirPromise = (async () => {
        const [{ dirname, resolve }, { fileURLToPath }] = await Promise.all([
          import("node:path"),
          import("node:url"),
        ]);
        const here = dirname(fileURLToPath(import.meta.url)); // packages/storage/src
        return resolve(here, "../../../web/uploads");
      })();
    }
    return this.uploadDirPromise;
  }

  async putUpload(
    storedName: string,
    bytes: Uint8Array,
    _contentType?: string | null,
  ): Promise<void> {
    if (!SAFE_UPLOAD_NAME.test(storedName)) {
      throw new Error(`Invalid upload name: ${storedName}`);
    }
    const [{ mkdir, writeFile }, { resolve }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const uploadDir = await this.getUploadDir();
    await mkdir(uploadDir, { recursive: true });
    const filePath = resolve(uploadDir, storedName);
    if (!filePath.startsWith(`${uploadDir}/`)) {
      throw new Error("Upload path escaped upload directory");
    }
    await writeFile(filePath, bytes);
  }

  async getUpload(storedName: string): Promise<StoredUploadObject | null> {
    if (!SAFE_UPLOAD_NAME.test(storedName)) return null;
    const [{ stat, readFile }, { resolve }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const uploadDir = await this.getUploadDir();
    const filePath = resolve(uploadDir, storedName);
    if (!filePath.startsWith(`${uploadDir}/`)) return null;

    let size: number;
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return null;
      size = info.size;
    } catch {
      return null;
    }

    const buffer = await readFile(filePath);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    return {
      body,
      size,
      contentType: inferContentType(storedName),
    };
  }
}

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for("__cloudflare-context__");

const globalForStorage = globalThis as unknown as {
  __okmrR2Bucket?: R2BucketLike;
  __okmrStorageAdapter?: StorageAdapter;
  [CLOUDFLARE_CONTEXT_SYMBOL]?: {
    env?: {
      UPLOADS_BUCKET?: R2BucketLike;
      [key: string]: unknown;
    };
  };
};

export function setR2Bucket(bucket: R2BucketLike | undefined | null): void {
  if (bucket) {
    globalForStorage.__okmrR2Bucket = bucket;
    globalForStorage.__okmrStorageAdapter = new R2StorageAdapter(bucket);
  }
}

export function getStorageAdapter(): StorageAdapter {
  const cfContextBucket = globalForStorage[CLOUDFLARE_CONTEXT_SYMBOL]?.env?.UPLOADS_BUCKET;
  if (cfContextBucket) {
    setR2Bucket(cfContextBucket);
  }

  if (globalForStorage.__okmrStorageAdapter) {
    return globalForStorage.__okmrStorageAdapter;
  }
  if (globalForStorage.__okmrR2Bucket) {
    globalForStorage.__okmrStorageAdapter = new R2StorageAdapter(
      globalForStorage.__okmrR2Bucket,
    );
    return globalForStorage.__okmrStorageAdapter;
  }
  const local = new LocalFsStorageAdapter();
  globalForStorage.__okmrStorageAdapter = local;
  return local;
}

export async function putUpload(
  storedName: string,
  bytes: Uint8Array,
  contentType?: string | null,
): Promise<void> {
  return getStorageAdapter().putUpload(storedName, bytes, contentType);
}

export async function getUpload(
  storedName: string,
): Promise<StoredUploadObject | null> {
  return getStorageAdapter().getUpload(storedName);
}
