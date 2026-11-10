#!/usr/bin/env node
// Fail closed before any Cloudflare deploy or remote migration.
// Confirms the web Worker stays on workers.dev and never claims okmrwebapp.ca
// or the unrelated okmarinerobotics-com Worker.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requireFlag = process.argv.includes("--require")
  ? process.argv[process.argv.indexOf("--require") + 1]
  : null;

const ACCOUNT_ID = "ac106c3c37d5d9077a632960175f4a52";
const D1_ID = "92805d40-9fe6-443e-89a4-ffafe0e0c209";
const FORBIDDEN_WORKER = "okmarinerobotics-com";
const FORBIDDEN_ZONES = ["okmrwebapp.ca", "okmarinerobotics.com"];

const configs = [
  {
    file: "web/wrangler.toml",
    name: "okmr-web",
    workersDev: true,
  },
  {
    file: "bot/wrangler.toml",
    name: "okmr-bot",
    workersDev: true,
  },
];

function stripComments(source) {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

function field(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]+)"?\\s*$`, "m"));
  return match ? match[1].trim() : null;
}

const failures = [];

for (const config of configs) {
  const path = resolve(root, config.file);
  const raw = readFileSync(path, "utf8");
  const source = stripComments(raw);

  const name = field(source, "name");
  const accountId = field(source, "account_id");
  const workersDev = field(source, "workers_dev");
  const previewUrls = field(source, "preview_urls");

  if (name !== config.name) {
    failures.push(`${config.file}: name must be ${config.name} (found ${name ?? "missing"})`);
  }
  if (name === FORBIDDEN_WORKER) {
    failures.push(`${config.file}: must not target ${FORBIDDEN_WORKER}`);
  }
  if (accountId !== ACCOUNT_ID) {
    failures.push(`${config.file}: account_id must be the OKMR account`);
  }
  if (workersDev !== String(config.workersDev)) {
    failures.push(`${config.file}: workers_dev must be ${config.workersDev}`);
  }
  if (previewUrls !== "false") {
    failures.push(`${config.file}: preview_urls must be false`);
  }
  if (!source.includes(`database_id = "${D1_ID}"`) || !source.includes('database_name = "okmr-db"')) {
    failures.push(`${config.file}: D1 binding must stay on the existing empty okmr-db`);
  }
  if (/^(routes|route|pattern|custom_domain|zone_id|zone_name)\s*=/m.test(source) || /^\[\[routes\]\]/m.test(source)) {
    failures.push(`${config.file}: routes and custom domains are not allowed`);
  }
  if (/\[\[r2_buckets\]\]|\br2_buckets\b|UPLOADS_BUCKET/.test(source)) {
    failures.push(`${config.file}: R2 bindings are not allowed`);
  }
  if (config.file === "web/wrangler.toml") {
    const observabilityBlocks = source.match(/\[observability(?:\.[a-z]+)?\][\s\S]*?(?=\n\[|$)/g) ?? [];
    const webLogsOff =
      observabilityBlocks.length > 0 &&
      observabilityBlocks.every((block) => /enabled\s*=\s*false/.test(block) && !/enabled\s*=\s*true/.test(block));
    if (!webLogsOff) {
      failures.push(`${config.file}: persistent observability must stay disabled`);
    }
  }
  for (const zone of FORBIDDEN_ZONES) {
    if (source.includes(zone)) {
      failures.push(`${config.file}: ${zone} must not appear outside comments`);
    }
  }
}

if (rawIncludesForbiddenWorker()) {
  failures.push("a wrangler name targets the unrelated okmarinerobotics-com Worker");
}

function rawIncludesForbiddenWorker() {
  return configs.some((config) => {
    const source = stripComments(readFileSync(resolve(root, config.file), "utf8"));
    return field(source, "name") === FORBIDDEN_WORKER;
  });
}

if (requireFlag) {
  if (!/^[A-Z][A-Z0-9_]+$/.test(requireFlag)) {
    failures.push("--require must be an environment variable name");
  } else if (process.env[requireFlag] !== "1") {
    failures.push(
      `${requireFlag}=1 is required. This command publishes or migrates; it is not part of the prepare step.`,
    );
  }
}

if (failures.length > 0) {
  console.error("Cloudflare preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Cloudflare preflight passed.");
console.log("- Worker okmr-web on workers.dev only; preview URLs off; no routes");
console.log("- okmrwebapp.ca and okmarinerobotics.com are not attached");
console.log("- okmarinerobotics-com is not a target");
console.log("- D1 binding is the existing empty okmr-db; remote migrations stay gated");
console.log("- No R2 binding; hosted uploads fail closed");
console.log("- A workers.dev URL is public until Worker-scoped Access is enabled");
if (requireFlag) {
  console.log(`- Approval ${requireFlag}=1 is set`);
}
