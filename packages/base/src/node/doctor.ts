import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseManifest } from "../core";
import type { Manifest } from "../core/types";
import { updateReadme } from "./readme-sync";
import type { DoctorCheck, DoctorResult } from "./types";
import {
  PACKAGE_NAME,
  expandReadmeTargets,
  readPackagedManifest,
  missingStarChartAssets,
  readPackageVersion,
  resolveRepoReadmeTargets,
  type ResolvedReadmeTarget,
} from "./targets";

/** Per-request timeout of the remote manifest probe. */
export const DOCTOR_TIMEOUT_MS = 1500;

/** Copy verification older than this many days is reported as stale. */
export const MAX_COPY_AGE_DAYS = 90;

/** Version strings accepted from package.json / the remote manifest. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Where the doctor probes the published manifest, in client fallback order. */
const REMOTE_MANIFEST_URLS = [
  "https://unpkg.com/" + PACKAGE_NAME + "@latest/data/manifest.json",
  "https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@latest/data/manifest.json",
];

/** Options of one doctor run. */
export interface DoctorOptions {
  /** Parent directories of the plugin repositories; enables the per-repository checks. */
  reposDirs?: readonly string[];
  /** Repository roots to check (`doctor <repo-dir>`), resolved by directory name. */
  repoRoots?: readonly string[];
  /** Skip the network probe (recorded as a passing "skipped" check). */
  offline?: boolean;
  /** fetch implementation override (tests). */
  fetchImpl?: typeof fetch;
  /** Package version override (tests); defaults to the packaged package.json. */
  packageVersion?: string;
  /** Packaged manifest override (tests); defaults to data/manifest.json. */
  manifest?: Manifest;
  /** Clock override for the copy-freshness check. */
  now?: Date;
  /** Remote probe timeout override. */
  timeoutMs?: number;
}

/** Directories never scanned for an inlined client bundle. */
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "docs",
  "data",
  "assets",
  "test",
  "tests",
]);

/** Source extensions that may contain an inlined client bundle. */
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".html"]);

/** The banner esbuild prepends to the built client / node entries. */
const INLINE_BANNER = /\/\*! dsh-featherhunter-plugin-base v([0-9A-Za-z.-]+) \*\//g;

/** Precise-version CDN image URLs used by the README contact block. */
const README_IMAGE_VERSION = /dsh-featherhunter-plugin-base@([^/"'\s)]+)\/data\/img\//g;

/** A mounted README sync step in a workflow file. */
const CRON_MOUNT = /readme:sync|dsh-featherhunter-plugin-base@/;

/** Read a file, returning undefined instead of throwing. */
function tryRead(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Read and parse a JSON file, returning undefined instead of throwing. */
function tryReadJson(path: string): unknown {
  const raw = tryRead(path);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** List source files under a directory, skipping generated / vendor folders. */
function listSourceFiles(directory: string, depth = 0): string[] {
  if (depth > 4 || !existsSync(directory)) return [];
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".") && entry !== ".github") continue;
    const path = join(directory, entry);
    let info: ReturnType<typeof statSync>;
    try {
      info = statSync(path);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      files.push(...listSourceFiles(path, depth + 1));
    } else if (info.isFile() && info.size <= 512 * 1024 && SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      files.push(path);
    }
  }
  return files;
}

/** The banner versions inlined anywhere in one repository. */
function inlinedBundleVersions(repoRoot: string): string[] {
  const versions = new Set<string>();
  for (const file of listSourceFiles(repoRoot)) {
    const raw = tryRead(file);
    if (raw === undefined) continue;
    for (const match of raw.matchAll(INLINE_BANNER)) versions.add(match[1]!);
  }
  return [...versions];
}

/** Workflow files of one repository. */
function workflowFiles(repoRoot: string): string[] {
  const directory = join(repoRoot, ".github", "workflows");
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
      .map((entry) => join(directory, entry));
  } catch {
    return [];
  }
}

/** Probe one URL and return its text, aborting after the timeout. */
async function fetchText(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Age in whole days of an ISO timestamp, or undefined when unparseable. */
function ageInDays(iso: string, now: Date): number | undefined {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return undefined;
  return Math.floor((now.getTime() - time) / (24 * 60 * 60 * 1000));
}

/** Check that every target README of one repository is in sync. */
function checkReadmeBlocks(targets: readonly ResolvedReadmeTarget[]): DoctorCheck {
  const errors: string[] = [];
  for (const target of targets) {
    const result = updateReadme({ ...target, command: "sync", check: true });
    if (!result.ok) errors.push(...result.errors);
  }
  if (errors.length > 0) {
    return { name: "readme-blocks", ok: false, detail: errors[0]! };
  }
  return { name: "readme-blocks", ok: true, detail: targets.length + " README(s) in sync" };
}

/** Check that precise-version image URLs in the READMEs point at the current version. */
function checkReadmeImages(targets: readonly ResolvedReadmeTarget[], version: string): DoctorCheck {
  let count = 0;
  for (const target of targets) {
    const raw = tryRead(join(target.root, target.readme));
    if (raw === undefined) continue;
    for (const match of raw.matchAll(README_IMAGE_VERSION)) {
      count += 1;
      const found = match[1]!;
      if (found !== version) {
        return {
          name: "readme-images",
          ok: false,
          detail: target.readme + " references @" + found + " (expected @" + version + ")",
        };
      }
    }
  }
  return {
    name: "readme-images",
    ok: true,
    detail: count === 0 ? "no precise-version images yet" : count + " image URL(s) at @" + version,
  };
}

/** Check that the repository declares the base package as an exact dependency. */
function checkDependencyVersion(repoRoot: string, version: string): DoctorCheck {
  const raw = tryReadJson(join(repoRoot, "package.json"));
  if (raw === undefined || typeof raw !== "object" || raw === null) {
    return { name: "dependency-version", ok: false, detail: "package.json not readable" };
  }
  const doc = raw as Record<string, Record<string, string> | undefined>;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const declared = doc[field]?.[PACKAGE_NAME];
    if (declared === undefined) continue;
    if (declared !== version) {
      return { name: "dependency-version", ok: false, detail: "declares " + declared + " (expected " + version + ")" };
    }
    return { name: "dependency-version", ok: true, detail: "pinned at " + version };
  }
  return { name: "dependency-version", ok: false, detail: "not declared as a dependency" };
}

/** Check that an inlined client bundle (deck / palette) carries the current version. */
function checkInlineBundleVersion(repoRoot: string, version: string): DoctorCheck {
  const versions = inlinedBundleVersions(repoRoot);
  if (versions.length === 0) {
    return { name: "inline-bundle-version", ok: true, detail: "not inlined" };
  }
  const stale = versions.filter((candidate) => candidate !== version);
  if (stale.length > 0) {
    return {
      name: "inline-bundle-version",
      ok: false,
      detail: "inlined v" + stale.join(", v") + " (expected v" + version + "); re-inline the client bundle",
    };
  }
  return { name: "inline-bundle-version", ok: true, detail: "inlined v" + version };
}

/** Check that the repository ships the star-history chart assets its README needs. */
function checkStarAssets(repoRoot: string, targets: readonly ResolvedReadmeTarget[]): DoctorCheck {
  const missing: string[] = [];
  for (const target of targets) {
    for (const relative of missingStarChartAssets(repoRoot, target)) {
      if (!missing.includes(relative)) missing.push(relative);
    }
  }
  if (missing.length > 0) {
    return {
      name: "star-assets",
      ok: false,
      detail:
        "missing " +
        missing.join(", ") +
        "; generate the chart in the repository before readme:init (see docs/handover/02), or the star block is skipped",
    };
  }
  return { name: "star-assets", ok: true, detail: "chart assets present" };
}

/** Check that the repository workflows mount the README sync step. */
function checkCronMounts(repoRoot: string, repo: string): DoctorCheck {
  const files = workflowFiles(repoRoot);
  const mounted = files.filter((file) => {
    const raw = tryRead(file);
    return raw !== undefined && CRON_MOUNT.test(raw);
  });
  if (mounted.length === 0) {
    return {
      name: "cron-mounts",
      ok: false,
      detail: "no readme:sync step in .github/workflows (see docs/handover/03)",
    };
  }
  const names = mounted.map((file) => basename(file)).join(", ");
  if (repo === "ilife") {
    const scheduled = mounted.some((file) => /^\s*schedule:/m.test(tryRead(file) ?? ""));
    if (!scheduled) {
      return { name: "cron-mounts", ok: false, detail: "readme:sync mounted in " + names + " but no schedule: trigger" };
    }
    return { name: "cron-mounts", ok: true, detail: "mounted in " + names + " with schedule" };
  }
  return { name: "cron-mounts", ok: true, detail: "mounted in " + names };
}

/** Check that the recommendation copy was verified within the freshness window. */
function checkCopyFreshness(manifest: Manifest, now: Date): DoctorCheck {
  const stale: string[] = [];
  let oldest: { id: string; verifiedAt: string; age: number } | undefined;
  for (const plugin of manifest.plugins) {
    const age = ageInDays(plugin.verifiedAt + "T00:00:00Z", now);
    if (age === undefined) {
      stale.push(plugin.id + " (" + plugin.verifiedAt + " is not a date)");
      continue;
    }
    if (oldest === undefined || age > oldest.age) oldest = { id: plugin.id, verifiedAt: plugin.verifiedAt, age };
    if (age > MAX_COPY_AGE_DAYS) stale.push(plugin.id + " (" + plugin.verifiedAt + ", " + age + " days)");
  }
  if (stale.length > 0) {
    return {
      name: "copy-freshness",
      ok: false,
      detail: "copy not verified for > " + MAX_COPY_AGE_DAYS + " days: " + stale.join(", ") + "; re-verify and publish",
    };
  }
  const summary = oldest === undefined ? "no plugins" : "oldest " + oldest.id + " " + oldest.verifiedAt;
  return {
    name: "copy-freshness",
    ok: true,
    detail: manifest.plugins.length + " entr(ies) verified within " + MAX_COPY_AGE_DAYS + " days (" + summary + ")",
  };
}

/** Probe the published manifest over the CDN channels. */
async function checkRemoteManifest(options: DoctorOptions, version: string): Promise<DoctorCheck> {
  if (options.offline === true) {
    return { name: "remote-manifest", ok: true, detail: "skipped: offline" };
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { name: "remote-manifest", ok: true, detail: "skipped: no fetch implementation" };
  }
  const timeoutMs = options.timeoutMs ?? DOCTOR_TIMEOUT_MS;
  const errors: string[] = [];
  for (const url of REMOTE_MANIFEST_URLS) {
    try {
      const raw = await fetchText(url, fetchImpl, timeoutMs);
      const manifest = parseManifest(JSON.parse(raw));
      const host = new URL(url).host;
      const note = manifest.version === version ? "matches package" : "published latest";
      return { name: "remote-manifest", ok: true, detail: host + " @latest v" + manifest.version + " (" + note + ")" };
    } catch (error) {
      errors.push(new URL(url).host + ": " + (error as Error).message);
    }
  }
  return { name: "remote-manifest", ok: false, detail: "no CDN channel reachable (" + errors.join("; ") + ")" };
}

/**
 * Run every health check and return the result.
 *
 * The checks never write: README blocks are verified with `readme:sync --check`,
 * dependencies and inlined bundles are read-only, and the remote probe is a
 * single timed GET.
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck): void => {
    checks.push(check);
  };
  const version = options.packageVersion ?? readPackageVersion();

  add({
    name: "package-version",
    ok: SEMVER.test(version),
    detail: SEMVER.test(version) ? version : 'invalid version "' + version + '"',
  });

  let manifest = options.manifest;
  let manifestError: string | undefined;
  if (manifest === undefined) {
    try {
      manifest = readPackagedManifest();
    } catch (error) {
      manifestError = (error as Error).message;
    }
  }
  if (manifest === undefined) {
    add({ name: "data-freshness", ok: false, detail: manifestError ?? "packaged manifest not readable" });
  } else {
    add({
      name: "data-freshness",
      ok: manifest.version === version,
      detail:
        manifest.version === version
          ? "manifest v" + manifest.version + " revision " + manifest.revision + " matches package"
          : "manifest v" + manifest.version + " (expected v" + version + "); run npm run build:data",
    });
    add(checkCopyFreshness(manifest, options.now ?? new Date()));
  }

  add(await checkRemoteManifest(options, version));

  const grouped = new Map<string, ResolvedReadmeTarget[]>();
  const addTargets = (targets: readonly ResolvedReadmeTarget[]): void => {
    for (const target of targets) {
      const key = target.root + "|" + target.readme;
      const list = grouped.get(key) ?? [];
      list.push(target);
      grouped.set(key, list);
    }
  };
  if (manifest !== undefined) {
    for (const dir of options.reposDirs ?? []) addTargets(expandReadmeTargets([dir], { manifest }));
    for (const root of options.repoRoots ?? []) addTargets(resolveRepoReadmeTargets(root, { manifest }));
  }
  const byRepo = new Map<string, ResolvedReadmeTarget[]>();
  for (const targets of grouped.values()) {
    const repo = targets[0]!.repo;
    const list = byRepo.get(repo) ?? [];
    list.push(...targets);
    byRepo.set(repo, list);
  }
  for (const [repo, targets] of byRepo) {
    const repoRoot = targets[0]!.root;
    if (!existsSync(repoRoot)) {
      add({ name: repo + "/readme-blocks", ok: false, detail: "repository directory not found: " + repoRoot });
      continue;
    }
    for (const check of [
      checkReadmeBlocks(targets),
      checkReadmeImages(targets, version),
      checkDependencyVersion(repoRoot, version),
      checkInlineBundleVersion(repoRoot, version),
      checkStarAssets(repoRoot, targets),
      checkCronMounts(repoRoot, repo),
    ]) {
      add({ name: repo + "/" + check.name, ok: check.ok, detail: check.detail });
    }
  }

  return { ok: checks.every((check) => check.ok), checks };
}

/** Render the human-readable doctor report (one line per check). */
export function formatDoctorReport(result: DoctorResult): string {
  return result.checks.map((check) => (check.ok ? "ok    " : "fail  ") + check.name + "  " + check.detail).join("\n");
}
