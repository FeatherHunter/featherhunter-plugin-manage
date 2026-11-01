/**
 * Finding the DSH install: the executable, the archive, and the host CLI entry.
 *
 * The verifier must not hard-code one machine's install directory. The reported
 * failure in the field was a DSH installed on a custom drive (`D:\DeepseekHarness`),
 * whose only discoverable handle was the `dsh` wrapper on `PATH`
 * (`...\resources\runtime\cli\bin\dsh.cmd`). That wrapper's location encodes the
 * layout, so discovery treats it as a first-class source:
 *
 * 1. explicit arguments (`--dsh-exe` / `--dsh-cli-js`),
 * 2. `DSH_EXE` / `DSH_CLI_JS`,
 * 3. the `dsh` wrapper on `PATH` (real path, then walk ancestors for the install root),
 * 4. conventional install locations for the platform.
 *
 * The CLI entry is a separate fact from the executable. A desktop install ships an
 * Electron binary plus `resources/app.asar`, a file whose interior paths cannot be
 * tested with plain `fs` calls; `discoverDsh` therefore reports the archive and the
 * posix entry inside it, and the `dsh-runtime` check reads the archive header to
 * prove the entry exists. An install with only one of the two is not usable, and
 * the failure says which half is missing (`details.stage`) so the check can mark
 * it `blocked` (nothing installed) or `fail` (installed but structurally broken).
 */
import type { EnvPort, FsPort, PlatformName } from "../../contracts/ports";
import { err, failure, ok, type Result } from "../../contracts/result";
import { joinFsPath, parentPath, toPosixPath } from "../paths";
import { ASAR_CLI_ENTRY } from "./asar";

/** Relative location of the host CLI inside a desktop install on disk (unpacked layout). */
export const ASAR_CLI_RELATIVE = `resources/app.asar/${ASAR_CLI_ENTRY}`;

/** Name of the desktop binary per platform, used to derive one fact from the other. */
const EXE_NAME = "DeepSeek Harness.exe";
const APP_NAME = "DeepSeek Harness";
const ASAR_NAME = "app.asar";
const APP_DIR_NAME = "app";

export type DshDiscoverySource = "argument" | "environment" | "path-wrapper" | "conventional";

export interface DiscoveredDsh {
  /** Absolute path of the desktop executable. */
  readonly exe: string;
  /** Absolute path of `app.asar` when the CLI entry lives inside one, else `null`. */
  readonly asarPath: string | null;
  /** Posix path inside the archive when `asarPath` is set, else an absolute file path. */
  readonly cliJs: string;
  readonly source: DshDiscoverySource;
  /** Install root when it could be derived from the wrapper or the executable. */
  readonly installRoot: string | null;
  /** Every candidate that was tried, so a blocked report shows its work. */
  readonly tried: readonly string[];
}

export interface DiscoverDshOptions {
  readonly fs: FsPort;
  readonly env: EnvPort;
  /** Explicit paths win over everything else. */
  readonly exePath?: string;
  readonly cliJsPath?: string;
  /** Extra install roots to probe before the conventional ones (tests use this). */
  readonly extraInstallDirs?: readonly string[];
}

/** Where the two facts of one install were found. */
interface ResolvedInstall {
  readonly exe: string;
  readonly asarPath: string | null;
  readonly cliJs: string;
  readonly installRoot: string | null;
}

/** Failure staging: "nothing installed" vs "installed but broken". */
export type DshDiscoveryStage = "exe-missing" | "structure-missing";

function failureWithStage(
  message: string,
  stage: DshDiscoveryStage,
  hint: string,
  details: Readonly<Record<string, unknown>>,
): Result<never> {
  return err(failure("prerequisite", message, hint, { stage, ...details }));
}

/** Platform's binary name for a given install root. */
function exeNamesFor(platform: PlatformName): readonly string[] {
  if (platform === "win32" || platform === "darwin") return [EXE_NAME];
  return ["deepseek-harness", APP_NAME];
}

/** Split a path that points inside an asar into the archive path and the entry path. */
function splitAsarPath(value: string): { asarPath: string; entry: string } | null {
  const posix = toPosixPath(value);
  const index = posix.toLowerCase().indexOf(`.${ASAR_NAME}/`.toLowerCase());
  if (index < 0) return null;
  const asarEnd = index + ASAR_NAME.length + 1;
  const asarPath = posix.slice(0, asarEnd);
  const entry = posix.slice(asarEnd + 1);
  if (entry.length === 0) return null;
  return { asarPath, entry };
}

/** Candidate archives for an executable directory. */
function asarCandidatesFor(exe: string): string[] {
  const directory = parentPath(exe);
  if (directory === null) return [];
  return [
    joinFsPath(directory, "resources", ASAR_NAME),
    joinFsPath(directory, ASAR_NAME),
  ];
}

/** Candidate real (unpacked) CLI entry files for an executable directory. */
function unpackedCliCandidatesFor(exe: string): string[] {
  const directory = parentPath(exe);
  if (directory === null) return [];
  return [
    joinFsPath(directory, "resources", ASAR_CLI_ENTRY),
    joinFsPath(directory, APP_DIR_NAME, ASAR_CLI_ENTRY),
  ];
}

/** Executable candidates for an install root. */
function exeCandidatesFor(root: string, platform: PlatformName): string[] {
  return exeNamesFor(platform).map((name) => joinFsPath(root, name));
}

async function firstExisting(fs: FsPort, candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fs.exists(candidate)) return candidate;
  }
  return null;
}

/** True when the file at `path` exists and is a regular file (a directory is not an install). */
async function isRegularFile(fs: FsPort, path: string): Promise<boolean> {
  const stats = await fs.stat(path);
  return stats.ok && stats.value.kind === "file";
}

/**
 * Derive the complete install from whatever the caller already knows.
 *
 * Every branch fills in the missing half from the known one: an executable names
 * its archive by layout, an archive path names its install root, and a wrapper
 * names both through its ancestors. The function only reaches "structure-missing"
 * after trying all three derivations.
 */
async function resolveInstall(
  fs: FsPort,
  platform: PlatformName,
  known: { readonly exePath?: string | undefined; readonly cliJsPath?: string | undefined },
  tried: string[],
): Promise<Result<ResolvedInstall>> {
  let exe: string | null = null;
  let asarPath: string | null = null;
  let cliJs: string | null = null;
  let installRoot: string | null = null;

  if (known.exePath !== undefined) {
    tried.push(`exe: ${known.exePath}`);
    if (!(await fs.exists(known.exePath))) {
      return failureWithStage(
        `the DSH executable is missing: ${known.exePath}`,
        "exe-missing",
        "check the path, or pass --dsh-exe with an existing file",
        { tried },
      );
    }
    exe = known.exePath;
  }

  if (known.cliJsPath !== undefined) {
    tried.push(`cli: ${known.cliJsPath}`);
    const split = splitAsarPath(known.cliJsPath);
    if (split !== null) {
      asarPath = split.asarPath;
      cliJs = split.entry;
      if (!(await fs.exists(asarPath))) {
        return failureWithStage(
          `the CLI entry names an asar archive that is missing: ${asarPath}`,
          "structure-missing",
          "pass the archive path that exists, or reinstall DSH",
          { tried },
        );
      }
    } else if (await fs.exists(known.cliJsPath)) {
      cliJs = known.cliJsPath;
    } else {
      return failureWithStage(
        `the DSH CLI entry is missing: ${known.cliJsPath}`,
        "structure-missing",
        "pass --dsh-cli-js with an existing file, or a path inside resources/app.asar",
        { tried },
      );
    }
  }

  if (exe !== null && asarPath === null && cliJs === null) {
    const archives = asarCandidatesFor(exe);
    tried.push(...archives.map((candidate) => `derived asar: ${candidate}`));
    const foundArchive = await firstExisting(fs, archives);
    if (foundArchive !== null) {
      asarPath = foundArchive;
      cliJs = ASAR_CLI_ENTRY;
    } else {
      const unpacked = unpackedCliCandidatesFor(exe);
      tried.push(...unpacked.map((candidate) => `derived cli: ${candidate}`));
      const foundCli = await firstExisting(fs, unpacked);
      if (foundCli === null) {
        return failureWithStage(
          `the DSH executable exists but its install has no app.asar: ${exe}`,
          "structure-missing",
          "reinstall DSH, or pass --dsh-cli-js with the cli.js inside resources/app.asar",
          { tried, exe },
        );
      }
      cliJs = foundCli;
    }
  }

  if (exe === null && asarPath !== null) {
    const posix = toPosixPath(asarPath);
    const suffix = `/resources/${ASAR_NAME}`;
    const fromArchive = posix.toLowerCase().endsWith(suffix.toLowerCase())
      ? posix.slice(0, posix.length - suffix.length)
      : (parentPath(asarPath) ?? null);
    if (fromArchive !== null) {
      installRoot = fromArchive;
      const candidates = exeCandidatesFor(fromArchive, platform);
      tried.push(...candidates.map((candidate) => `derived exe: ${candidate}`));
      exe = await firstExisting(fs, candidates);
    }
  }

  if (exe === null) {
    return failureWithStage(
      "could not find the DSH executable",
      "exe-missing",
      "pass --dsh-exe, set DSH_EXE, or put the install's dsh wrapper on PATH",
      { tried },
    );
  }
  if (cliJs === null) {
    return failureWithStage(
      "found the DSH executable but not its CLI entry",
      "structure-missing",
      "the install looks incomplete: resources/app.asar is missing next to the executable; reinstall DSH",
      { tried, exe },
    );
  }

  if (installRoot === null) {
    // The executable sits either at the install root or one level below resources.
    const directory = parentPath(exe);
    if (directory !== null) {
      installRoot = directory.toLowerCase().endsWith(`/${"resources"}`) ? (parentPath(directory) ?? directory) : directory;
    }
  }

  return ok({ exe, asarPath, cliJs, installRoot });
}

/** Conventional install roots, in the order a user would expect them. */
function conventionalInstallDirs(env: EnvPort, platform: PlatformName): string[] {
  const candidates: string[] = [];
  if (platform === "win32") {
    const localAppData = env.get("LOCALAPPDATA");
    if (localAppData !== undefined) candidates.push(joinFsPath(localAppData, "Programs", APP_NAME));
    const programFiles = env.get("PROGRAMFILES");
    if (programFiles !== undefined) candidates.push(joinFsPath(programFiles, APP_NAME));
    const programFilesX86 = env.get("PROGRAMFILES(X86)");
    if (programFilesX86 !== undefined) candidates.push(joinFsPath(programFilesX86, APP_NAME));
    return candidates;
  }
  if (platform === "darwin") {
    candidates.push(`/Applications/${APP_NAME}.app/Contents`);
    const home = env.homeDir();
    candidates.push(joinFsPath(home, "Applications", `${APP_NAME}.app`, "Contents"));
    return candidates;
  }
  candidates.push(`/opt/${APP_NAME}`, `/usr/lib/${APP_NAME}`, "/usr/local/lib/deepseek-harness");
  return candidates;
}

/** Split `PATH` into directories, ignoring empty entries. */
function pathDirectories(env: EnvPort, platform: PlatformName): string[] {
  const raw = env.get("PATH") ?? env.get("Path") ?? env.get("path") ?? "";
  const separator = platform === "win32" ? ";" : ":";
  return raw
    .split(separator)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry.length > 0);
}

/** Find a `dsh` wrapper on `PATH` (the launcher installed by the desktop app). */
async function findPathWrapper(fs: FsPort, env: EnvPort, platform: PlatformName): Promise<string | null> {
  const names = platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh.bat", "dsh"] : ["dsh"];
  for (const directory of pathDirectories(env, platform)) {
    for (const name of names) {
      const candidate = joinFsPath(directory, name);
      if (await fs.exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Install roots implied by an executable wrapper's location.
 *
 * A wrapper at `<root>/resources/runtime/cli/bin/dsh.cmd` names `<root>` by
 * construction, but the depth is an implementation detail of the installer, so
 * this walks ancestors instead of assuming four `..` segments.
 */
async function installRootsFromWrapper(
  fs: FsPort,
  platform: PlatformName,
  wrapper: string,
): Promise<readonly string[]> {
  const resolved = await fs.realPath(wrapper);
  const base = resolved.ok ? resolved.value : wrapper;
  const roots: string[] = [];
  let directory = parentPath(base);
  for (let depth = 0; depth < 8 && directory !== null; depth += 1) {
    const archive = joinFsPath(directory, "resources", ASAR_NAME);
    const exe = await firstExisting(fs, exeCandidatesFor(directory, platform));
    if ((await isRegularFile(fs, archive)) || exe !== null) roots.push(directory);
    directory = parentPath(directory);
  }
  return roots;
}

/**
 * Resolve the two paths, or explain every source that was tried.
 *
 * Ordering is deliberate: an explicit argument must beat an environment variable
 * (so a script can override a stale shell export), and both must beat conventions
 * (so a portable install does not lose to an installed one).
 */
export async function discoverDsh(options: DiscoverDshOptions): Promise<Result<DiscoveredDsh>> {
  const { fs, env } = options;
  const platform = env.platform();
  const tried: string[] = [];
  // A "found the executable but the install is broken" error outranks the generic
  // "nothing found" result: a broken explicit/env path is evidence, and hiding it
  // behind a blocked run would turn a real defect into a missing prerequisite.
  let structureFailure: Result<never> | null = null;

  // 1. Explicit arguments: a typo must not be silently replaced by a convention.
  if (options.exePath !== undefined || options.cliJsPath !== undefined) {
    const resolved = await resolveInstall(
      fs,
      platform,
      { exePath: options.exePath, cliJsPath: options.cliJsPath },
      tried,
    );
    if (!resolved.ok) return resolved;
    return ok({ ...resolved.value, source: "argument", tried });
  }

  // 2. Environment.
  const envExe = env.get("DSH_EXE");
  const envCli = env.get("DSH_CLI_JS");
  if (envExe !== undefined || envCli !== undefined) {
    const envTried: string[] = [];
    const resolved = await resolveInstall(fs, platform, { exePath: envExe, cliJsPath: envCli }, envTried);
    tried.push(...envTried.map((line) => `env ${line}`));
    if (resolved.ok) return ok({ ...resolved.value, source: "environment", tried });
    if (resolved.error.details?.["stage"] === "structure-missing") structureFailure = resolved;
  }

  // 3. The dsh wrapper on PATH (custom drives have no conventional location).
  const wrapper = await findPathWrapper(fs, env, platform);
  if (wrapper !== null) {
    tried.push(`path wrapper: ${wrapper}`);
    const roots = await installRootsFromWrapper(fs, platform, wrapper);
    tried.push(...roots.map((root) => `wrapper install root: ${root}`));
    for (const root of roots) {
      const exe = await firstExisting(fs, exeCandidatesFor(root, platform));
      if (exe === null) continue;
      const resolved = await resolveInstall(fs, platform, { exePath: exe }, tried);
      if (resolved.ok) {
        return ok({ ...resolved.value, installRoot: root, source: "path-wrapper", tried });
      }
      if (resolved.error.details?.["stage"] === "structure-missing") structureFailure = resolved;
    }
  }

  // 4. Conventional install locations.
  const installDirs = [...(options.extraInstallDirs ?? []), ...conventionalInstallDirs(env, platform)];
  for (const directory of installDirs) {
    const candidates = exeCandidatesFor(directory, platform);
    tried.push(...candidates.map((candidate) => `conventional exe: ${candidate}`));
    const exe = await firstExisting(fs, candidates);
    if (exe === null) continue;
    const resolved = await resolveInstall(fs, platform, { exePath: exe }, tried);
    if (resolved.ok) return ok({ ...resolved.value, source: "conventional", tried });
    if (resolved.error.details?.["stage"] === "structure-missing") structureFailure = resolved;
  }

  if (structureFailure !== null) return structureFailure;

  return failureWithStage(
    "could not find the DSH executable",
    "exe-missing",
    "install the DeepSeek Harness desktop app, pass --dsh-exe / set DSH_EXE, or put the install's dsh wrapper on PATH",
    { tried, platform },
  );
}
