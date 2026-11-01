/**
 * Finding the DSH executable and its CLI entry.
 *
 * The verifier must not hard-code one machine's install directory: the same tool
 * has to run on a developer laptop, on a CI runner and inside a second checkout.
 * So discovery is an ordered list of *sources* (explicit argument, environment,
 * conventional install locations) and the first hit wins — with the full list of
 * rejected candidates returned in the failure so a confused operator can see why.
 *
 * The CLI entry is a separate fact from the executable. The desktop app ships an
 * Electron binary plus `resources/app.asar/dsh/node_modules/.../cli.js`; running
 * the binary with `--expose-internals <cli.js>` is what turns it into the host.
 * An install that has only one of the two is not usable, and saying that plainly
 * beats a spawn error three screens later.
 */
import { joinFsPath, toPosixPath } from "../paths";
import type { EnvPort, FsPort, PlatformName } from "../../contracts/ports";
import { err, ok, type Result } from "../../contracts/result";

/** Relative location of the host CLI inside a desktop install. */
export const ASAR_CLI_RELATIVE = "resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js";

/** Name of the desktop binary per platform, used to derive one fact from the other. */
const EXE_NAME = "DeepSeek Harness.exe";
const APP_NAME = "DeepSeek Harness";

export interface DiscoverDshOptions {
  readonly fs: FsPort;
  readonly env: EnvPort;
  /** Explicit paths win over everything else. */
  readonly exePath?: string;
  readonly cliJsPath?: string;
  /** Extra install roots to probe before the conventional ones (tests use this). */
  readonly extraInstallDirs?: readonly string[];
}

export interface DiscoveredDsh {
  readonly exe: string;
  readonly cliJs: string;
  readonly source: "argument" | "environment" | "conventional";
  /** Every candidate that was tried, so a failure report can show its work. */
  readonly tried: readonly string[];
}

function platformOf(env: EnvPort): PlatformName {
  return env.platform();
}

/** Conventional executable paths, in the order a user would expect them. */
function conventionalExecutables(env: EnvPort, platform: PlatformName): string[] {
  const candidates: string[] = [];
  if (platform === "win32") {
    const localAppData = env.get("LOCALAPPDATA");
    if (localAppData !== undefined) candidates.push(joinFsPath(localAppData, "Programs", APP_NAME, EXE_NAME));
    const programFiles = env.get("PROGRAMFILES");
    if (programFiles !== undefined) candidates.push(joinFsPath(programFiles, APP_NAME, EXE_NAME));
    const programFilesX86 = env.get("PROGRAMFILES(X86)");
    if (programFilesX86 !== undefined) candidates.push(joinFsPath(programFilesX86, APP_NAME, EXE_NAME));
    return candidates;
  }
  if (platform === "darwin") {
    candidates.push(`/Applications/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`);
    const home = env.homeDir();
    candidates.push(joinFsPath(home, "Applications", `${APP_NAME}.app`, "Contents", "MacOS", APP_NAME));
    return candidates;
  }
  candidates.push(`/opt/${APP_NAME}/deepseek-harness`);
  candidates.push(`/usr/lib/${APP_NAME}/deepseek-harness`);
  candidates.push("/usr/bin/deepseek-harness");
  return candidates;
}

/** Where the CLI entry lives, given the executable path. */
function cliCandidatesForExe(exe: string, platform: PlatformName): string[] {
  const exeDirectory = exe.includes("/") || exe.includes("\\") ? exe.replace(/[\\/][^\\/]+$/, "") : "";
  if (exeDirectory.length === 0) return [];
  const candidates: string[] = [];
  if (platform === "darwin") {
    // .../DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness
    // .../DeepSeek Harness.app/Contents/Resources/app.asar/...
    const contents = exeDirectory.replace(/[\\/]MacOS$/, "");
    candidates.push(joinFsPath(contents, "Resources", "app.asar", "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "cli.js"));
    // .../Multiplatform build without the app bundle wrapper.
    candidates.push(joinFsPath(contents, "Resources", ASAR_CLI_RELATIVE));
  }
  candidates.push(joinFsPath(exeDirectory, ASAR_CLI_RELATIVE));
  // A portable unpacked build keeps app.asar next to the binary.
  candidates.push(joinFsPath(exeDirectory, "app.asar", "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "cli.js"));
  return candidates;
}

/** Derive the executable from an asar CLI path, for the "only cliJs was given" case. */
function exeCandidatesForCli(cliJs: string, platform: PlatformName): string[] {
  const posix = toPosixPath(cliJs);
  let root: string | null = null;
  for (const marker of ["/resources/app.asar/", "/Resources/app.asar/", "/app.asar/"]) {
    const index = posix.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) {
      root = posix.slice(0, index);
      break;
    }
  }
  if (root === null) return [];
  if (platform === "win32") return [joinFsPath(root, EXE_NAME)];
  if (platform === "darwin") {
    const contents = root.endsWith("/Contents") ? root : `${root}/Contents`;
    return [joinFsPath(contents, "MacOS", APP_NAME)];
  }
  return [joinFsPath(root, "deepseek-harness")];
}

async function firstExisting(fs: FsPort, candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fs.exists(candidate)) return candidate;
  }
  return null;
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
  const platform = platformOf(env);
  const tried: string[] = [];

  if (options.exePath !== undefined && options.cliJsPath !== undefined) {
    tried.push(`argument exe: ${options.exePath}`, `argument cli: ${options.cliJsPath}`);
    if (await fs.exists(options.exePath) && (await fs.exists(options.cliJsPath))) {
      return ok({ exe: options.exePath, cliJs: options.cliJsPath, source: "argument", tried });
    }
    return err({
      code: "prerequisite",
      message: "the --dsh-exe/--dsh-cli-js paths do not both exist",
      hint: `exe=${options.exePath}; cli=${options.cliJsPath}`,
      details: { tried },
    });
  }

  let exe: string | null = options.exePath ?? null;
  let cliJs: string | null = options.cliJsPath ?? null;
  let source: DiscoveredDsh["source"] | null = null;

  if (exe === null) {
    const fromEnv = env.get("DSH_EXE");
    if (fromEnv !== undefined) {
      tried.push(`env DSH_EXE: ${fromEnv}`);
      if (await fs.exists(fromEnv)) {
        exe = fromEnv;
        source = "environment";
      }
    }
  }
  if (cliJs === null) {
    const fromEnv = env.get("DSH_CLI_JS");
    if (fromEnv !== undefined) {
      tried.push(`env DSH_CLI_JS: ${fromEnv}`);
      if (await fs.exists(fromEnv)) {
        cliJs = fromEnv;
        source = source ?? "environment";
      }
    }
  }

  // One fact may be enough to derive the other: the layout is stable.
  if (exe !== null && cliJs === null) {
    const derived = cliCandidatesForExe(exe, platform);
    tried.push(...derived.map((candidate) => `derived cli: ${candidate}`));
    cliJs = await firstExisting(fs, derived);
  }
  if (cliJs !== null && exe === null) {
    const derived = exeCandidatesForCli(cliJs, platform);
    tried.push(...derived.map((candidate) => `derived exe: ${candidate}`));
    exe = await firstExisting(fs, derived);
  }

  if (exe === null || cliJs === null) {
    const installDirs = [...(options.extraInstallDirs ?? []), ...conventionalExecutables(env, platform)];
    const exeCandidates = installDirs.map((dir) => (dir.toLowerCase().endsWith(".exe") ? dir : joinFsPath(dir, EXE_NAME)));
    tried.push(...exeCandidates.map((candidate) => `conventional exe: ${candidate}`));
    const foundExe = await firstExisting(fs, exeCandidates);
    if (foundExe !== null) {
      exe = foundExe;
      source = source ?? "conventional";
      const derived = cliCandidatesForExe(foundExe, platform);
      tried.push(...derived.map((candidate) => `derived cli: ${candidate}`));
      cliJs = cliJs ?? (await firstExisting(fs, derived));
    }
  }

  if (exe === null || cliJs === null) {
    return err({
      code: "prerequisite",
      message: exe === null ? "could not find the DSH executable" : "found the DSH executable but not its CLI entry",
      hint:
        exe === null
          ? "pass --dsh-exe, or set DSH_EXE to the desktop binary"
          : "pass --dsh-cli-js, or set DSH_CLI_JS to resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js",
      details: { tried },
    });
  }

  return ok({ exe, cliJs, source: source ?? "conventional", tried });
}
