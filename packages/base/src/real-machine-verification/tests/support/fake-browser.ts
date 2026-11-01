/**
 * A browser adapter that never starts a browser.
 *
 * Page checks care about the adapter's *observations*, not about Chromium. This
 * fake lets the test choose every observation (sizes, text, errors, screenshot
 * bytes) and records what the check asked for, so a page scenario is exercised
 * end to end without a display, a download or a child process.
 */
import { writeFile } from "node:fs/promises";

import type { BrowserPageHandle, BrowserProbeFactory, BrowserSessionHandle } from "../../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../../contracts/result";

export interface FakePageSize {
  readonly width: number;
  readonly height: number;
}

export interface FakeWindowState {
  readonly state: string;
  readonly width?: number;
  readonly height?: number;
}

export interface FakeBrowserPageOptions {
  /** Current URL; defaults to about:blank, which the check navigates away from. */
  readonly url?: string;
  /** Layout viewport; a Failure makes innerSize() fail. */
  readonly inner?: FakePageSize | Failure;
  /** Real window size; a Failure makes outerSize() fail. */
  readonly outer?: FakePageSize | Failure;
  /** Text per selector; a missing key reads as "no such element" (null). */
  readonly text?: Readonly<Record<string, string | null>>;
  readonly pageErrors?: readonly string[];
  /** Bytes the adapter writes to the screenshot path. */
  readonly screenshotBytes?: Uint8Array;
  /** Default true: expose goto(url). Set false to exercise location polling. */
  readonly supportsGoto?: boolean;
  /** Returned by goto() and by the location fallback. */
  readonly failGoto?: Failure;
  /** Exposed through the optional windowState() probe when present. */
  readonly windowState?: FakeWindowState;
  /** Where the fake writes the screenshot; defaults to the real filesystem. */
  readonly writeScreenshot?: (path: string, bytes: Uint8Array) => Promise<void> | void;
}

export interface FakeBrowserPage extends BrowserPageHandle {
  goto?(url: string): Promise<Result<void>>;
  windowState?(): Promise<Result<FakeWindowState>>;
  readonly visitedUrls: string[];
  readonly screenshotPaths: string[];
}

export interface FakeBrowserOptions extends FakeBrowserPageOptions {
  readonly failLaunch?: Failure;
  readonly failNewPage?: Failure;
}

export interface FakeBrowser extends BrowserProbeFactory {
  readonly launches: readonly { readonly headless: boolean }[];
  readonly pages: readonly FakeBrowserPage[];
  readonly sessionsClosed: number;
  readonly closedPages: number;
}

/** The default fake screenshot: the 8-byte PNG signature. */
export const FAKE_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isFailure(value: unknown): value is Failure {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

async function readSize(
  configured: FakePageSize | Failure | undefined,
  fallback: FakePageSize,
): Promise<Result<FakePageSize>> {
  if (configured === undefined) return ok(fallback);
  if (isFailure(configured)) return err(configured);
  return ok(configured);
}

function createFakePage(options: FakeBrowserPageOptions, onClose: () => void): FakeBrowserPage {
  const url = { current: options.url ?? "about:blank" };
  const visitedUrls: string[] = [];
  const screenshotPaths: string[] = [];
  const errors = [...(options.pageErrors ?? [])];
  const bytes = options.screenshotBytes ?? FAKE_PNG_BYTES;
  const writeScreenshot =
    options.writeScreenshot ??
    (async (path: string, content: Uint8Array): Promise<void> => {
      await writeFile(path, content);
    });

  const navigate = async (target: string): Promise<Result<void>> => {
    visitedUrls.push(target);
    if (options.failGoto !== undefined) return err(options.failGoto);
    url.current = target;
    return ok(undefined);
  };

  const page: FakeBrowserPage = {
    visitedUrls,
    screenshotPaths,
    url: () => url.current,
    async evaluate<TResult>(script: string): Promise<Result<TResult>> {
      if (script.includes("window.location.assign(")) {
        const raw = script.slice(script.indexOf("(") + 1, script.lastIndexOf(")"));
        try {
          await navigate(JSON.parse(raw) as string);
        } catch {
          return err(failure("invalid-input", "the fake could not parse the navigation target"));
        }
        return ok(undefined as TResult);
      }
      if (script.includes("document.readyState")) return ok("complete" as TResult);
      if (script.includes("document.title")) return ok("Fake App" as TResult);
      return ok(null as TResult);
    },
    async innerSize() {
      return readSize(options.inner, { width: 1440, height: 900 });
    },
    async outerSize() {
      return readSize(options.outer, { width: 1440, height: 900 });
    },
    async text(selector: string) {
      return ok(options.text?.[selector] ?? null);
    },
    async screenshot(path: string) {
      screenshotPaths.push(path);
      try {
        await writeScreenshot(path, bytes);
      } catch (error) {
        return err(failure("io", `the fake could not write the screenshot: ${String(error)}`));
      }
      return ok({ bytes: bytes.byteLength });
    },
    pageErrors: () => [...errors],
    async close() {
      onClose();
    },
  };

  if (options.supportsGoto !== false) page.goto = navigate;
  if (options.windowState !== undefined) {
    const state = options.windowState;
    page.windowState = async () => ok(state);
  }
  return page;
}

/**
 * Build the fake factory.
 *
 * `writeScreenshot` is how a test keeps the file inside an in-memory filesystem:
 * pass `(path, bytes) => { fs.seedFile(path, bytes); }`.
 */
export function createFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const state = {
    launches: [] as { readonly headless: boolean }[],
    pages: [] as FakeBrowserPage[],
    sessionsClosed: 0,
    closedPages: 0,
  };

  const session: BrowserSessionHandle = {
    async newPage(): Promise<Result<BrowserPageHandle>> {
      if (options.failNewPage !== undefined) return err(options.failNewPage);
      const page = createFakePage(options, () => {
        state.closedPages += 1;
      });
      state.pages.push(page);
      return ok(page);
    },
    async close(): Promise<void> {
      state.sessionsClosed += 1;
    },
  };

  return {
    get launches() {
      return state.launches;
    },
    get pages() {
      return state.pages;
    },
    get sessionsClosed() {
      return state.sessionsClosed;
    },
    get closedPages() {
      return state.closedPages;
    },
    async launch(launchOptions: { readonly headless: boolean }): Promise<Result<BrowserSessionHandle>> {
      state.launches.push({ headless: launchOptions.headless });
      if (options.failLaunch !== undefined) return err(options.failLaunch);
      return ok(session);
    },
  };
}
