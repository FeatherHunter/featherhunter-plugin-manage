import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = resolve(TEST_DIR, "..");

/** Version of the package under test; every CDN URL the renderers emit carries it. */
export const PKG_VERSION = (
  JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { version: string }
).version;

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

/** Raw legacy author-plugins (MORE) block of one fixture README. */
export function fixtureMoreRaw(id: string): string {
  const raw = fixtureFile(id).blocks.more.raw;
  if (raw === null) throw new Error("fixture has no more block: " + id);
  return raw;
}

/** Default CDN base used by the renderers. */
export const CDN_BASE = "https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base";

/** Precise-version CDN URL for one published card file. */
export function cardUrl(card: string, version = PKG_VERSION): string {
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
      'src="' + cardUrl("card-wechat-2026-11-08.png") + '?v=20261108"',
    );
}

/** Raw legacy star-history block of one fixture README. */
export function fixtureStarRaw(id: string): string {
  const raw = fixtureFile(id).blocks["star-history"].raw;
  if (raw === null) throw new Error("fixture has no star-history block: " + id);
  return raw;
}

/** Raw legacy thanks block of one fixture README (markers included). */
export function fixtureThanksRaw(id: string): string {
  const raw = fixtureFile(id).blocks.thanks.raw;
  if (raw === null) throw new Error("fixture has no thanks block: " + id);
  return raw;
}

/** The five thanks data files copied read-only from the repositories. */
export type ThanksDataset = "deck" | "palette" | "im" | "prompt" | "ilife";

/** Repository of each thanks dataset (the generator hardcodes owner/repo). */
export const THANKS_REPO: Record<ThanksDataset, string> = {
  deck: "FeatherHunter/dsh-mattpocock-skills-deck",
  palette: "FeatherHunter/dsh-opencode-palette",
  im: "FeatherHunter/dsh-im-companion",
  prompt: "FeatherHunter/dsh-prompt",
  ilife: "FeatherHunter/ilife",
};

const THANKS_DATASET_OF: Record<string, ThanksDataset> = {
  deck: "deck",
  "deck-pkg": "deck",
  "deck-en": "deck",
  palette: "palette",
  "palette-pkg": "palette",
  "palette-en": "palette",
  im: "im",
  "im-en": "im",
  prompt: "prompt",
  "prompt-en": "prompt",
  ilife: "ilife",
};

/** Fixture README id -> thanks dataset. */
export function thanksDatasetOf(fixtureId: string): ThanksDataset {
  const dataset = THANKS_DATASET_OF[fixtureId];
  if (dataset === undefined) throw new Error("no thanks dataset for fixture: " + fixtureId);
  return dataset;
}

/** Load the copied docs/thanks-data.json of one repository. */
export function loadThanksData(dataset: ThanksDataset, repo = THANKS_REPO[dataset]): {
  repo: string;
  authors: Record<string, Record<string, unknown>>;
} {
  const doc = JSON.parse(
    readFileSync(join(TEST_DIR, "fixtures", "thanks-data", dataset + ".json"), "utf8"),
  ) as { authors: Record<string, Record<string, unknown>> };
  return { repo, authors: doc.authors };
}

/** Star-history data of one fixture README, reproducing the pre-migration shape. */
export function starDataOf(fixtureId: string, version = "202610310130"): {
  repo: string;
  version: string;
  branch?: string;
  pageUrl?: string;
  width?: number;
  note?: string;
  alt?: string;
  darkPath?: string;
  lightPath?: string;
  markdownImage?: boolean;
} {
  const single = { darkPath: "docs/star-history.svg", lightPath: "docs/star-history.svg" };
  switch (fixtureId) {
    case "deck":
    case "deck-pkg":
    case "deck-en":
      return {
        repo: "FeatherHunter/dsh-mattpocock-skills-deck",
        version,
        pageUrl: "https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html",
        alt: "Star History Chart",
      };
    case "im":
      return {
        repo: "FeatherHunter/dsh-im-companion",
        version,
        branch: "master",
        width: 720,
        alt: "Star History Chart",
        note: "左轴读总星标（Total Stars），右轴读每日新增（Daily New），每天自动更新。",
      };
    case "im-en":
      return {
        repo: "FeatherHunter/dsh-im-companion",
        version,
        branch: "master",
        width: 720,
        alt: "Star History Chart",
        note: "Left axis reads Total Stars, right axis reads Daily New. Refreshed every day.",
      };
    case "palette":
      return {
        repo: "FeatherHunter/dsh-opencode-palette",
        version,
        alt: "星标增长曲线：左轴累计星标、右轴每日新增",
        ...single,
        markdownImage: true,
      };
    case "palette-pkg":
    case "palette-en":
      return {
        repo: "FeatherHunter/dsh-opencode-palette",
        version,
        alt: "Star history chart: total stars on the left axis, daily new stars on the right axis",
        ...single,
        markdownImage: true,
      };
    case "prompt":
      return {
        repo: "FeatherHunter/dsh-prompt",
        version,
        alt: "星标增长曲线（双轴）：左轴累计星标，右轴每日新增",
        ...single,
        markdownImage: true,
      };
    case "prompt-en":
      return {
        repo: "FeatherHunter/dsh-prompt",
        version,
        alt: "Star history chart (dual axis): total stars on the left, daily new stars on the right",
        ...single,
        markdownImage: true,
      };
    case "ilife":
      return { repo: "FeatherHunter/ilife", version, alt: "Star History Chart" };
    default:
      throw new Error("no star data for fixture: " + fixtureId);
  }
}

/** Create a throwaway directory that is removed by the returned cleanup. */
export function makeTempDir(prefix = "dsh-base-readme-"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
