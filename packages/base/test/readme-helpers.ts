import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = resolve(TEST_DIR, "..");

export interface FixtureBlock {
  raw: string | null;
  missing: boolean;
}

export interface FixtureFile {
  id: string;
  repo: string;
  repoPath: string;
  lang: "zh" | "en";
  order: string[];
  suspicious: unknown[];
  blocks: Record<"contact" | "star-history" | "thanks" | "more", FixtureBlock>;
}

interface FixtureDoc {
  meta: unknown;
  files: FixtureFile[];
}

let cached: FixtureDoc | undefined;

/** The extracted pre-migration README blocks (ticket 07 fixture). */
export function fixtureDoc(): FixtureDoc {
  cached ??= JSON.parse(
    readFileSync(join(TEST_DIR, "fixtures", "readme-blocks.json"), "utf8"),
  ) as FixtureDoc;
  return cached;
}

export function fixtureFile(id: string): FixtureFile {
  const file = fixtureDoc().files.find((candidate) => candidate.id === id);
  if (file === undefined) throw new Error("fixture file not found: " + id);
  return file;
}

/** Raw legacy contact block of one fixture README. */
export function fixtureContactRaw(id: string): string {
  const raw = fixtureFile(id).blocks.contact.raw;
  if (raw === null) throw new Error("fixture has no contact block: " + id);
  return raw;
}

/** Default CDN base used by the renderers. */
export const CDN_BASE = "https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base";

/** Precise-version CDN URL for one published card file. */
export function cardUrl(card: string, version = "0.0.1"): string {
  return CDN_BASE + "@" + version + "/data/img/" + card;
}

/**
 * Rewrite legacy relative card sources in a fixture contact block to the
 * precise CDN URLs the migration intentionally switches to. Every replacement
 * is a hand-written literal, so the fixture stays an independent reference
 * for the compared heading/table/title/alt/width content.
 */
export function expectMigratedContactSources(raw: string): string {
  return raw
    .replace(/src="[^"]*contact-feishu-permanent\.png"/g, 'src="' + cardUrl("card-feishu.png") + '"')
    .replace(/src="[^"]*contact-qq-permanent\.(?:png|jpg)"/g, 'src="' + cardUrl("card-qq.png") + '"')
    .replace(
      /src="[^"]*contact-wechat-weekly\.png"/g,
      'src="' + cardUrl("card-wechat-2026-10-23.png") + '?v=20261023"',
    );
}

/** Create a throwaway directory that is removed by the returned cleanup. */
export function makeTempDir(prefix = "dsh-base-readme-"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
