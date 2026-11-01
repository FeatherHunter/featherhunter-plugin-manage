/**
 * Reference browser adapter over the Chrome DevTools Protocol.
 *
 * This file is deliberately **not** re-exported by
 * `real-machine-verification/index.ts` and is not imported by any bundle entry.
 * The core package must build and install without a browser library; an adapter
 * is the plugin repository's dependency, not the capability's. This file is a
 * reference implementation, not a published entry point: it is source-only and
 * never appears in `dist`. Vendor it into the plugin repository (for example
 * `verify/cdp-adapter.ts`, together with the two `contracts` modules its
 * relative imports name) and declare a thin wrapper in `verify/profile.ts`:
 *
 *   browser: { module: "verify/browser.mjs" }
 *
 *   // verify/browser.mjs
 *   export { createCdpBrowserFactory as default } from "./cdp-adapter.js";
 *
 * Requirements: Node 22 or newer (global `WebSocket`; `fetch` is not needed),
 * Chromium/Chrome or Edge 120+ (`Browser.setWindowBounds` with
 * `windowState: "fullscreen"`). Zero npm dependencies: child_process, fs, os,
 * path, Buffer and WebSocket, all built in.
 *
 * The factory accepts injection seams (`launcher`, `transport`) so its unit
 * tests exercise the CDP command sequence without starting a browser:
 *
 *   const factory = createCdpBrowserFactory({
 *     launcher: async () => ({ endpoint: "ws://fake", close: async () => {} }),
 *     transport: fakeTransport,
 *     windowState: "fullscreen",
 *   });
 *
 * Fullscreen is set through the browser's real window state; this adapter never
 * resizes the page to imitate a fullscreen window. Pass `windowState:
 * "fullscreen"` to `createCdpBrowserFactory` when the page check expects it.
 * `setWindowState` is also exposed on the page for L3 callers.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  BrowserPageHandle,
  BrowserProbeFactory,
  BrowserSessionHandle,
} from "../../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../../contracts/result";

/** One JSON-RPC message on the CDP socket. */
interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: string };
  readonly sessionId?: string;
}

interface CdpEventMessage {
  readonly method: string;
  readonly params?: unknown;
  readonly sessionId?: string;
}

/** Handlers a transport delivers; the connection is useless without both. */
export interface CdpHandlers {
  readonly onMessage: (data: string) => void;
  readonly onClose: (reason?: string) => void;
}

/** The minimal socket the client needs; `WebSocketCdpTransport` is the default. */
export interface CdpConnection {
  send(data: string): void;
  close(): void;
}

/** Injectable in tests; the default connects a Node global WebSocket. */
export interface CdpTransport {
  connect(endpoint: string, handlers: CdpHandlers): Promise<CdpConnection>;
}

/** What a launcher must produce: an endpoint plus a way to stop the process. */
export interface CdpLaunchedBrowser {
  readonly endpoint: string;
  close(): Promise<void>;
}

export interface CdpLaunchRequest {
  readonly executablePath: string;
  readonly headless: boolean;
  readonly timeoutMs: number;
  readonly userDataDir: string;
}

/** Injectable in tests; the default spawns a real Chromium/Edge. */
export type CdpLauncher = (request: CdpLaunchRequest) => Promise<CdpLaunchedBrowser>;

/** How the adapter asks the browser to present the window. */
export type CdpWindowState = "normal" | "maximized" | "fullscreen";

export interface CdpAdapterOptions {
  /** Explicit browser binary; otherwise env and platform defaults are tried. */
  readonly executablePath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  /** Applied to every new page through `Browser.setWindowBounds`. */
  readonly windowState?: CdpWindowState;
  /** Launch/connect timeout; default 15000 ms. */
  readonly timeoutMs?: number;
  readonly launcher?: CdpLauncher;
  readonly transport?: CdpTransport;
  /** Only for tests; a real launch always uses a fresh directory. */
  readonly userDataDir?: string;
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The Node WebSocket transport; the only place a browser connection exists. */
class WebSocketCdpTransport implements CdpTransport {
  async connect(endpoint: string, handlers: CdpHandlers): Promise<CdpConnection> {
    const Constructor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (typeof Constructor !== "function") {
      throw new Error("this Node has no global WebSocket; the CDP adapter needs Node 22 or newer");
    }
    const socket = new Constructor(endpoint);
    socket.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      handlers.onMessage(typeof data === "string" ? data : String(data));
    });
    socket.addEventListener("close", () => handlers.onClose());
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`could not connect to ${endpoint}`)), { once: true });
    });
    return {
      send: (data) => socket.send(data),
      close: () => {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
      },
    };
  }
}

interface PendingCommand {
  resolve(value: unknown): void;
  reject(error: Failure): void;
}

/** A tiny JSON-RPC client: one id counter, one pending map, flat sessions. */
class CdpClient {
  private connection: CdpConnection | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly listeners = new Set<(event: CdpEventMessage) => void>();

  readonly handlers: CdpHandlers = {
    onMessage: (data) => this.receive(data),
    onClose: (reason) => this.close(reason ?? "the CDP connection closed"),
  };

  attach(connection: CdpConnection): void {
    this.connection = connection;
  }

  onEvent(listener: (event: CdpEventMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  send<TResult>(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
  ): Promise<Result<TResult>> {
    const connection = this.connection;
    if (connection === null) {
      return Promise.resolve(err(failure("prerequisite", "the CDP connection is not open")));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<Result<TResult>>((resolve) => {
      this.pending.set(id, {
        resolve: (value) => resolve(ok(value as TResult)),
        reject: (error) => resolve(err(error)),
      });
      try {
        connection.send(
          JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
        );
      } catch (error) {
        this.pending.delete(id);
        resolve(err(failure("io", `could not send CDP command ${method}: ${describeThrown(error)}`)));
      }
    });
  }

  close(reason?: string): void {
    const message = reason ?? "the CDP connection closed";
    const connection = this.connection;
    this.connection = null;
    for (const [id, pending] of this.pending) {
      pending.reject(failure("io", `${message} (waiting for response ${id})`));
    }
    this.pending.clear();
    for (const listener of this.listeners) {
      try {
        listener({ method: "CdpClient.closed", params: { reason: message } });
      } catch {
        // A listener must not break the close path.
      }
    }
    if (connection !== null) {
      try {
        connection.close();
      } catch {
        // The socket may already be gone.
      }
    }
  }

  private receive(data: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(data) as CdpMessage;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(
          failure(
            "io",
            `CDP ${message.error.message ?? "command failed"}${message.error.code === undefined ? "" : ` (${message.error.code})`}`,
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method === undefined) return;
    const event: CdpEventMessage = {
      method: message.method,
      params: message.params,
      ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Events are observational; a broken listener must not kill the client.
      }
    }
  }
}

interface CdpExceptionDetails {
  readonly text?: string;
  readonly exception?: { readonly description?: string; readonly value?: unknown };
}

function describeException(params: unknown): string {
  const details = (params as { exceptionDetails?: CdpExceptionDetails } | undefined)?.exceptionDetails;
  const description = details?.exception?.description;
  if (typeof description === "string" && description.length > 0) return description;
  if (typeof details?.text === "string" && details.text.length > 0) return details.text;
  const value = details?.exception?.value;
  return typeof value === "string" ? value : "uncaught page error";
}

interface CdpEvaluateResult {
  readonly result?: { readonly value?: unknown };
  readonly exceptionDetails?: CdpExceptionDetails;
}

function asSize(value: unknown): { readonly width: number; readonly height: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const width = (value as { width?: unknown }).width;
  const height = (value as { height?: unknown }).height;
  if (typeof width !== "number" || typeof height !== "number") return null;
  return { width, height };
}

/** A page handle, plus the L3 extensions this adapter can honestly offer. */
export interface CdpPageHandle extends BrowserPageHandle {
  goto(url: string): Promise<Result<void>>;
  windowState(): Promise<Result<{ readonly state?: string; readonly width?: number; readonly height?: number }>>;
  setWindowState(state: CdpWindowState): Promise<Result<void>>;
}

/** One attached target. Every command carries the flat session id. */
class CdpPage implements CdpPageHandle {
  private currentUrl: string;
  private readonly errors: string[] = [];
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly client: CdpClient,
    private readonly targetId: string,
    private readonly sessionId: string,
    initialUrl: string,
  ) {
    this.currentUrl = initialUrl;
    this.unsubscribe = client.onEvent((event) => this.handleEvent(event));
  }

  /** Enable the domains the handle reads; `Log` is best-effort. */
  async enable(): Promise<Result<void>> {
    const page = await this.client.send("Page.enable", {}, this.sessionId);
    if (!page.ok) return page;
    const runtime = await this.client.send("Runtime.enable", {}, this.sessionId);
    if (!runtime.ok) return runtime;
    await this.client.send("Log.enable", {}, this.sessionId);
    return ok(undefined);
  }

  url(): string {
    return this.currentUrl;
  }

  async evaluate<TResult>(script: string): Promise<Result<TResult>> {
    const response = await this.client.send<CdpEvaluateResult>(
      "Runtime.evaluate",
      { expression: script, returnByValue: true, awaitPromise: true, userGesture: false },
      this.sessionId,
    );
    if (!response.ok) return response;
    if (response.value.exceptionDetails !== undefined) {
      return err(
        failure(
          "invalid-input",
          `the page script threw: ${describeException({ exceptionDetails: response.value.exceptionDetails })}`,
          "the evaluated expression is the check's claim, not the product; inspect the script",
        ),
      );
    }
    return ok((response.value.result?.value ?? null) as TResult);
  }

  async innerSize(): Promise<Result<{ readonly width: number; readonly height: number }>> {
    const read = await this.evaluate<unknown>(
      "({ width: window.innerWidth, height: window.innerHeight })",
    );
    if (!read.ok) return read;
    const size = asSize(read.value);
    if (size === null) return err(failure("internal", "the page did not report a layout viewport"));
    return ok(size);
  }

  async outerSize(): Promise<Result<{ readonly width: number; readonly height: number }>> {
    const read = await this.evaluate<unknown>(
      "({ width: window.outerWidth, height: window.outerHeight })",
    );
    if (!read.ok) return read;
    const size = asSize(read.value);
    if (size === null) return err(failure("internal", "the page did not report a window size"));
    return ok(size);
  }

  async text(selector: string): Promise<Result<string | null>> {
    const expression =
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); ` +
      "return element === null ? null : (element.textContent ?? \"\"); })()";
    const read = await this.evaluate<unknown>(expression);
    if (!read.ok) return read;
    if (read.value === null) return ok(null);
    if (typeof read.value !== "string") {
      return err(failure("internal", `text(${JSON.stringify(selector)}) returned a non-string`));
    }
    return ok(read.value);
  }

  async screenshot(
    path: string,
    options?: { readonly fullPage?: boolean },
  ): Promise<Result<{ readonly bytes: number }>> {
    const captured = await this.client.send<{ readonly data?: string }>(
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: options?.fullPage === true,
      },
      this.sessionId,
    );
    if (!captured.ok) return captured;
    const data = captured.value.data;
    if (typeof data !== "string" || data.length === 0) {
      return err(failure("io", "CDP returned an empty screenshot"));
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0) return err(failure("io", "CDP returned an empty screenshot payload"));
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    } catch (error) {
      return err(failure("io", `could not write the screenshot to ${path}: ${describeThrown(error)}`));
    }
    return ok({ bytes: bytes.length });
  }

  pageErrors(): readonly string[] {
    return [...this.errors];
  }

  async goto(url: string): Promise<Result<void>> {
    const navigated = await this.client.send<{ readonly errorText?: string }>(
      "Page.navigate",
      { url },
      this.sessionId,
    );
    if (!navigated.ok) return navigated;
    if (typeof navigated.value.errorText === "string" && navigated.value.errorText.length > 0) {
      return err(failure("io", navigated.value.errorText, "the browser refused the navigation"));
    }
    this.currentUrl = url;
    return ok(undefined);
  }

  async windowState(): Promise<
    Result<{ readonly state?: string; readonly width?: number; readonly height?: number }>
  > {
    const windowId = await this.windowId();
    if (!windowId.ok) return windowId;
    const bounds = await this.client.send<{
      readonly bounds?: { readonly windowState?: string; readonly width?: number; readonly height?: number };
    }>("Browser.getWindowBounds", { windowId: windowId.value });
    if (!bounds.ok) return bounds;
    return ok({
      ...(typeof bounds.value.bounds?.windowState === "string"
        ? { state: bounds.value.bounds.windowState }
        : {}),
      ...(typeof bounds.value.bounds?.width === "number" ? { width: bounds.value.bounds.width } : {}),
      ...(typeof bounds.value.bounds?.height === "number" ? { height: bounds.value.bounds.height } : {}),
    });
  }

  async setWindowState(state: CdpWindowState): Promise<Result<void>> {
    const windowId = await this.windowId();
    if (!windowId.ok) return windowId;
    const applied = await this.client.send(
      "Browser.setWindowBounds",
      { windowId: windowId.value, bounds: { windowState: state } },
    );
    if (!applied.ok) return applied;
    return ok(undefined);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    await this.client.send("Target.closeTarget", { targetId: this.targetId });
  }

  private async windowId(): Promise<Result<number>> {
    const info = await this.client.send<{ readonly windowId?: number }>("Browser.getWindowForTarget", {
      targetId: this.targetId,
    });
    if (!info.ok) return info;
    if (typeof info.value.windowId !== "number") {
      return err(failure("internal", "CDP did not return a window id for the page"));
    }
    return ok(info.value.windowId);
  }

  private handleEvent(event: CdpEventMessage): void {
    if (event.sessionId !== this.sessionId) return;
    if (event.method === "Page.frameNavigated") {
      const frame = (event.params as { readonly frame?: { readonly url?: string; readonly parentId?: string } } | undefined)?.frame;
      if (frame?.parentId === undefined && typeof frame?.url === "string") this.currentUrl = frame.url;
      return;
    }
    if (event.method === "Runtime.exceptionThrown") {
      this.errors.push(describeException(event.params));
      return;
    }
    if (event.method === "Log.entryAdded") {
      const entry = (event.params as {
        readonly entry?: { readonly level?: string; readonly text?: string; readonly url?: string };
      } | undefined)?.entry;
      if (entry?.level === "error" && typeof entry.text === "string") {
        this.errors.push(entry.url === undefined ? entry.text : `${entry.text} (${entry.url})`);
      }
    }
  }
}

/** One launched browser: pages are targets; close reaps the process. */
class CdpSession implements BrowserSessionHandle {
  private readonly pages = new Set<CdpPage>();
  private closed = false;

  constructor(
    private readonly client: CdpClient,
    private readonly launched: CdpLaunchedBrowser,
    private readonly windowState: CdpWindowState,
  ) {}

  async newPage(): Promise<Result<BrowserPageHandle>> {
    const created = await this.client.send<{ readonly targetId?: string }>("Target.createTarget", {
      url: "about:blank",
    });
    if (!created.ok) return created;
    const targetId = created.value.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      return err(failure("internal", "CDP did not return a target id"));
    }
    const attached = await this.client.send<{ readonly sessionId?: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    if (!attached.ok) return attached;
    const sessionId = attached.value.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return err(failure("internal", "CDP did not return a flat session id"));
    }

    const page = new CdpPage(this.client, targetId, sessionId, "about:blank");
    const enabled = await page.enable();
    if (!enabled.ok) {
      await page.close();
      return enabled;
    }
    if (this.windowState !== "normal") {
      const applied = await page.setWindowState(this.windowState);
      if (!applied.ok) {
        await page.close();
        return applied;
      }
    }
    this.pages.add(page);
    return ok(page);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const page of this.pages) {
      try {
        await page.close();
      } catch {
        // The target may already be gone.
      }
    }
    this.pages.clear();
    this.client.close("the browser session was closed");
    await this.launched.close();
  }
}

/**
 * Find a Chromium-family binary without guessing past a candidate that exists.
 *
 * `DSH_BROWSER_PATH` is the documented override; `CHROME_PATH` and
 * `EDGE_PATH` are convenience aliases.
 */
export function resolveBrowserExecutable(options: {
  readonly executablePath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly exists?: (path: string) => boolean;
} = {}): string | null {
  const exists = options.exists ?? existsSync;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const candidates: string[] = [];
  if (options.executablePath !== undefined) candidates.push(options.executablePath);
  for (const name of ["DSH_BROWSER_PATH", "CHROME_PATH", "EDGE_PATH"]) {
    const configured = env[name];
    if (configured !== undefined && configured.length > 0) candidates.push(configured);
  }

  if (platform === "win32") {
    const programFiles = env.PROGRAMFILES ?? "C:\\Program Files";
    const programFilesX86 = env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA;
    candidates.push(
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(local === undefined ? [] : [join(local, "Google", "Chrome", "Application", "chrome.exe")]),
      join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      ...(local === undefined ? [] : [join(local, "Microsoft", "Edge", "Application", "msedge.exe")]),
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/snap/bin/chromium",
    );
  }

  for (const candidate of candidates) {
    if (candidate.length > 0 && exists(candidate)) return candidate;
  }
  return null;
}

/** Stop the whole process tree: Chromium forks renderers that outlive a kill. */
async function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  await sleep(100);
  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/** The default launcher: spawn headless Chromium and read its DevTools endpoint. */
async function launchBrowser(request: CdpLaunchRequest): Promise<CdpLaunchedBrowser> {
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${request.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    ...(request.headless ? ["--headless=new", "--disable-gpu"] : []),
    "about:blank",
  ];
  const child = spawn(request.executablePath, args, { stdio: "ignore", windowsHide: true });
  let spawnError: Error | null = null;
  child.on("error", (error) => {
    spawnError = error;
  });

  const activePortPath = join(request.userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + request.timeoutMs;
  let endpoint: string | null = null;
  while (Date.now() < deadline) {
    if (spawnError !== null) {
      await killTree(child);
      await rm(request.userDataDir, { recursive: true, force: true }).catch(() => undefined);
      throw spawnError;
    }
    if (child.exitCode !== null) {
      await rm(request.userDataDir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`the browser exited before CDP was ready (code ${child.exitCode})`);
    }
    try {
      const content = await readFile(activePortPath, "utf8");
      const [portLine, socketPath] = content.split(/\r?\n/);
      const port = Number.parseInt(portLine ?? "", 10);
      if (Number.isInteger(port) && port > 0 && socketPath !== undefined && socketPath.startsWith("/")) {
        endpoint = `ws://127.0.0.1:${port}${socketPath}`;
        break;
      }
    } catch {
      // The file appears after the browser has bound the port.
    }
    await sleep(50);
  }

  if (endpoint === null) {
    await killTree(child);
    await rm(request.userDataDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`the browser did not expose a CDP endpoint within ${request.timeoutMs} ms`);
  }

  let closed = false;
  return {
    endpoint,
    async close() {
      if (closed) return;
      closed = true;
      await killTree(child);
      await rm(request.userDataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * Build the factory the profile declares.
 *
 * `windowState: "fullscreen"` is applied per page through
 * `Browser.getWindowForTarget` + `Browser.setWindowBounds`, before the page
 * check measures anything. The browser is launched once per `launch()` call and
 * stopped by `session.close()`.
 */
export function createCdpBrowserFactory(options: CdpAdapterOptions = {}): BrowserProbeFactory {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return {
    async launch(launchOptions): Promise<Result<BrowserSessionHandle>> {
      const headless = launchOptions.headless;
      let launched: CdpLaunchedBrowser;
      if (options.launcher !== undefined) {
        try {
          launched = await options.launcher({
            executablePath: options.executablePath ?? "chromium",
            headless,
            timeoutMs,
            userDataDir: options.userDataDir ?? "",
          });
        } catch (error) {
          return err(
            failure(
              "prerequisite",
              `the injected browser launcher failed: ${describeThrown(error)}`,
              "a launcher must return { endpoint, close() } for a running browser",
            ),
          );
        }
      } else {
        const executablePath = resolveBrowserExecutable({
          ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.platform === undefined ? {} : { platform: options.platform }),
        });
        if (executablePath === null) {
          return err(
            failure(
              "prerequisite",
              "no Chromium/Chrome or Edge executable was found",
              "set DSH_BROWSER_PATH to the browser binary, or pass executablePath to createCdpBrowserFactory",
            ),
          );
        }
        const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), "dsh-cdp-")));
        try {
          launched = await launchBrowser({ executablePath, headless, timeoutMs, userDataDir });
        } catch (error) {
          return err(
            failure(
              "prerequisite",
              `the browser could not start: ${describeThrown(error)}`,
              "check the executable path and that the browser can run with the given headless mode",
            ),
          );
        }
      }

      const client = new CdpClient();
      try {
        const connection = await (options.transport ?? new WebSocketCdpTransport()).connect(
          launched.endpoint,
          client.handlers,
        );
        client.attach(connection);
      } catch (error) {
        await launched.close().catch(() => undefined);
        return err(
          failure(
            "prerequisite",
            `could not connect to the browser's CDP endpoint: ${describeThrown(error)}`,
            "the browser must expose its DevTools websocket; check the launch arguments and the Node version",
          ),
        );
      }
      return ok(new CdpSession(client, launched, options.windowState ?? "normal"));
    },
  };
}
