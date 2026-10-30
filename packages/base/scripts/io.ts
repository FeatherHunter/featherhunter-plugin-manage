/**
 * Small filesystem helpers shared by the data build and the contact update
 * command. Both run from the maintainer checkout (never from the published
 * package), so they may assume the repo layout.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Read and parse a JSON file, naming the file in every failure. */
export function readJsonFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${path}: ${(error as Error).message}`);
  }
}

/** Walk up from `start` until a directory that contains contact/groups.json. */
export function findRepoRoot(start: string = process.cwd()): string {
  let current = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "contact", "groups.json"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`cannot find repo root (a directory with contact/groups.json) from ${resolve(start)}`);
}

/** Path relative to `from`, always with forward slashes (stable in output). */
export function relativePosix(from: string, to: string): string {
  return relative(from, to).split("\\").join("/");
}
