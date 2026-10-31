/**
 * release — one-command patch release for the base package (ticket 12).
 *
 * The weekly WeChat refresh becomes a single, rollback-aware action:
 *
 *   npm run release -- --repos D:/dsh-plugin
 *
 * Steps: bump the patch version -> regenerate + validate data -> typecheck,
 * test and build -> npm pack -> npm publish -> wait for the registry and the
 * CDN channels -> `readme:sync --all` over the five repositories and report the
 * rewritten image URLs.
 *
 * The version bump must come before data generation: build-data.ts stamps the
 * version read from packages/base/package.json into data/manifest.json, and the
 * CDN probes below compare the served manifest against the target version.
 *
 * Any failure before the package is published rolls the working tree back with
 * `git checkout` (the release refuses to start on a dirty tree, so that is
 * safe). A failure after the publish is reported as "manual": npm versions are
 * immutable in practice, so the maintainer decides whether to deprecate.
 *
 * The orchestration is dependency-injected (command runner, fetch, clock) so
 * every branch — including rollback and channel timeouts — is unit-testable
 * without touching the network or publishing anything.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot } from "./io";

/** Published package name; also the CDN path segment. */
export const PACKAGE_NAME = "dsh-featherhunter-plugin-base";
/** Default npm dist-tag for a release. */
export const DEFAULT_TAG = "latest";
/** Paths the release itself may rewrite, restored on rollback. */
export const RELEASE_PATHS = [
  "packages/base/package.json",
  "packages/base/package-lock.json",
  "contact",
  "data",
  "packages/base/data",
  "packages/base/src/core/baseline.ts",
] as const;

/** The eleven README files the five repositories own (mirrors ticket 11). */
export const README_TARGETS = [
  { repo: "dsh-mattpocock-skills-deck", readme: "README.md" },
  { repo: "dsh-mattpocock-skills-deck", readme: "package/README.md" },
  { repo: "dsh-mattpocock-skills-deck", readme: "docs/README.en.md" },
  { repo: "dsh-opencode-palette", readme: "README.md" },
  { repo: "dsh-opencode-palette", readme: "package/README.md" },
  { repo: "dsh-opencode-palette", readme: "docs/README.en.md" },
  { repo: "dsh-im-companion", readme: "README.md" },
  { repo: "dsh-im-companion", readme: "docs/README.en.md" },
  { repo: "dsh-prompt", readme: "README.md" },
  { repo: "dsh-prompt", readme: "docs/README.en.md" },
  { repo: "ilife", readme: "README.md" },
] as const;

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export interface ReleaseDeps {
  run: CommandRunner;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface ReleaseOptions {
  /** Repository root (the directory that contains contact/). */
  rootDir: string;
  /** Directory of the published package; defaults to <rootDir>/packages/base. */
  pkgDir?: string;
  /** Parent directory of the five repositories; enables the README sync step. */
  reposDir?: string;
  /** New QR screenshot; when given, contact:update runs before the data step. */
  imagePath?: string;
  /** Contact group to refresh with `imagePath` (default: the group in contact/groups.json). */
  group?: string;
  bump?: "patch" | "minor" | "major";
  /** Explicit target version; wins over `bump`. */
  version?: string;
  /** npm dist-tag; defaults to "latest". */
  tag?: string;
  dryRun?: boolean;
  skipTests?: boolean;
  skipPublish?: boolean;
  registryTimeoutMs?: number;
  channelTimeoutMs?: number;
  pollIntervalMs?: number;
  env?: NodeJS.ProcessEnv;
  deps: ReleaseDeps;
}

export interface ReleaseStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReleaseReport {
  ok: boolean;
  dryRun: boolean;
  packageName: string;
  previousVersion: string;
  version: string;
  tag: string;
  steps: ReleaseStep[];
  timings: Record<string, number>;
  rollback: "not-needed" | "rolled-back" | "manual";
  exitCode: number;
}

/** Compute the next version for a bump kind. */
export function bumpVersion(version: string, bump: "patch" | "minor" | "major"): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) throw new Error("cannot bump non-release version: " + version);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (bump === "major") return major + 1 + ".0.0";
  if (bump === "minor") return major + "." + (minor + 1) + ".0";
  return major + "." + minor + "." + (patch + 1);
}

/** Resolve and validate the version the release will publish. */
export function resolveTargetVersion(
  previous: string,
  options: { bump?: "patch" | "minor" | "major"; version?: string },
): string {
  if (options.version !== undefined) {
    if (!SEMVER_PATTERN.test(options.version)) {
      throw new Error('--version must be a semantic version, got "' + options.version + '"');
    }
    if (options.version === previous) {
      throw new Error("--version must differ from the current version " + previous);
    }
    return options.version;
  }
  return bumpVersion(previous, options.bump ?? "patch");
}

/** Count how many README image URLs point at one package version. */
export function countVersionReferences(markdown: string, version: string): number {
  const token = PACKAGE_NAME + "@" + version + "/data/img/";
  let count = 0;
  let from = 0;
  for (;;) {
    const index = markdown.indexOf(token, from);
    if (index === -1) return count;
    count += 1;
    from = index + token.length;
  }
}

/** Read the published package version from its package.json. */
export function readPackageVersion(pkgDir: string): string {
  const parsed = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  if (typeof parsed.version !== "string" || !SEMVER_PATTERN.test(parsed.version)) {
    throw new Error("package.json has no usable version: " + join(pkgDir, "package.json"));
  }
  return parsed.version;
}

function tail(text: string, lines = 6): string {
  const parts = text.trim().split(/\r?\n/).filter((line) => line.length > 0);
  return parts.slice(-lines).join(" | ");
}

interface ChannelDefinition {
  name: string;
  url: (version: string, tag: string) => string;
  required: boolean;
}

const CHANNELS: readonly ChannelDefinition[] = [
  {
    name: "jsdelivr",
    url: (version, tag) => "https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@" + tag + "/data/manifest.json",
    required: true,
  },
  {
    name: "unpkg",
    url: (version, tag) => "https://unpkg.com/" + PACKAGE_NAME + "@" + tag + "/data/manifest.json",
    required: false,
  },
  {
    name: "npmmirror",
    url: (version) =>
      "https://registry.npmmirror.com/" + PACKAGE_NAME + "/" + version + "/files/data/manifest.json",
    required: false,
  },
];

/**
 * Run one release. Never throws: every failure becomes a failed step plus the
 * matching rollback decision, so the CLI can print one JSON report.
 */
export async function runRelease(options: ReleaseOptions): Promise<ReleaseReport> {
  const deps = options.deps;
  const run = deps.run;
  const stdout = deps.stdout ?? ((line: string) => console.log(line));
  const stderr = deps.stderr ?? ((line: string) => console.error(line));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = deps.now ?? (() => new Date());
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const env = options.env ?? process.env;
  const pkgDir = resolve(options.pkgDir ?? join(options.rootDir, "packages/base"));
  const tag = options.tag ?? DEFAULT_TAG;
  const dryRun = options.dryRun === true;
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const registryTimeoutMs = options.registryTimeoutMs ?? 10 * 60_000;
  const channelTimeoutMs = options.channelTimeoutMs ?? 10 * 60_000;

  const steps: ReleaseStep[] = [];
  const timings: Record<string, number> = {};
  const startedAt = now().getTime();
  let previousVersion = "0.0.0";
  let version = "0.0.0";
  let published = false;
  let readmeTouched = false;
  let rollback: ReleaseReport["rollback"] = "not-needed";

  const elapsed = (): number => now().getTime() - startedAt;
  const mark = (name: string, ok: boolean, detail: string): void => {
    steps.push({ name, ok, detail });
    stdout((ok ? "ok   " : "fail ") + name + "  " + detail);
  };

  const git = async (cwd: string, args: string[]): Promise<CommandResult> =>
    run("git", args, { cwd, env });

  /** Restore every path the release may have touched, then rebuild nothing. */
  const rollbackTree = async (): Promise<void> => {
    rollback = "rolled-back";
    for (const path of RELEASE_PATHS) {
      const result = await git(options.rootDir, ["checkout", "--", path]);
      if (result.code !== 0) stderr("rollback: cannot restore " + path + ": " + tail(result.stderr));
    }
    if (options.imagePath !== undefined) {
      // contact:update adds dated card/qr images that git checkout cannot remove.
      const cleaned = await git(options.rootDir, ["clean", "-fdq", "--", "contact"]);
      if (cleaned.code !== 0) stderr("rollback: cannot clean contact/: " + tail(cleaned.stderr));
    }
    if (readmeTouched && options.reposDir !== undefined) {
      for (const target of README_TARGETS) {
        const repoDir = join(options.reposDir, target.repo);
        if (!existsSync(repoDir)) continue;
        await git(repoDir, ["checkout", "--", target.readme]);
      }
    }
    const tgz = join(pkgDir, PACKAGE_NAME + "-" + version + ".tgz");
    if (existsSync(tgz)) {
      await run(process.execPath, ["-e", "require('node:fs').rmSync(" + JSON.stringify(tgz) + ",{force:true})"], {
        cwd: pkgDir,
        env,
      });
    }
    stdout("rollback: working tree restored to the pre-release commit");
  };

  const fail = async (detail: string): Promise<ReleaseReport> => {
    if (!published) {
      try {
        await rollbackTree();
      } catch (error) {
        rollback = "manual";
        stderr("rollback failed: " + (error as Error).message);
      }
    } else {
      rollback = "manual";
      stdout("published version cannot be rolled back automatically; see docs/handover/03-CI与发布.md");
    }
    return {
      ok: false,
      dryRun,
      packageName: PACKAGE_NAME,
      previousVersion,
      version,
      tag,
      steps,
      timings,
      rollback,
      exitCode: 1,
    };
  };

  try {
    // 0. Preflight -------------------------------------------------------
    if (!existsSync(join(pkgDir, "package.json"))) {
      mark("preflight", false, "package directory not found: " + pkgDir);
      return await fail("package directory not found");
    }
    previousVersion = readPackageVersion(pkgDir);
    version = resolveTargetVersion(previousVersion, options);
    mark("preflight", true, "package " + PACKAGE_NAME + " " + previousVersion + " -> " + version + " (tag " + tag + ")");

    const status = await git(options.rootDir, ["status", "--porcelain"]);
    if (status.code !== 0) {
      mark("worktree", false, "git status failed: " + tail(status.stderr));
      return await fail("git status failed");
    }
    if (status.stdout.trim().length > 0) {
      mark("worktree", false, "working tree is dirty; commit or stash first");
      return {
        ok: false,
        dryRun,
        packageName: PACKAGE_NAME,
        previousVersion,
        version,
        tag,
        steps,
        timings,
        rollback: "not-needed",
        exitCode: 1,
      };
    }

    mark("worktree", true, "git working tree is clean");

    // 1. Contact source (optional) ---------------------------------------
    if (options.imagePath === undefined) {
      mark("contact", true, "skipped (no --image given)");
    } else {
      const contactArgs = [
        join(pkgDir, "scripts", "run-ts.mjs"),
        "contact-update",
        resolve(options.imagePath),
        "--confirmed",
        "--no-build",
      ];
      if (options.group !== undefined) contactArgs.push("--group", options.group);
      if (dryRun) contactArgs.push("--dry-run");
      const contact = await run(process.execPath, contactArgs, { cwd: pkgDir, env });
      if (contact.code !== 0) {
        mark("contact", false, tail(contact.stderr || contact.stdout));
        return await fail("contact:update failed");
      }
      mark(
        "contact",
        true,
        dryRun
          ? "validated " + options.imagePath + " (dry run, nothing written)"
          : "contact sources refreshed from " + options.imagePath,
      );
    }

    // 2. Version ---------------------------------------------------------
    // Must run before the data step: build-data.ts stamps the version read
    // from packages/base/package.json into data/manifest.json (and the bundled
    // baseline), while the CDN probes below require the manifest to report
    // `version` — the target of this release, not the previous one.
    if (dryRun) {
      mark("version", true, "would run: npm version " + version + " --no-git-tag-version");
    } else {
      const bumped = await run("npm", ["version", version, "--no-git-tag-version"], { cwd: pkgDir, env });
      if (bumped.code !== 0) {
        mark("version", false, "npm version failed: " + tail(bumped.stderr || bumped.stdout));
        return await fail("npm version failed");
      }
      mark("version", true, "package.json + package-lock.json set to " + version);
    }

    // 3. Data ------------------------------------------------------------
    if (dryRun) {
      const check = await run("npm", ["run", "data:check"], { cwd: pkgDir, env });
      if (check.code !== 0) {
        mark("data", false, "data:check failed: " + tail(check.stderr || check.stdout));
        return await fail("data:check failed");
      }
      mark("data", true, "data:check passed (dry run skips regeneration)");
    } else {
      const build = await run("npm", ["run", "build:data"], { cwd: pkgDir, env });
      if (build.code !== 0) {
        mark("data", false, "build:data failed: " + tail(build.stderr || build.stdout));
        return await fail("build:data failed");
      }
      const check = await run("npm", ["run", "data:check"], { cwd: pkgDir, env });
      if (check.code !== 0) {
        mark("data", false, "data:check failed: " + tail(check.stderr || check.stdout));
        return await fail("data:check failed");
      }
      mark("data", true, "data regenerated and deterministic");
    }

    // 4. Gates -----------------------------------------------------------
    const gates: Array<[string, string[]]> = [["typecheck", ["run", "typecheck"]]];
    if (dryRun) {
      mark("gates", true, "dry run: would run test + build after typecheck");
    } else {
      if (options.skipTests !== true) gates.push(["test", ["test"]]);
      gates.push(["build", ["run", "build"]]);
    }
    for (const [name, args] of gates) {
      const result = await run("npm", args, { cwd: pkgDir, env });
      if (result.code !== 0) {
        mark(name, false, tail(result.stderr || result.stdout));
        return await fail(name + " failed");
      }
      mark(name, true, "passed");
    }

    // 5. Pack ------------------------------------------------------------
    let tgzPath = "";
    if (dryRun) {
      mark("pack", true, "dry run: would run npm pack --json");
    } else {
    const pack = await run("npm", ["pack", "--json"], { cwd: pkgDir, env });
    if (pack.code !== 0) {
      mark("pack", false, tail(pack.stderr || pack.stdout));
      return await fail("npm pack failed");
    }
    try {
      const parsed = JSON.parse(pack.stdout.trim().split(/\r?\n/).pop() ?? "[]") as Array<{
        filename?: string;
        files?: unknown[];
      }>;
      const filename = parsed[0]?.filename;
      if (typeof filename !== "string") throw new Error("npm pack --json returned no filename");
      tgzPath = join(pkgDir, filename);
      mark("pack", true, filename + " (" + (parsed[0]?.files?.length ?? 0) + " files)");
    } catch (error) {
      mark("pack", false, "cannot parse npm pack output: " + (error as Error).message);
      return await fail("npm pack output unreadable");
    }
    }

    // 6. Publish + registry readiness ------------------------------------
    if (options.skipPublish === true || dryRun) {
      mark("publish", true, "skipped (dry run or --skip-publish)" + (tgzPath === "" ? "" : "; tarball: " + tgzPath));
      mark("registry", true, "skipped with publish");
    } else {
      const publish = await run("npm", ["publish", tgzPath, "--tag", tag], { cwd: pkgDir, env });
      if (publish.code !== 0) {
        // npm can report a failure after the upload actually landed (staged
        // publishing, flaky proxy). Ask the registry before rolling back.
        const visible = await waitForRegistry(version, Math.min(registryTimeoutMs, 90_000));
        if (visible === null) {
          mark("publish", false, tail(publish.stderr || publish.stdout));
          return await fail("npm publish failed");
        }
        published = true;
        mark("publish", true, "npm reported an error but " + version + " is visible in the registry");
      } else {
        published = true;
        mark("publish", true, "npm publish --tag " + tag);
      }
      const registryMs = await waitForRegistry(version, registryTimeoutMs);
      if (registryMs === null) {
        mark("registry", false, "version " + version + " not visible after " + registryTimeoutMs + "ms");
        return await fail("registry timeout");
      }
      timings["registry"] = registryMs;
      mark("registry", true, "npm view sees " + version + " after " + registryMs + "ms");
    }

    // 7. CDN channels ----------------------------------------------------
    if (options.skipPublish === true || dryRun) {
      mark("channels", true, "skipped with publish");
    } else {
      let requiredFailed = false;
      for (const channel of CHANNELS) {
        const result = await waitForChannel(channel, version, tag, channelTimeoutMs);
        if (result.ms !== null) {
          timings[channel.name] = result.ms;
          mark(channel.name, true, "manifest " + version + " after " + result.ms + "ms");
        } else if (channel.required) {
          requiredFailed = true;
          mark(channel.name, false, "not ready after " + channelTimeoutMs + "ms (" + result.lastStatus + ")");
        } else {
          mark(channel.name, true, "best effort: " + result.lastStatus);
        }
      }
      if (requiredFailed) return await fail("required CDN channel is not ready");
    }

    // 8. README sync -----------------------------------------------------
    if (options.reposDir === undefined) {
      mark("readme", true, "skipped (no --repos given)");
    } else if (dryRun) {
      mark("readme", true, "would run readme:sync --all --repos " + options.reposDir);
    } else {
      readmeTouched = true;
      const cli = join(pkgDir, "dist", "node", "cli.js");
      const sync = await run(process.execPath, [cli, "readme:sync", "--all", "--repos", options.reposDir], {
        cwd: options.rootDir,
        env,
      });
      for (const line of sync.stdout.trim().split(/\r?\n/)) {
        if (line.length > 0) stdout("readme: " + line);
      }
      if (sync.code !== 0) {
        mark("readme", false, tail(sync.stderr || sync.stdout));
        return await fail("readme:sync failed");
      }
      const counts = countReadmeReferences(options.reposDir, version);
      mark("readme", true, counts.present + "/" + counts.total + " READMEs reference @" + version + " (" + counts.urls + " image URLs)");
      const check = await run(
        process.execPath,
        [cli, "readme:sync", "--check", "--all", "--repos", options.reposDir],
        { cwd: options.rootDir, env },
      );
      if (check.code !== 0) {
        mark("readme-check", false, tail(check.stderr || check.stdout));
        return await fail("readme:sync --check failed after sync");
      }
      mark("readme-check", true, "no drift after sync");
    }

    // 9. Report ----------------------------------------------------------
    timings["total"] = elapsed();
    const report: ReleaseReport = {
      ok: true,
      dryRun,
      packageName: PACKAGE_NAME,
      previousVersion,
      version,
      tag,
      steps,
      timings,
      rollback,
      exitCode: 0,
    };
    writeReport(options.rootDir, report, dryRun);
    return report;
  } catch (error) {
    mark("unexpected", false, (error as Error).message);
    return await fail((error as Error).message);
  }

  /** Poll `npm view <pkg>@<version> version` until it matches; return ms or null. */
  async function waitForRegistry(target: string, timeoutMs: number): Promise<number | null> {
    const start = now().getTime();
    for (;;) {
      const view = await run("npm", ["view", PACKAGE_NAME + "@" + target, "version"], { cwd: pkgDir, env });
      if (view.code === 0 && view.stdout.trim() === target) return now().getTime() - start;
      if (now().getTime() - start >= timeoutMs) return null;
      await sleep(pollIntervalMs);
    }
  }

  /** Poll one CDN channel until the manifest reports the target version. */
  async function waitForChannel(
    channel: ChannelDefinition,
    target: string,
    distTag: string,
    timeoutMs: number,
  ): Promise<{ ms: number | null; lastStatus: string }> {
    const start = now().getTime();
    let lastStatus = "no attempt";
    for (;;) {
      lastStatus = await probeChannel(channel, target, distTag);
      if (lastStatus === "ok") return { ms: now().getTime() - start, lastStatus };
      if (now().getTime() - start >= timeoutMs) return { ms: null, lastStatus };
      await sleep(pollIntervalMs);
    }
  }

  async function probeChannel(
    channel: ChannelDefinition,
    target: string,
    distTag: string,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetchImpl(channel.url(target, distTag), { signal: controller.signal });
      if (!response.ok) return "HTTP " + response.status;
      const parsed = (await response.json()) as { version?: string };
      return parsed.version === target ? "ok" : "version " + String(parsed.version);
    } catch (error) {
      return "error: " + (error as Error).message;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Count README files / image URLs that reference the released version. */
export function countReadmeReferences(
  reposDir: string,
  version: string,
): { total: number; present: number; urls: number } {
  let present = 0;
  let urls = 0;
  for (const target of README_TARGETS) {
    const path = join(reposDir, target.repo, target.readme);
    if (!existsSync(path)) continue;
    const markdown = readFileSync(path, "utf8");
    const count = countVersionReferences(markdown, version);
    if (count > 0) present += 1;
    urls += count;
  }
  return { total: README_TARGETS.length, present, urls };
}

function writeReport(rootDir: string, report: ReleaseReport, dryRun: boolean): void {
  if (dryRun) return;
  try {
    const dir = join(rootDir, ".tmp");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "release-" + report.version + ".json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  } catch {
    // The report on stdout is authoritative; a missing file must not fail the release.
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `release — one-command patch release for ${PACKAGE_NAME}

Usage:
  npm run release -- [options]

Options:
  --image <path>      New QR screenshot; runs contact:update before regenerating data
  --group <id>        Contact group for --image (default: the group in contact/groups.json)
  --repos <dir>       Parent directory of the five repositories; enables readme:sync
  --bump <kind>       patch | minor | major (default: patch)
  --version <x.y.z>   Explicit target version (wins over --bump)
  --tag <name>        npm dist-tag (default: latest)
  --dry-run           Validate data only; print the plan, change nothing
  --skip-tests        Skip the test step (still typecheck + build)
  --skip-publish      Pack and gate locally, do not publish
  --registry-timeout <ms>  Registry visibility timeout (default 600000)
  --channel-timeout <ms>   CDN readiness timeout (default 600000)
  --help              Print this help

Exit codes: 0 released / 1 failed (see rollback field) / 2 usage error
`;

interface CliOptions {
  reposDir?: string;
  imagePath?: string;
  group?: string;
  bump: "patch" | "minor" | "major";
  version?: string;
  tag: string;
  dryRun: boolean;
  skipTests: boolean;
  skipPublish: boolean;
  registryTimeoutMs?: number;
  channelTimeoutMs?: number;
}

function parseArgs(args: string[]): CliOptions | { error: string } {
  const options: CliOptions = {
    bump: "patch",
    tag: DEFAULT_TAG,
    dryRun: false,
    skipTests: false,
    skipPublish: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const value = (): string | undefined => args[index + 1];
    switch (arg) {
      case "--image":
        options.imagePath = value();
        index += 1;
        break;
      case "--group":
        options.group = value();
        index += 1;
        break;
      case "--repos":
        options.reposDir = value();
        index += 1;
        break;
      case "--bump": {
        const kind = value();
        if (kind !== "patch" && kind !== "minor" && kind !== "major") {
          return { error: "--bump must be patch, minor or major" };
        }
        options.bump = kind;
        index += 1;
        break;
      }
      case "--version":
        options.version = value();
        index += 1;
        break;
      case "--tag":
        options.tag = value() ?? DEFAULT_TAG;
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--skip-tests":
        options.skipTests = true;
        break;
      case "--skip-publish":
        options.skipPublish = true;
        break;
      case "--registry-timeout":
        options.registryTimeoutMs = Number(value());
        index += 1;
        break;
      case "--channel-timeout":
        options.channelTimeoutMs = Number(value());
        index += 1;
        break;
      case "--help":
      case "-h":
        return { error: "" };
      default:
        return { error: 'unknown option "' + arg + '"' };
    }
  }
  return options;
}

/** Spawn a command, capture stdout/stderr, never throw on a non-zero exit. */
export function spawnCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolvePromise({ code: 1, stdout, stderr: stderr + error.message }));
  });
}

/** CLI entry point used by scripts/run-ts.mjs. */
export async function runCli(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    process.stderr.write("release: " + parsed.error + "\n\n");
    process.stderr.write(HELP);
    return 2;
  }
  const rootDir = findRepoRoot();
  const report = await runRelease({
    rootDir,
    reposDir: parsed.reposDir === undefined ? undefined : resolve(parsed.reposDir),
    imagePath: parsed.imagePath === undefined ? undefined : resolve(parsed.imagePath),
    group: parsed.group,
    bump: parsed.bump,
    version: parsed.version,
    tag: parsed.tag,
    dryRun: parsed.dryRun,
    skipTests: parsed.skipTests,
    skipPublish: parsed.skipPublish,
    registryTimeoutMs: parsed.registryTimeoutMs,
    channelTimeoutMs: parsed.channelTimeoutMs,
    deps: { run: spawnCommand },
  });
  process.stdout.write(JSON.stringify(report) + "\n");
  return report.exitCode;
}