import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest } from "../core";
import type { I18nText, Lang, Manifest } from "../core/types";
import type { ReadmeTargetOptions } from "./readme-sync";
import type { StarHistoryData, ThanksAuthor, ThanksData } from "./types";

/**
 * Static description of one README managed by `readme:init` / `readme:sync --all`.
 *
 * The table is the single source of truth for the multi-repository workflow:
 * the CLI expands it into concrete targets, and the release pipeline imports it
 * to know which READMEs to sync. Everything a renderer needs that cannot be
 * detected from the README itself (repository full name, default branch,
 * per-repository star-chart shape, thanks data file) lives here.
 */
export interface ReadmeTarget {
  /** Directory name of the repository under the repositories parent directory. */
  repo: string;
  /** README path relative to the repository root. */
  readme: string;
  /** Primary language of that README. */
  lang: Lang;
  /** Plugin id of the repository; the MORE block excludes it. */
  selfId: string;
  /** Star-history chart of the repository. */
  star: {
    /** GitHub "owner/repo" that publishes the chart assets. */
    repo: string;
    /** Branch that publishes the chart assets; defaults to `main`. */
    branch?: string;
    /** Dark-mode chart path; defaults to `docs/star-history-dark.svg`. */
    darkPath?: string;
    /** Light-mode chart path; defaults to `docs/star-history-light.svg`. */
    lightPath?: string;
    /** Optional link to a standalone chart page. */
    pageUrl?: string;
    /** Optional rendered image width. */
    width?: number;
    /** Image alt text. */
    alt: I18nText;
    /** Optional caption note under the chart. */
    note?: I18nText;
  };
  /** Repository-relative thanks data file; defaults to `docs/thanks-data.json`. */
  thanksDataFile?: string;
}

/** Package name, duplicated here so the CLI and release script agree. */
export const PACKAGE_NAME = "dsh-featherhunter-plugin-base";

/** GitHub owner of the five plugin repositories. */
const OWNER = "FeatherHunter";

/** Thanks table data file kept by every plugin repository. */
const THANKS_DATA_FILE = "docs/thanks-data.json";

/**
 * The eleven READMEs of the five plugin repositories.
 *
 * Order follows the release pipeline (deck, palette, im, prompt, ilife) and the
 * same order inside each repository (root README, package README, English docs).
 */
export const README_TARGETS: readonly ReadmeTarget[] = [
  {
    repo: "dsh-mattpocock-skills-deck",
    readme: "README.md",
    lang: "zh",
    selfId: "deck",
    star: {
      repo: OWNER + "/dsh-mattpocock-skills-deck",
      pageUrl: "https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html",
      alt: { zh: "Star History Chart", en: "Star History Chart" },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-mattpocock-skills-deck",
    readme: "package/README.md",
    lang: "zh",
    selfId: "deck",
    star: {
      repo: OWNER + "/dsh-mattpocock-skills-deck",
      pageUrl: "https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html",
      alt: { zh: "Star History Chart", en: "Star History Chart" },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-mattpocock-skills-deck",
    readme: "docs/README.en.md",
    lang: "en",
    selfId: "deck",
    star: {
      repo: OWNER + "/dsh-mattpocock-skills-deck",
      pageUrl: "https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html",
      alt: { zh: "Star History Chart", en: "Star History Chart" },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-opencode-palette",
    readme: "README.md",
    lang: "zh",
    selfId: "palette",
    star: {
      repo: OWNER + "/dsh-opencode-palette",
      darkPath: "docs/star-history.svg",
      lightPath: "docs/star-history.svg",
      alt: {
        zh: "星标增长曲线：左轴累计星标、右轴每日新增",
        en: "Star history chart: total stars on the left axis, daily new stars on the right axis",
      },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-opencode-palette",
    readme: "package/README.md",
    lang: "en",
    selfId: "palette",
    star: {
      repo: OWNER + "/dsh-opencode-palette",
      darkPath: "docs/star-history.svg",
      lightPath: "docs/star-history.svg",
      alt: {
        zh: "星标增长曲线：左轴累计星标、右轴每日新增",
        en: "Star history chart: total stars on the left axis, daily new stars on the right axis",
      },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-opencode-palette",
    readme: "docs/README.en.md",
    lang: "en",
    selfId: "palette",
    star: {
      repo: OWNER + "/dsh-opencode-palette",
      darkPath: "docs/star-history.svg",
      lightPath: "docs/star-history.svg",
      alt: {
        zh: "星标增长曲线：左轴累计星标、右轴每日新增",
        en: "Star history chart: total stars on the left axis, daily new stars on the right axis",
      },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-im-companion",
    readme: "README.md",
    lang: "zh",
    selfId: "im",
    star: {
      repo: OWNER + "/dsh-im-companion",
      branch: "master",
      width: 720,
      alt: { zh: "Star History Chart", en: "Star History Chart" },
      note: {
        zh: "左轴读总星标（Total Stars），右轴读每日新增（Daily New），每天自动更新。",
        en: "Left axis reads Total Stars, right axis reads Daily New. Refreshed every day.",
      },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-im-companion",
    readme: "docs/README.en.md",
    lang: "en",
    selfId: "im",
    star: {
      repo: OWNER + "/dsh-im-companion",
      branch: "master",
      width: 720,
      alt: { zh: "Star History Chart", en: "Star History Chart" },
      note: {
        zh: "左轴读总星标（Total Stars），右轴读每日新增（Daily New），每天自动更新。",
        en: "Left axis reads Total Stars, right axis reads Daily New. Refreshed every day.",
      },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-prompt",
    readme: "README.md",
    lang: "zh",
    selfId: "prompt",
    star: {
      repo: OWNER + "/dsh-prompt",
      darkPath: "docs/star-history.svg",
      lightPath: "docs/star-history.svg",
      alt: {
        zh: "星标增长曲线（双轴）：左轴累计星标，右轴每日新增",
        en: "Star history chart (dual axis): total stars on the left, daily new stars on the right",
      },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "dsh-prompt",
    readme: "docs/README.en.md",
    lang: "en",
    selfId: "prompt",
    star: {
      repo: OWNER + "/dsh-prompt",
      darkPath: "docs/star-history.svg",
      lightPath: "docs/star-history.svg",
      alt: {
        zh: "星标增长曲线（双轴）：左轴累计星标，右轴每日新增",
        en: "Star history chart (dual axis): total stars on the left, daily new stars on the right",
      },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
  {
    repo: "ilife",
    readme: "README.md",
    lang: "zh",
    selfId: "ilife",
    star: {
      repo: OWNER + "/ilife",
      branch: "master",
      alt: { zh: "Star History Chart", en: "Star History Chart" },
    },
    thanksDataFile: THANKS_DATA_FILE,
  },
];

/** One target resolved against a concrete repositories parent directory. */
export interface ResolvedReadmeTarget extends ReadmeTargetOptions {
  /** Repository directory name (also the key used by the CLI report). */
  repo: string;
  /** README path relative to the repository root. */
  readme: string;
}

/** Pick the localized text of an `I18nText` value. */
function pickText(text: I18nText, lang: Lang): string {
  return text[lang] ?? text.zh;
}

/** Path of the packaged manifest, relative to this module (dist or src). */
function packagedManifestPath(): string {
  return fileURLToPath(new URL("../../data/manifest.json", import.meta.url));
}

/** Read and validate the packaged `data/manifest.json`. */
export function readPackagedManifest(): Manifest {
  const path = packagedManifestPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error("cannot read the packaged manifest at " + path + ": " + (error as Error).message);
  }
  return parseManifest(JSON.parse(raw));
}

/** Read the packaged `package.json` version. */
export function readPackageVersion(): string {
  try {
    const url = new URL("../../package.json", import.meta.url);
    const parsed = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Turn an ISO timestamp into a minute-level `YYYYMMDDHHmm` query string. */
export function starVersionFromTimestamp(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (match === null) {
    throw new Error('cannot derive a star-history version from "' + iso + '"');
  }
  return match[1]! + match[2]! + match[3]! + match[4]! + match[5]!;
}

/**
 * Detect the chart version already used by a README.
 *
 * Repositories migrate from an 8-digit `?v=YYYYMMDD` query to the 12-digit
 * `?v=YYYYMMDDHHmm` form; an 8-digit value is padded with `0000` so the
 * existing chart keeps its date instead of jumping to the manifest timestamp.
 */
export function detectStarVersion(markdown: string): string | undefined {
  const matches = [...markdown.matchAll(/[?&]v=(\d{8}|\d{12})(?![0-9])/g)].map((match) => match[1]!);
  const minute = matches.find((value) => value.length === 12);
  if (minute !== undefined) return minute;
  const day = matches.find((value) => value.length === 8);
  return day === undefined ? undefined : day + "0000";
}

/** Build the star-history data of one target, falling back to the manifest timestamp. */
export function buildStarHistoryData(
  target: ReadmeTarget,
  markdown: string | undefined,
  manifest: Manifest,
): StarHistoryData {
  const version = (markdown === undefined ? undefined : detectStarVersion(markdown)) ?? starVersionFromTimestamp(manifest.updatedAt);
  const data: StarHistoryData = {
    repo: target.star.repo,
    version,
    alt: pickText(target.star.alt, target.lang),
  };
  if (target.star.branch !== undefined) data.branch = target.star.branch;
  if (target.star.darkPath !== undefined) data.darkPath = target.star.darkPath;
  if (target.star.lightPath !== undefined) data.lightPath = target.star.lightPath;
  if (target.star.pageUrl !== undefined) data.pageUrl = target.star.pageUrl;
  if (target.star.width !== undefined) data.width = target.star.width;
  if (target.star.note !== undefined) data.note = pickText(target.star.note, target.lang);
  return data;
}

/**
 * Load one repository's thanks data.
 *
 * The file is written by the repository's own generator and has no `repo`
 * field; the GitHub repository name comes from the target table. A missing file
 * means the repository has not enabled the thanks table yet: the block is
 * skipped instead of failing the whole run.
 */
export function loadThanksData(
  repoRoot: string,
  target: Pick<ReadmeTarget, "repo" | "thanksDataFile">,
  repoName?: string,
): ThanksData | undefined {
  const relative = target.thanksDataFile ?? THANKS_DATA_FILE;
  const path = join(repoRoot, relative);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("cannot parse " + path + ": " + (error as Error).message);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(path + ": thanks data must be a JSON object");
  }
  const authors = (parsed as { authors?: unknown }).authors;
  if (typeof authors !== "object" || authors === null || Array.isArray(authors)) {
    throw new Error(path + ': thanks data needs an "authors" object');
  }
  return { repo: repoName ?? OWNER + "/" + target.repo, authors: authors as Record<string, ThanksAuthor> };
}

/** Resolve one target table entry against a concrete repository root. */
function resolveTarget(root: string, target: ReadmeTarget, manifest: Manifest): ResolvedReadmeTarget {
  const readmePath = join(root, target.readme);
  let markdown: string | undefined;
  try {
    markdown = readFileSync(readmePath, "utf8");
  } catch {
    markdown = undefined;
  }
  const resolved: ResolvedReadmeTarget = {
    repo: target.repo,
    root,
    readme: target.readme,
    lang: target.lang,
    selfId: target.selfId,
    starHistory: buildStarHistoryData(target, markdown, manifest),
    manifest,
  };
  const thanks = loadThanksData(root, target);
  if (thanks !== undefined) resolved.thanks = thanks;
  return resolved;
}

/** Resolve the target table against a repositories parent directory. */
export function resolveReadmeTargets(
  reposDir: string,
  options: { manifest?: Manifest; targets?: readonly ReadmeTarget[] } = {},
): ResolvedReadmeTarget[] {
  const manifest = options.manifest ?? readPackagedManifest();
  const targets = options.targets ?? README_TARGETS;
  return targets.map((target) => resolveTarget(join(reposDir, target.repo), target, manifest));
}

/** Directory names of the five managed repositories, in table order. */
export function readmeTargetRepos(): string[] {
  const repos: string[] = [];
  for (const target of README_TARGETS) {
    if (!repos.includes(target.repo)) repos.push(target.repo);
  }
  return repos;
}

/**
 * Resolve the targets of one repository directory (`doctor <repo-dir>`).
 *
 * The directory name must match one of the five managed repositories, so a
 * mistyped path fails loudly instead of silently checking nothing.
 */
export function resolveRepoReadmeTargets(
  repoRoot: string,
  options: { manifest?: Manifest } = {},
): ResolvedReadmeTarget[] {
  const repo = basename(resolve(repoRoot));
  const selected = README_TARGETS.filter((target) => target.repo === repo);
  if (selected.length === 0) {
    throw new Error(
      '"' + repoRoot + '" is not a managed repository directory; expected one of: ' + readmeTargetRepos().join(", "),
    );
  }
  const manifest = options.manifest ?? readPackagedManifest();
  return selected.map((target) => resolveTarget(repoRoot, target, manifest));
}

/** Expand one or more repositories parent directories into targets. */
export function expandReadmeTargets(
  reposDirs: readonly string[],
  options: { manifest?: Manifest } = {},
): ResolvedReadmeTarget[] {
  const seen = new Set<string>();
  const expanded: ResolvedReadmeTarget[] = [];
  for (const dir of reposDirs) {
    for (const target of resolveReadmeTargets(dir, options)) {
      const key = target.root + "|" + target.readme;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push(target);
    }
  }
  return expanded;
}