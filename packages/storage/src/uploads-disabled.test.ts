import assert from "node:assert/strict";
import { stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  getUpload,
  putUpload,
  UploadsDisabledError,
  uploadsAreDisabled,
} from "./index.ts";

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for("__cloudflare-context__");
const uploadDir = join(dirname(fileURLToPath(import.meta.url)), "../../../web/uploads");

test("Node storage still uses disk and does not require R2", async () => {
  assert.equal(uploadsAreDisabled(), false);
  const storedName = `quota-test-${crypto.randomUUID()}.txt`;
  const bytes = new TextEncoder().encode("local-only");
  const filePath = join(uploadDir, storedName);
  try {
    await putUpload(storedName, bytes, "text/plain");
    const info = await stat(filePath);
    assert.equal(info.isFile(), true);
    const saved = await getUpload(storedName);
    assert.ok(saved);
    assert.equal(saved.size, bytes.byteLength);
    const chunk = await saved.body.getReader().read();
    assert.equal(new TextDecoder().decode(chunk.value), "local-only");
  } finally {
    await unlink(filePath).catch(() => {});
  }
});

test("Cloudflare runtime fails closed and does not touch disk or R2", async () => {
  const globalRecord = globalThis as unknown as Record<symbol, unknown>;
  const previous = globalRecord[CLOUDFLARE_CONTEXT_SYMBOL];
  const bucketCalls = { put: 0, get: 0 };
  globalRecord[CLOUDFLARE_CONTEXT_SYMBOL] = {
    env: {
      UPLOADS_BUCKET: {
        put() {
          bucketCalls.put += 1;
        },
        get() {
          bucketCalls.get += 1;
        },
      },
    },
  };
  const storedName = `hosted-${crypto.randomUUID()}.txt`;
  const filePath = join(uploadDir, storedName);

  try {
    assert.equal(uploadsAreDisabled(), true);
    await assert.rejects(
      () => putUpload(storedName, new TextEncoder().encode("nope"), "text/plain"),
      (error: unknown) => error instanceof UploadsDisabledError,
    );
    assert.equal(await getUpload(storedName), null);
    assert.equal(bucketCalls.put, 0);
    assert.equal(bucketCalls.get, 0);
    await assert.rejects(() => stat(filePath));
  } finally {
    if (previous === undefined) {
      delete globalRecord[CLOUDFLARE_CONTEXT_SYMBOL];
    } else {
      globalRecord[CLOUDFLARE_CONTEXT_SYMBOL] = previous;
    }
  }

  assert.equal(uploadsAreDisabled(), false);
});
