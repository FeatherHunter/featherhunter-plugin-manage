/**
 * Ports: every effect this capability performs, expressed as a narrow interface.
 *
 * The rules and the orchestration must be testable without a machine, a browser
 * or a network, and the same code must run on three platforms. Both goals are
 * met the same way: the impure half is collected behind these interfaces, and
 * the runtime supplies real implementations while tests supply fakes.
 *
 * Two consequences worth stating explicitly:
 *
 * - There is no `browser` import anywhere in this package. Browsers are plugin
 *   shaped (a plugin may use Playwright, Puppeteer, or nothing at all), so the
 *   tool receives a `BrowserProbeFactory` from the repository it verifies. When
 *   none is injected, the browser checks report `blocked` — never a false `fail`.
 * - `EnvPort.snapshot()` returns the parent environment, but nothing hands it to
 *   a child wholesale: `planLaunch` copies only an allowlist plus declared
 *   values, so a stray `MINIMAX_CN_API_KEY` on the verifying machine cannot leak
 *   into an instance or change a result.
 */
import type { Sha256Hex } from "./branding";
import type { Result } from "./result";

/* ------------------------------------------------------------------ commands */

/** One finished external command. A non-zero exit is data, not an error. */
export interface CommandOutcome {
  readonly argv: readonly string[];
  readonly cwd: string;
  /** `null` when a signal terminated the process. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** True when the timeout killed the process, so `exitCode` says nothing useful. */
  readonly timedOut: boolean;
}

/** What to run. The caller owns argv; no shell string is ever interpreted. */
export interface CommandRequest {
  readonly argv: readonly string[];
  readonly cwd?: string;
  /** Full environment for the child. Build it with `buildLaunchEnv` or explicit copies. */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Keep the *tail* of stdout/stderr beyond this budget (default 2 MiB per stream). */
  readonly maxBufferBytes?: number;
  readonly stdin?: string;
}

export interface CommandPort {
  /** Spawn and wait. `err` only when the command could not be started at all. */
  run(request: CommandRequest): Promise<Result<CommandOutcome>>;
}

/* --------------------------------------------------------------------- files */

export type FileKind = "file" | "directory" | "symlink" | "other";

export interface FileStat {
  readonly kind: FileKind;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface DirEntry {
  readonly name: string;
  readonly kind: FileKind;
}

export interface CopyOutcome {
  readonly files: number;
  readonly bytes: number;
}

/**
 * The filesystem, narrowed to what a check actually needs.
 *
 * Every method returns `Result` instead of throwing, because "the file is not
 * there" is an ordinary observation in this domain and a stack trace destroys
 * the distinction between "missing" and "the tool is broken".
 */
export interface FsPort {
  readText(path: string): Promise<Result<string>>;
  writeText(path: string, text: string): Promise<Result<void>>;
  /** Returns the parsed JSON as `unknown`; callers validate the shape they need. */
  readJson(path: string): Promise<Result<unknown>>;
  writeJson(path: string, value: unknown): Promise<Result<void>>;
  readBytes(path: string): Promise<Result<Uint8Array>>;
  hashFile(path: string): Promise<Result<Sha256Hex>>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<Result<FileStat>>;
  list(path: string): Promise<Result<readonly DirEntry[]>>;
  /** Recursive create; succeeds when the directory already exists. */
  makeDir(path: string): Promise<Result<void>>;
  remove(path: string, options?: { readonly recursive?: boolean }): Promise<Result<void>>;
  copy(from: string, to: string, options?: { readonly recursive?: boolean }): Promise<Result<CopyOutcome>>;
  move(from: string, to: string): Promise<Result<void>>;
  /**
   * Absolute, symlink-resolved path. Call this before every write outside the
   * work root: the runtime compares the result against an allowlist so a check
   * can never write into a user's real `DSH_HOME`.
   */
  realPath(path: string): Promise<Result<string>>;
}

/* ---------------------------------------------------------------- clock, env */

export interface ClockPort {
  nowMs(): number;
  /** ISO-8601 with the local offset, e.g. `2026-11-01T18:47:52+08:00`. */
  iso(ms?: number): string;
  sleep(ms: number): Promise<void>;
}

/** Only the three platforms we distinguish; anything else is `other`. */
export type PlatformName = "win32" | "darwin" | "linux" | "other";

export interface EnvPort {
  get(name: string): string | undefined;
  /** The parent environment. Never hand this to a child as-is; use `planLaunch`. */
  snapshot(): Readonly<Record<string, string>>;
  homeDir(): string;
  tmpDir(): string;
  platform(): PlatformName;
  /** Absolute path of the Node executable running the tool (for npm-cli resolution). */
  execPath(): string;
  /** Working directory of the tool process — *not* of a launched instance. */
  cwd(): string;
}

/* ------------------------------------------------------------------ processes */

export interface SpawnRequest {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** Startup stdout/stderr files; the runtime creates them before spawning. */
  readonly stdoutPath: string;
  readonly stderrPath: string;
  /** Detached processes survive the CLI exiting — required for launched instances. */
  readonly detached: boolean;
  readonly windowsHide: boolean;
}

export interface SpawnedProcess {
  readonly pid: number;
  readonly stdoutPath: string;
  readonly stderrPath: string;
}

export interface KillOutcome {
  /** True when this call killed it; false when it was already gone. */
  readonly killed: boolean;
  readonly alreadyGone: boolean;
}

export interface ProcessPort {
  spawnDetached(request: SpawnRequest): Promise<Result<SpawnedProcess>>;
  isAlive(pid: number): boolean;
  /** Kill the whole tree: `taskkill /T /F` on Windows, process group on POSIX. */
  killTree(pid: number, options?: { readonly timeoutMs?: number }): Promise<Result<KillOutcome>>;
}

/* ---------------------------------------------------------------------- http */

export interface HttpRequest {
  readonly url: string;
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
  /** Redirect following defaults to false: a token redirect is a signal, not a detour. */
  readonly followRedirects?: boolean;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Raw `Set-Cookie` values, so a caller can keep a session without a cookie jar. */
  readonly setCookie: readonly string[];
}

export interface HttpPort {
  request(request: HttpRequest): Promise<Result<HttpResponse>>;
}

/* ------------------------------------------------------------------- browsers */

/**
 * One page. The surface is deliberately the intersection of Playwright, Puppeteer
 * and raw CDP, because the plugin repository owns the adapter.
 */
export interface BrowserPageHandle {
  url(): string;
  /** Evaluate a serializable expression in the page and return its value. */
  evaluate<TResult>(script: string): Promise<Result<TResult>>;
  /** Layout viewport, in CSS pixels. */
  innerSize(): Promise<Result<{ readonly width: number; readonly height: number }>>;
  /** Actual window size, in CSS pixels — the only honest source for a fullscreen claim. */
  outerSize(): Promise<Result<{ readonly width: number; readonly height: number }>>;
  text(selector: string): Promise<Result<string | null>>;
  screenshot(path: string, options?: { readonly fullPage?: boolean }): Promise<Result<{ readonly bytes: number }>>;
  /** Uncaught page errors observed since the page opened, oldest first. */
  pageErrors(): readonly string[];
  close(): Promise<void>;
}

export interface BrowserSessionHandle {
  /** A new isolated context/page. Two instances must never share one. */
  newPage(): Promise<Result<BrowserPageHandle>>;
  close(): Promise<void>;
}

/** Implemented in the plugin repository (`verify/browser.ts`) and injected. */
export interface BrowserProbeFactory {
  launch(options: { readonly headless: boolean }): Promise<Result<BrowserSessionHandle>>;
}

/* -------------------------------------------------------------------- screens */

export interface ScreenInfo {
  readonly id: string;
  readonly primary: boolean;
  readonly width: number;
  readonly height: number;
}

export interface ScreenPort {
  /**
   * Physical screens as the window manager reports them. A headless machine
   * returns an empty list; the `screen-present` check turns that into `blocked`.
   */
  screens(): Promise<Result<readonly ScreenInfo[]>>;
}

/* ------------------------------------------------------------------ aggregate */

/** Everything the runtime needs. `browser` is `null` when the repository ships no adapter. */
export interface Ports {
  readonly fs: FsPort;
  readonly command: CommandPort;
  readonly process: ProcessPort;
  readonly http: HttpPort;
  readonly clock: ClockPort;
  readonly env: EnvPort;
  readonly screen: ScreenPort;
  readonly browser: BrowserProbeFactory | null;
}
