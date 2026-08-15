import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SOPs are plain .txt files the club edits directly — no database, no admin UI.
// Paths are resolved from this file's own location rather than process.cwd(),
// because the bot gets run from both the repo root and bot/.
const here = dirname(fileURLToPath(import.meta.url)); // bot/src/lib
export const SOP_DIR = resolve(here, "../../../web/sops");
export const EMERGENCY_FILE = resolve(here, "../../../web/emergency.txt");

// A SOP name becomes a filename, so it must not be able to escape SOP_DIR.
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

// "sub_closure" -> "Sub Closure"
export function sopTitle(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function listSops(): Promise<string[]> {
  try {
    const files = await readdir(SOP_DIR);
    return files
      .filter((f) => f.toLowerCase().endsWith(".txt"))
      .map((f) => f.slice(0, -4))
      .filter((name) => SAFE_NAME.test(name))
      .sort();
  } catch {
    // Folder missing is a normal "none yet" state, not an error.
    return [];
  }
}

export async function readSop(name: string): Promise<string | null> {
  if (!SAFE_NAME.test(name)) return null;
  try {
    return await readFile(join(SOP_DIR, `${name}.txt`), "utf8");
  } catch {
    return null;
  }
}

export async function readEmergencyInfo(): Promise<string | null> {
  try {
    return await readFile(EMERGENCY_FILE, "utf8");
  } catch {
    return null;
  }
}
