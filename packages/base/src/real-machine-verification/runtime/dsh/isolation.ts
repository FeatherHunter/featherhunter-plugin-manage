/**
 * Proving that plugin settings are isolated — not that an environment variable
 * was set, but that a real child process resolves its home inside a redirected
 * directory and that the plugin's real settings file is byte-identical after.
 *
 * The probe is intentionally blunt: it starts one `node -e` child with
 * USERPROFILE/HOME/DSH_HOME pointing at a throwaway directory, lets the child
 * write and read back a fixed marker file, and compares the sha256 of the real
 * settings file before and after. It never reads or prints the real settings
 * content — only existence and hashes cross that boundary.
 */
import { BASE_ENV_ALLOWLIST } from "../../contracts/launch-plan";
import type { EnvPort, FsPort, Ports } from "../../contracts/ports";
import { ok, type Result } from "../../contracts/result";
import { joinFsPath, samePath } from "../paths";

/** The exact bytes the probe child writes under the redirected home. */
export const PROBE_MARKER_CONTENT = `${JSON.stringify({
  schemaVersion: 1,
  probe: "dsh-verify-settings-isolation",
  marker: "isolated",
})}\n`;

/** A hung child must not hang the whole verification run. */
export const DEFAULT_PROBE_TIMEOUT_MS = 60_000;

/** One concrete reason the probe cannot claim settings isolation. */
export type IsolationProblemCode =
  | "probe-exit"
  | "probe-output"
  | "child-home"
  | "marker-write"
  | "marker-readback"
  | "marker-missing"
  | "marker-hash"
  | "real-settings-changed"
  | "real-settings-unreadable";

export interface IsolationProblem {
  readonly code: IsolationProblemCode;
  readonly message: string;
}

/** Existence plus hash; `sha256` is null when the file could not be read. */
export interface SettingsFingerprint {
  readonly path: string;
  readonly existed: boolean;
  readonly sha256: string | null;
  /** Why the hash could not be computed, when `existed` is true and `sha256` is null. */
  readonly readError: string | null;
}

/** The JSON object the probe child prints as the last line of its stdout. */
export interface ChildProbeReport {
  readonly home: string | null;
  readonly markerPath: string | null;
  readonly wrote: boolean;
  readonly readBack: boolean;
  readonly bytes: number | null;
  readonly sha256: string | null;
}

export interface IsolationProbePaths {
  readonly probeRoot: string;
  readonly redirectedHome: string;
  readonly workdir: string;
}

/** The three directories a probe run owns, all under the work root. */
export function isolationProbePaths(workRoot: string, probeId: string): IsolationProbePaths {
  const probeRoot = joinFsPath(workRoot, "isolation", probeId);
  return {
    probeRoot,
    redirectedHome: joinFsPath(probeRoot, "userprofile"),
    workdir: joinFsPath(probeRoot, "workdir"),
  };
}

/**
 * The real settings file of the plugin under verification.
 *
 * It is `<user home>/.dsh/<pluginSettingsDir>/settings.yaml`, deliberately not
 * derived from DSH_HOME: DSH_HOME is configurable and may point somewhere else,
 * while this file is the one a user's real plugin instance reads and writes.
 */
export function realSettingsFilePath(realHome: string, pluginSettingsDir: string): string {
  return joinFsPath(realHome, ".dsh", pluginSettingsDir, "settings.yaml");
}

export interface IsolationProbeOptions {
  readonly ports: Ports;
  readonly probeRoot: string;
  readonly pluginSettingsDir: string;
  readonly realHome: string;
  readonly redirectedHome: string;
  readonly workdir: string;
  readonly timeoutMs?: number;
}

export interface SettingsIsolationResult {
  readonly ok: boolean;
  readonly probeRoot: string;
  readonly redirectedHome: string;
  readonly workdir: string;
  readonly realSettings: SettingsFingerprint;
  readonly realSettingsAfter: SettingsFingerprint;
  readonly realSettingsUnchanged: boolean;
  readonly expectedMarkerPath: string;
  readonly markerPresent: boolean;
  readonly markerSha256: string | null;
  /** The child's report; `reported:false` means it printed no parsable JSON line. */
  readonly child: ChildProbeReport;
  readonly reported: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly problems: readonly IsolationProblem[];
  /** The redirect handed to the child, for evidence and failure messages. */
  readonly redirectEnv: Readonly<Record<"USERPROFILE" | "HOME" | "DSH_HOME", string>>;
  readonly envNames: readonly string[];
  /** argv with the script body replaced, so a report never embeds the whole script. */
  readonly argv: readonly string[];
  /** Tail of the child streams, for evidence. Paths and errors only; never settings content. */
  readonly stdout: string;
  readonly stderr: string;
}

/** The `node -e` body: resolve home, write, read back, hash, print one JSON line. */
function probeScript(pluginSettingsDir: string): string {
  const dirLiteral = JSON.stringify(pluginSettingsDir);
  const contentLiteral = JSON.stringify(PROBE_MARKER_CONTENT);
  return [
    "const os=require('os'),fs=require('fs'),path=require('path'),crypto=require('crypto');",
    `const content=${contentLiteral};`,
    "const home=os.homedir();",
    `const marker=path.join(home,'.dsh',${dirLiteral},'settings.yaml');`,
    "let wrote=false,readBack=false,bytes=0,sha256=null;",
    "try{",
    "fs.mkdirSync(path.dirname(marker),{recursive:true});",
    "fs.writeFileSync(marker,content);",
    "wrote=true;",
    "const back=fs.readFileSync(marker,'utf8');",
    "readBack=back===content;",
    "bytes=Buffer.byteLength(back);",
    "sha256=crypto.createHash('sha256').update(back).digest('hex');",
    "console.log(JSON.stringify({home,markerPath:marker,wrote,readBack,bytes,sha256}));",
    "}catch(error){",
    "process.exitCode=1;",
    "console.log(JSON.stringify({home,markerPath:marker,wrote,readBack,bytes,sha256,error:String((error&&error.message)||error)}));",
    "}",
  ].join("");
}

/**
 * The child environment: an allowlist of harmless system variables plus the
 * redirect. Nothing else from the parent is copied, so a secret in the parent
 * environment cannot reach the probe child or leak into a report.
 */
function buildProbeEnv(
  parent: Readonly<Record<string, string>>,
  redirectedHome: string,
): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const name of BASE_ENV_ALLOWLIST) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  env["USERPROFILE"] = redirectedHome;
  env["HOME"] = redirectedHome;
  env["DSH_HOME"] = joinFsPath(redirectedHome, ".dsh");
  return env;
}

async function fingerprint(fs: FsPort, path: string): Promise<SettingsFingerprint> {
  if (!(await fs.exists(path))) return { path, existed: false, sha256: null, readError: null };
  const hashed = await fs.hashFile(path);
  if (!hashed.ok) {
    return { path, existed: true, sha256: null, readError: hashed.error.message };
  }
  return { path, existed: true, sha256: hashed.value, readError: null };
}

function describeFingerprint(value: SettingsFingerprint): string {
  if (!value.existed) return "absent";
  return value.sha256 === null ? "existed, unreadable" : `existed, sha256 ${value.sha256}`;
}

/** Absent stays absent, present keeps the same bytes — never `null === null` as a pass. */
function fingerprintsMatch(before: SettingsFingerprint, after: SettingsFingerprint): boolean {
  if (before.existed !== after.existed) return false;
  if (!before.existed) return true;
  return before.sha256 !== null && before.sha256 === after.sha256;
}

/** Parse the child's last stdout line into a report; null when it printed nothing usable. */
function parseProbeStdout(stdout: string): ChildProbeReport | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(lastLine);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const home = record["home"];
  const markerPath = record["markerPath"];
  const bytes = record["bytes"];
  const sha256 = record["sha256"];
  return {
    home: typeof home === "string" ? home : null,
    markerPath: typeof markerPath === "string" ? markerPath : null,
    wrote: record["wrote"] === true,
    readBack: record["readBack"] === true,
    bytes: typeof bytes === "number" && Number.isFinite(bytes) ? bytes : null,
    sha256: typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256) ? sha256 : null,
  };
}

function tail(text: string, limit = 2_000): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(trimmed.length - limit);
}


/** Everything a probe would run, described without creating a directory or spawning. */
export interface SettingsIsolationPlan {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly envNames: readonly string[];
  readonly timeoutMs: number;
  readonly markerPath: string;
  readonly realSettingsPath: string;
}

/**
 * Describe the probe command a real run would execute.
 *
 * Read-only: the script body stays in `argv` (the same value a report records),
 * and the environment is computed from the parent snapshot exactly as
 * `probeSettingsIsolation` does, so `--dry-run` prints what the child gets.
 */
export function planSettingsIsolation(options: {
  readonly env: EnvPort;
  readonly pluginSettingsDir: string;
  readonly realHome: string;
  readonly redirectedHome: string;
  readonly workdir: string;
  readonly timeoutMs?: number;
}): SettingsIsolationPlan {
  const { env, pluginSettingsDir, realHome, redirectedHome, workdir } = options;
  const probeEnv = buildProbeEnv(env.snapshot(), redirectedHome);
  return {
    argv: [env.execPath(), "-e", "<probe script>"],
    cwd: workdir,
    env: probeEnv,
    envNames: Object.keys(probeEnv).sort(),
    timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    markerPath: joinFsPath(redirectedHome, ".dsh", pluginSettingsDir, "settings.yaml"),
    realSettingsPath: realSettingsFilePath(realHome, pluginSettingsDir),
  };
}

/**
 * Run one isolation probe.
 *
 * Order matters: the real settings fingerprint is taken *before* anything is
 * created or started, so a crash mid-probe still leaves an honest "before" to
 * compare against on the next run.
 */
export async function probeSettingsIsolation(
  options: IsolationProbeOptions,
): Promise<Result<SettingsIsolationResult>> {
  const { ports, probeRoot, pluginSettingsDir, realHome, redirectedHome, workdir } = options;
  const { fs, command, env } = ports;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const realSettingsPath = realSettingsFilePath(realHome, pluginSettingsDir);
  const before = await fingerprint(fs, realSettingsPath);

  for (const directory of [probeRoot, redirectedHome, workdir]) {
    const made = await fs.makeDir(directory);
    if (!made.ok) return made;
  }

  const probeEnv = buildProbeEnv(env.snapshot(), redirectedHome);
  const script = probeScript(pluginSettingsDir);
  const run = await command.run({
    argv: [env.execPath(), "-e", script],
    cwd: workdir,
    env: probeEnv,
    timeoutMs,
  });
  if (!run.ok) return run;
  const outcome = run.value;

  const after = await fingerprint(fs, realSettingsPath);

  const expectedMarkerPath = joinFsPath(redirectedHome, ".dsh", pluginSettingsDir, "settings.yaml");
  const markerPresent = await fs.exists(expectedMarkerPath);
  let markerSha256: string | null = null;
  let markerReadError: string | null = null;
  if (markerPresent) {
    const hashed = await fs.hashFile(expectedMarkerPath);
    if (hashed.ok) markerSha256 = hashed.value;
    else markerReadError = hashed.error.message;
  }

  const child = parseProbeStdout(outcome.stdout);
  const problems: IsolationProblem[] = [];

  if (outcome.timedOut) {
    problems.push({ code: "probe-exit", message: `the probe child did not exit within ${String(timeoutMs)}ms` });
  } else if (outcome.exitCode !== 0) {
    problems.push({ code: "probe-exit", message: `the probe child exited with code ${String(outcome.exitCode)}` });
  }

  if (child === null) {
    problems.push({ code: "probe-output", message: "the probe child did not print one JSON line on stdout" });
  } else {
    if (child.home === null) {
      problems.push({ code: "probe-output", message: "the probe child's JSON line did not report a home directory" });
    } else if (!samePath(child.home, redirectedHome)) {
      problems.push({
        code: "child-home",
        message: `the child resolved its home to ${child.home}, not the redirected ${redirectedHome}`,
      });
    }
    if (!child.wrote) {
      problems.push({ code: "marker-write", message: `the child could not write the marker file under ${redirectedHome}` });
    }
    if (!child.readBack) {
      problems.push({ code: "marker-readback", message: "the child could not read back the bytes it wrote" });
    }
    if (!markerPresent) {
      problems.push({ code: "marker-missing", message: `no marker file at ${expectedMarkerPath} after the child exited` });
    } else if (markerSha256 === null) {
      const reason = markerReadError === null ? "" : `: ${markerReadError}`;
      problems.push({ code: "marker-hash", message: `the marker file at ${expectedMarkerPath} could not be hashed${reason}` });
    } else if (child.sha256 === null || child.sha256 !== markerSha256) {
      problems.push({
        code: "marker-hash",
        message: `the marker file at ${expectedMarkerPath} hashes to ${markerSha256}, but the child read back ${child.sha256 ?? "(no sha256)"}`,
      });
    }
  }

  const realSettingsUnchanged = fingerprintsMatch(before, after);
  if (before.existed && before.sha256 === null) {
    const reason = before.readError === null ? "" : `: ${before.readError}`;
    problems.push({
      code: "real-settings-unreadable",
      message: `could not hash the real settings file ${realSettingsPath} before the probe${reason}`,
    });
  } else if (after.existed && after.sha256 === null) {
    const reason = after.readError === null ? "" : `: ${after.readError}`;
    problems.push({
      code: "real-settings-unreadable",
      message: `could not hash the real settings file ${realSettingsPath} after the probe${reason}`,
    });
  } else if (!realSettingsUnchanged) {
    problems.push({
      code: "real-settings-changed",
      message: `the real settings file ${realSettingsPath} changed while the probe ran (before: ${describeFingerprint(before)}, after: ${describeFingerprint(after)})`,
    });
  }

  return ok({
    ok: problems.length === 0,
    probeRoot,
    redirectedHome,
    workdir,
    realSettings: before,
    realSettingsAfter: after,
    realSettingsUnchanged,
    expectedMarkerPath,
    markerPresent,
    markerSha256,
    child: child ?? { home: null, markerPath: null, wrote: false, readBack: false, bytes: null, sha256: null },
    reported: child !== null,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    problems: Object.freeze(problems),
    redirectEnv: Object.freeze({
      USERPROFILE: redirectedHome,
      HOME: redirectedHome,
      DSH_HOME: joinFsPath(redirectedHome, ".dsh"),
    }),
    envNames: Object.freeze(Object.keys(probeEnv).sort()),
    argv: Object.freeze([env.execPath(), "-e", "<probe script>"]),
    stdout: tail(outcome.stdout),
    stderr: tail(outcome.stderr),
  });
}