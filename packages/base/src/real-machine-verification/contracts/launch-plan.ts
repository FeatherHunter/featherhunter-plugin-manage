/**
 * Launch planning: the pure decision of *what* an isolated instance is.
 *
 * Planning writes nothing and starts nothing. That split is what makes
 * `--dry-run` honest (it prints the plan the real run then executes) and what
 * lets a test assert on the exact argv, environment and log locations without a
 * machine. Everything here is a pure function of its inputs.
 *
 * Three properties are load-bearing:
 *
 * 1. **Isolation is three redirects, not one.** `DSH_HOME` isolates profiles and
 *    storage; `USERPROFILE`/`HOME` isolate the plugin's own settings file; the
 *    working directory isolates its cache and log directory. Miss the second and
 *    an "isolated" run rewrites the developer's real plugin settings.
 * 2. **The environment is an allowlist.** A launched instance receives a small
 *    base set plus declared values plus the resolved model secret — never the
 *    parent environment, which on a developer machine contains unrelated keys
 *    that quietly change results.
 * 3. **The token URL is the readiness signal.** The host prints one line with the
 *    port and a 43-character token; anything else (a listening port, a log line)
 *    is a guess. If the line never appears, the instance never became usable.
 */
import type { ProfileName } from "./branding";
import { err, ok, type Result } from "./result";

/** Where the DSH executable and its asar CLI entry live. */
export interface DshRuntimePaths {
  readonly exe: string;
  readonly cliJs: string;
}

/** The model this instance should use. `secretValue` never gets serialized. */
export interface LaunchModelPlan {
  readonly provider: string;
  readonly model: string;
  /** Name of the credential reference, e.g. `MINIMAX_CN_API_KEY`. */
  readonly apiKeyEnv: string;
  /** Resolved credential, merged into the child env only. */
  readonly secretValue: string;
  readonly source: "batch-home-store" | "real-home-store" | "process-env";
}

/** An already-parsed instance environment file (see the runtime's allowlist reader). */
export interface InstanceEnvFile {
  readonly path: string;
  readonly values: Readonly<Record<string, string>>;
  readonly names: readonly string[];
  readonly secretNames: readonly string[];
}

export interface LaunchRequest {
  readonly profile: ProfileName;
  /** Isolated DSH home, absolute. */
  readonly home: string;
  /** Redirected `USERPROFILE`/`HOME`, absolute. */
  readonly userprofile: string;
  /** Instance working directory (holds the plugin cache), absolute; also the child process's cwd. */
  readonly startCwd: string;
  /**
   * Where the instance stdout/stderr files are written. Defaults to `startCwd`;
   * the launch orchestrator points it at the instance directory so logs survive
   * next to `instance.json` even when the working directory is cleaned.
   */
  readonly logDir?: string;
  /** Cache directory the plugin writes under `startCwd`; `logs` lives inside it. */
  readonly pluginCacheDir?: string;
  readonly runtime: DshRuntimePaths;
  /** `0` asks the host for an ephemeral port; that is the default. */
  readonly port?: number;
  readonly envFile?: InstanceEnvFile;
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** Profile-declared extra variable names the instance may inherit. */
  readonly instanceEnvAllowlist?: readonly string[];
  readonly model?: LaunchModelPlan | null;
  /** Parent environment to draw allowlisted values from. Defaults to `{}`. */
  readonly baseEnv?: Readonly<Record<string, string>>;
}

export interface LaunchLogFiles {
  /** Instance stdout: the token URL is printed here. */
  readonly stdout: string;
  /** Instance stderr: the first useful sentence after an early exit. */
  readonly stderr: string;
  /** `<startCwd>/<pluginCacheDir>/logs`, or `null` when the plugin declares none. */
  readonly pluginLogDir: string | null;
}

export interface LaunchPlan {
  readonly profile: ProfileName;
  readonly home: string;
  readonly userprofile: string;
  readonly cwd: string;
  readonly port: number;
  readonly argv: readonly string[];
  /** The complete child environment. Serialize only after redacting secrets. */
  readonly env: Readonly<Record<string, string>>;
  /** Every variable the tool put into the child env, sorted. */
  readonly envNames: readonly string[];
  /** Subset of `envNames` whose values are secrets and must never be printed. */
  readonly secretEnvNames: readonly string[];
  readonly logFiles: LaunchLogFiles;
  readonly tokenUrlPattern: RegExp;
  /** Human-readable decisions worth surfacing in a plan or a report. */
  readonly notes: readonly string[];
}

/** The one line the host prints when it is ready. Capture the port and token from it. */
export const TOKEN_URL_PATTERN = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([^\s"'<>]+)/;

/** Default port: let the OS choose, so concurrent instances cannot collide. */
export const DEFAULT_PORT = 0;

/**
 * Variables a child may inherit from the parent. Everything else is dropped.
 * Kept short on purpose: PATH-like plumbing only, plus locale and temp dirs.
 */
export const BASE_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "windir",
  "ComSpec",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
];

/** Variables the tool always sets for an instance, regardless of the profile. */
export const FIXED_INSTANCE_ENV_NAMES: readonly string[] = [
  "ELECTRON_RUN_AS_NODE",
  "DSH_HOME",
  "USERPROFILE",
  "HOME",
];

function invalid(message: string, hint?: string): Result<never> {
  return err({ code: "invalid-input", message, ...(hint === undefined ? {} : { hint }) });
}

/** Absolute on either platform, without importing `node:path` into a pure contract. */
export function isAbsolutePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/")) return true;
  return /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Build the child environment: allowlisted base values, then the fixed isolation
 * variables, then the declared values, then the model secret — later layers win.
 * The last write wins on purpose: an explicit request must beat an inherited value.
 */
export function buildLaunchEnv(
  request: LaunchRequest,
): Result<Readonly<Record<string, string>>> {
  const base = request.baseEnv ?? {};
  const env: Record<string, string> = {};

  for (const name of BASE_ENV_ALLOWLIST) {
    const value = base[name];
    if (value !== undefined) env[name] = value;
  }
  for (const name of request.instanceEnvAllowlist ?? []) {
    const value = base[name];
    if (value !== undefined) env[name] = value;
  }

  env.ELECTRON_RUN_AS_NODE = "1";
  env.DSH_HOME = request.home;
  env.USERPROFILE = request.userprofile;
  env.HOME = request.userprofile;

  for (const [name, value] of Object.entries(request.envFile?.values ?? {})) {
    env[name] = value;
  }
  for (const [name, value] of Object.entries(request.extraEnv ?? {})) {
    env[name] = value;
  }
  if (request.model) {
    env[request.model.apiKeyEnv] = request.model.secretValue;
  }

  return ok(Object.freeze(env));
}

/** Compute the plan. No I/O: an unwritable home is a *preflight* failure, not a plan failure. */
export function planLaunch(request: LaunchRequest): Result<LaunchPlan> {
  if (!isAbsolutePath(request.home)) {
    return invalid(`home must be an absolute path, got ${JSON.stringify(request.home)}`);
  }
  if (!isAbsolutePath(request.userprofile)) {
    return invalid(`userprofile must be an absolute path, got ${JSON.stringify(request.userprofile)}`);
  }
  if (!isAbsolutePath(request.startCwd)) {
    return invalid(`startCwd must be an absolute path, got ${JSON.stringify(request.startCwd)}`);
  }
  if (request.logDir !== undefined && !isAbsolutePath(request.logDir)) {
    return invalid(`logDir must be an absolute path, got ${JSON.stringify(request.logDir)}`);
  }
  if (!isAbsolutePath(request.runtime.exe)) {
    return invalid(`runtime.exe must be an absolute path, got ${JSON.stringify(request.runtime.exe)}`);
  }
  if (!isAbsolutePath(request.runtime.cliJs)) {
    return invalid(`runtime.cliJs must be an absolute path, got ${JSON.stringify(request.runtime.cliJs)}`);
  }

  const port = request.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return invalid(`port must be an integer between 0 and 65535, got ${String(port)}`);
  }

  const env = buildLaunchEnv(request);
  if (!env.ok) return env;

  const envNames = Object.keys(env.value).sort();
  const secretEnvNames = new Set<string>();
  if (request.model) secretEnvNames.add(request.model.apiKeyEnv);
  for (const name of request.envFile?.secretNames ?? []) secretEnvNames.add(name);

  const logDirectory = pluginLogDirectory(request);
  const notes: string[] = [];
  if (secretEnvNames.size > 0) {
    notes.push(`injected ${secretEnvNames.size} secret variable(s): ${[...secretEnvNames].join(", ")}`);
  }
  if (request.model) {
    notes.push(
      `model ${request.model.provider}/${request.model.model} via ${request.model.apiKeyEnv} (from ${request.model.source})`,
    );
  }
  if (port === 0) {
    notes.push("port 0: the host chooses an ephemeral port, so concurrent instances cannot collide");
  }
  notes.push(`executable ${request.runtime.exe} (asar entry ${request.runtime.cliJs})`);

  const plan: LaunchPlan = {
    profile: request.profile,
    home: request.home,
    userprofile: request.userprofile,
    cwd: request.startCwd,
    port,
    // argv[0] is the executable itself: the process port spawns argv[0] and
    // passes the rest as arguments. The host CLI entry runs under
    // `--expose-internals` because it is an Electron main-process module.
    argv: [request.runtime.exe, "--expose-internals", request.runtime.cliJs, "--profile", request.profile, "--port", String(port), "--no-open"],
    env: env.value,
    envNames,
    secretEnvNames: [...secretEnvNames].sort(),
    logFiles: {
      stdout: joinPath(request.logDir ?? request.startCwd, "instance.stdout.log"),
      stderr: joinPath(request.logDir ?? request.startCwd, "instance.stderr.log"),
      pluginLogDir: logDirectory,
    },
    tokenUrlPattern: TOKEN_URL_PATTERN,
    notes,
  };
  return ok(plan);
}

/** `<startCwd>/<pluginCacheDir>/logs` — the directory a plugin writes JSONL events into. */
function pluginLogDirectory(request: LaunchRequest): string | null {
  if (request.pluginCacheDir === undefined) return null;
  return joinPath(request.startCwd, request.pluginCacheDir, "logs");
}

/** Minimal join so this contract stays free of `node:path`. */
export function joinPath(...segments: readonly string[]): string {
  const parts = segments.filter((segment) => segment.length > 0);
  if (parts.length === 0) return "";
  const [first, ...rest] = parts;
  const head = first.replace(/[\\/]+$/, "");
  const tail = rest.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, "")).filter((segment) => segment.length > 0);
  const separator = head.includes("\\") || /^[A-Za-z]:/.test(head) ? "\\" : "/";
  return [head, ...tail].join(separator);
}

/** A parsed readiness line. */
export interface ReadyUrl {
  readonly url: string;
  readonly port: number;
  readonly token: string;
}

/** Parse the host's readiness line. Returns `null` when this line is not it. */
export function parseReadyUrl(line: string): ReadyUrl | null {
  const match = TOKEN_URL_PATTERN.exec(line);
  if (match === null) return null;
  const port = Number.parseInt(match[1], 10);
  if (!Number.isInteger(port) || port <= 0) return null;
  return { url: match[0], port, token: match[2] };
}

/** The origin of a readiness URL, for later HTTP calls. */
export function originOf(ready: ReadyUrl): string {
  return `http://127.0.0.1:${ready.port}`;
}
