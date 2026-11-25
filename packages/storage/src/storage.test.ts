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

test("Node storage uses disk", async () => {
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

function withCloudflareEnv(env: Record<string, unknown>, run: () => Promise<void>) {
  const globalRecord = globalThis as unknown as Record<symbol, unknown>;
  const previous = globalRecord[CLOUDFLARE_CONTEXT_SYMBOL];
  globalRecord[CLOUDFLARE_CONTEXT_SYMBOL] = { env };
  return run().finally(() => {
    if (previous === undefined) delete globalRecord[CLOUDFLARE_CONTEXT_SYMBOL];
    else globalRecord[CLOUDFLARE_CONTEXT_SYMBOL] = previous;
  });
}

test("Cloudflare runtime without UPLOADS_KV fails closed and does not touch disk", async () => {
  const storedName = `hosted-${crypto.randomUUID()}.txt`;
  await withCloudflareEnv({}, async () => {
    assert.equal(uploadsAreDisabled(), true);
    await assert.rejects(
      () => putUpload(storedName, new TextEncoder().encode("nope"), "text/plain"),
      (error: unknown) => error instanceof UploadsDisabledError,
    );
    assert.equal(await getUpload(storedName), null);
    await assert.rejects(() => stat(join(uploadDir, storedName)));
  });
  assert.equal(uploadsAreDisabled(), false);
});

test("Cloudflare runtime with UPLOADS_KV stores and serves uploads from KV", async () => {
  const store = new Map<string, { bytes: Uint8Array; metadata: unknown }>();
  const UPLOADS_KV = {
    async put(key: string, value: Uint8Array, options?: { metadata?: unknown }) {
      store.set(key, { bytes: value, metadata: options?.metadata });
    },
    async getWithMetadata(key: string) {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: new Blob([entry.bytes]).stream(), metadata: entry.metadata };
    },
  };
  const storedName = `kv-${crypto.randomUUID()}.png`;
  const bytes = new Uint8Array([137, 80, 78, 71]);

  await withCloudflareEnv({ UPLOADS_KV }, async () => {
    assert.equal(uploadsAreDisabled(), false);
    await putUpload(storedName, bytes, "image/png");
    await assert.rejects(() => stat(join(uploadDir, storedName)));

    const saved = await getUpload(storedName);
    assert.ok(saved);
    assert.equal(saved.size, 4);
    assert.equal(saved.contentType, "image/png");
    assert.deepEqual(new Uint8Array(await new Response(saved.body).arrayBuffer()), bytes);

    assert.equal(await getUpload(`missing-${crypto.randomUUID()}.png`), null);
    await assert.rejects(() => putUpload("../escape.png", bytes));
  });
});
