/**
 * `instance-pages` — the instance's page renders, and its window is really the
 * size it claims to be.
 *
 * Page-level verification is plugin-shaped: the plugin repository owns a browser
 * driver, and the core owns no browser library at all. This check therefore
 * consumes an injected adapter (or loads the one declared in
 * `profile.browser`) and reports honestly when none is available:
 *
 * - **no adapter / adapter failed to load → `blocked`**, with a hint that shows
 *   how to inject one. A missing browser proves nothing about the product.
 * - **the page did not open, threw, or has the wrong window size → `fail`**,
 *   with `expected` and `actual` carrying the measurement, so the reader can
 *   re-derive the comparison.
 *
 * Fullscreen is only ever judged from the adapter's real window state
 * (`outerSize()` compared with the display, plus the adapter's window-state
 * probe when it exposes one). The viewport is never resized to imitate a
 * fullscreen window: the historical failure this rule prevents is a product
 * being declared broken because a test changed the page instead of the window.
 *
 * The screenshot is written through the adapter (it owns the browser) but
 * hashed and measured through `ports.fs`, so the evidence item records the
 * bytes that actually reached disk rather than the adapter's claim. Evidence
 * naming stays local on purpose: `evidence/store.ts` writes text/JSON only and
 * is a shared file owned by another ticket.
 */
import { asEvidencePath } from "../contracts/branding";
import type { BlockedReason, EvidenceItem, EvidenceItemRef } from "../contracts/evidence-contract";
import { isSafeEvidencePath } from "../contracts/evidence-contract";
import type {
  BrowserPageHandle,
  BrowserProbeFactory,
  BrowserSessionHandle,
  Ports,
  ScreenInfo,
} from "../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../contracts/result";
import type { VerificationProfile } from "../contracts/verification-profile";
import type { EvidenceStore } from "../evidence/store";
import {
  loadBrowserAdapter,
  missingBrowserAdapterHint,
  type BrowserAdapterLoadResult,
  type LoadBrowserAdapterOptions,
} from "../adapters/browser/loader";
import { isInsidePath, joinFsPath, toPosixPath } from "../runtime/paths";
import {
  blocked,
  checkId,
  failed,
  passed,
  type CheckModule,
  type CheckOutcome,
} from "./types";

/** The built-in check id; stable because reports and comments cite it. */
export const PAGE_CHECK_ID = "instance-pages";
/** The claim this check makes. */
export const PAGE_CHECK_TITLE = "the instance page renders and its window matches the display";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TOLERANCE_PX = 2;
const DEFAULT_SELECTORS: readonly string[] = ["body"];
const POLL_INTERVAL_MS = 50;
const MAX_SCREENSHOT_ORDINAL = 999;

export interface PageSize {
  readonly width: number;
  readonly height: number;
}

/** Where the check points the browser. */
export interface PageCheckInstance {
  /** URL to open; use the instance's token URL so the session is authenticated. */
  readonly url: string;
  /** Origin of the instance, recorded in the observation. */
  readonly origin: string;
  /** Token URL from `instance.json`, when it differs from `url`. */
  readonly tokenUrl?: string;
}

/** What the caller claims about the page. Everything is optional. */
export interface PageExpectations {
  /** Path appended to the instance URL (e.g. `/settings`). */
  readonly path?: string;
  /** Assert the real window covers the display. */
  readonly fullscreen?: boolean;
  /** Expected layout viewport in CSS pixels. */
  readonly innerSize?: PageSize;
  /** Expected real window size in CSS pixels. */
  readonly outerSize?: PageSize;
  /** Selectors whose text must be present; default `["body"]`. */
  readonly selectors?: readonly string[];
  /** Pixels of slack for size comparisons; default 2. */
  readonly sizeTolerance?: number;
}

export interface PageCheckOptions {
  /** Defaults to true: a blank page or wrong window blocks the run. */
  readonly hard?: boolean;
  readonly title?: string;
  readonly expectations?: PageExpectations;
  /** Navigation/readiness timeout; default 15000 ms. */
  readonly timeoutMs?: number;
}

/** Where the adapter came from, so a report can say what actually ran. */
export interface PageAdapterReport {
  readonly source: "context" | "ports" | "profile" | "none";
  readonly module?: string;
  readonly exportName?: string;
  readonly failure?: string;
}

/** The measurements every spatial conclusion is allowed to cite. */
export interface PageViewportReport {
  readonly inner: PageSize | null;
  readonly outer: PageSize | null;
  readonly screen: PageSize | null;
  readonly tolerance: number;
  /** `null` when fullscreen was not asserted; true/false otherwise. */
  readonly fullscreen: boolean | null;
  readonly windowState?: string;
}

/** A check outcome plus the provenance a page report needs. */
export interface PageCheckOutcome extends CheckOutcome {
  readonly adapter: PageAdapterReport;
  readonly viewport: PageViewportReport | null;
  /**
   * The screenshot item whose bytes were measured on disk. The check result
   * carries only its reference (path, sha256, kind); byte count and capture time
   * stay here so a caller never has to guess them.
   */
  readonly screenshot?: EvidenceItem;
}

/** Everything one page check needs; a ticket-12 command can build this directly. */
export interface PageCheckContext {
  readonly ports: Ports;
  readonly instance: PageCheckInstance;
  readonly profile: VerificationProfile;
  /** Display to compare against; omitted asks the screen port, `null` means unknown. */
  readonly screen?: ScreenInfo | null;
  readonly evidence: EvidenceStore;
  /** Screenshot directory; defaults to `<evidence.root>/screenshots`. */
  readonly evidenceDir?: string;
  /**
   * Preloaded adapter. `undefined` asks `ports.browser` and then the profile's
   * declaration; `null` means "explicitly none" and skips the loader.
   */
  readonly adapter?: BrowserProbeFactory | null;
  /** Why a preloaded adapter is absent (loader failure, for instance). */
  readonly adapterFailure?: Failure;
  /** Plugin repository root for `profile.browser`; defaults to `ports.env.cwd()`. */
  readonly repoRoot?: string;
  /** Headless browser; defaults to true. A fullscreen claim requires a headed run. */
  readonly headless?: boolean;
  readonly loadAdapter?: (options: LoadBrowserAdapterOptions) => Promise<BrowserAdapterLoadResult>;
  readonly note?: (message: string) => void;
}

/** Optional extension the reference adapter implements; absent adapters are fine. */
interface WindowStateProbe {
  windowState?(): Promise<Result<{ readonly state?: string; readonly width?: number; readonly height?: number }>>;
}

/** Optional navigation extension; without it the check assigns `location`. */
interface NavigablePage extends BrowserPageHandle {
  goto?(url: string): Promise<Result<void>>;
}

interface ExpectationFailure {
  readonly summary: string;
  readonly expected: string;
  readonly actual: string;
  readonly hint: string;
}

interface Blocker {
  readonly detail: string;
  readonly hint: string;
}

function sizeText(size: PageSize | null): string {
  return size === null ? "unknown" : `${size.width}x${size.height}`;
}

function sameSize(left: PageSize, right: PageSize, tolerance: number): boolean {
  return Math.abs(left.width - right.width) <= tolerance && Math.abs(left.height - right.height) <= tolerance;
}

function asSize(value: unknown): PageSize | null {
  if (typeof value !== "object" || value === null) return null;
  const width = (value as { width?: unknown }).width;
  const height = (value as { height?: unknown }).height;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function describeSizes(viewport: PageViewportReport): string {
  return `innerSize=${sizeText(viewport.inner)} outerSize=${sizeText(viewport.outer)} screen=${sizeText(viewport.screen)} tolerance=${viewport.tolerance}`;
}

function resolveTargetUrl(instance: PageCheckInstance, expectations: PageExpectations): string {
  if (expectations.path === undefined || expectations.path.length === 0) return instance.url;
  try {
    return new URL(expectations.path, instance.url).toString();
  } catch {
    return instance.url;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function safePageUrl(page: BrowserPageHandle): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

async function pageReady(page: BrowserPageHandle): Promise<boolean> {
  const state = await page.evaluate<unknown>("document.readyState");
  return state.ok && state.value === "complete";
}

/**
 * Navigate and wait for the page to settle.
 *
 * The port contract has no `goto`, so the fallback assigns `location` from the
 * page and polls `url()`/`readyState`. An adapter that exposes `goto(url)`
 * (the reference CDP adapter does) gets used first; the poll still runs because
 * a navigation call resolving is not a page that finished loading.
 */
async function openPage(
  page: BrowserPageHandle,
  url: string,
  timeoutMs: number,
  nowMs: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  const navigable = page as NavigablePage;
  if (typeof navigable.goto === "function") {
    const navigated = await navigable.goto(url);
    if (!navigated.ok) return { ok: false, error: navigated.error.message };
  } else {
    try {
      await page.evaluate<void>(`window.location.assign(${JSON.stringify(url)});`);
    } catch (error) {
      // A navigation usually destroys the execution context that ran the
      // assignment; the poll below decides whether the page actually arrived.
      void error;
    }
  }

  const expectedOrigin = originOf(url);
  const deadline = nowMs() + timeoutMs;
  while (nowMs() < deadline) {
    const current = safePageUrl(page);
    const currentOrigin = originOf(current);
    const arrived =
      current.length > 0 &&
      current !== "about:blank" &&
      (expectedOrigin === null || currentOrigin === expectedOrigin);
    if (arrived && (await pageReady(page))) return { ok: true };
    await sleep(POLL_INTERVAL_MS);
  }
  return {
    ok: false,
    error: `the page did not reach ${url} and finish loading within ${timeoutMs} ms (last url: ${safePageUrl(page) || "about:blank"})`,
  };
}

/** The display the window should cover, or `null` when the machine has none. */
async function resolveScreen(context: PageCheckContext): Promise<ScreenInfo | null> {
  if (context.screen !== undefined) return context.screen;
  const screens = await context.ports.screen.screens();
  if (!screens.ok) return null;
  return screens.value.find((screen) => screen.primary) ?? screens.value[0] ?? null;
}

/** Path of `absolute` relative to the evidence root, or `null` when outside it. */
function relativeToEvidenceRoot(root: string, absolute: string): string | null {
  if (!isInsidePath(absolute, root)) return null;
  const rootPosix = toPosixPath(root).replace(/\/+$/, "");
  const filePosix = toPosixPath(absolute);
  const windows = /^[A-Za-z]:/.test(rootPosix) || /^[A-Za-z]:/.test(filePosix);
  const comparableRoot = windows ? rootPosix.toLowerCase() : rootPosix;
  const comparableFile = windows ? filePosix.toLowerCase() : filePosix;
  if (comparableFile === comparableRoot) return null;
  if (!comparableFile.startsWith(`${comparableRoot}/`)) return null;
  return filePosix.slice(rootPosix.length + 1);
}

async function allocateScreenshotName(fs: PageCheckContext["ports"]["fs"], dir: string): Promise<string | null> {
  for (let ordinal = 1; ordinal <= MAX_SCREENSHOT_ORDINAL; ordinal += 1) {
    const fileName = ordinal === 1 ? "instance-pages.png" : `instance-pages-${ordinal}.png`;
    if (!(await fs.exists(joinFsPath(dir, fileName)))) return fileName;
  }
  return null;
}

/**
 * Ask the adapter for a PNG, then measure and hash it through the filesystem.
 *
 * "Bytes on disk" is the only number worth reporting: an adapter that returns
 * `{ bytes: n }` without writing n bytes must not turn into a green claim.
 */
async function captureScreenshot(
  context: PageCheckContext,
  page: BrowserPageHandle,
): Promise<Result<EvidenceItem>> {
  const { fs, clock } = context.ports;
  const dir = context.evidenceDir ?? joinFsPath(context.evidence.root, "screenshots");
  const made = await fs.makeDir(dir);
  if (!made.ok) return made;
  const fileName = await allocateScreenshotName(fs, dir);
  if (fileName === null) {
    return err(failure("conflict", `every screenshot name is taken in ${dir}`, "start a new run or clear the directory"));
  }
  const absolute = joinFsPath(dir, fileName);
  const relative = relativeToEvidenceRoot(context.evidence.root, absolute);
  if (relative === null || !isSafeEvidencePath(relative)) {
    return err(
      failure(
        "invalid-input",
        `the screenshot directory ${dir} is outside the evidence root ${context.evidence.root}`,
        "pass an evidenceDir inside the evidence root so the item keeps a re-verifiable relative path",
      ),
    );
  }

  const captured = await page.screenshot(absolute, { fullPage: false });
  if (!captured.ok) return captured;
  const stat = await fs.stat(absolute);
  if (!stat.ok) return stat;
  if (stat.value.size <= 0) {
    return err(failure("io", `the browser wrote an empty screenshot: ${absolute}`));
  }
  const digest = await fs.hashFile(absolute);
  if (!digest.ok) return digest;

  return ok({
    kind: "screenshot",
    path: asEvidencePath(toPosixPath(relative)),
    bytes: stat.value.size,
    sha256: digest.value,
    capturedAt: clock.iso(),
    note: `the instance page captured by ${PAGE_CHECK_ID}`,
  });
}

function screenshotRef(item: EvidenceItem): EvidenceItemRef {
  return { path: item.path, sha256: item.sha256, kind: item.kind };
}

/**
 * Resolve the adapter, remembering where it came from.
 *
 * Precedence is deliberate: an explicit context adapter wins (tests and L3
 * callers), then the ports aggregate (the existing injection seam), then the
 * profile declaration. A declared module that cannot load is a reason to
 * report `blocked`, not to fall back silently to "no browser".
 */
async function resolveAdapter(context: PageCheckContext): Promise<
  | { readonly ok: true; readonly factory: BrowserProbeFactory; readonly report: PageAdapterReport }
  | { readonly ok: false; readonly report: PageAdapterReport; readonly failure: Failure | null }
> {
  if (context.adapter !== undefined) {
    if (context.adapter === null) {
      return {
        ok: false,
        report: { source: "none", ...(context.adapterFailure === undefined ? {} : { failure: context.adapterFailure.message }) },
        failure: context.adapterFailure ?? null,
      };
    }
    return { ok: true, factory: context.adapter, report: { source: "context" } };
  }

  if (context.ports.browser !== null && context.ports.browser !== undefined) {
    return { ok: true, factory: context.ports.browser, report: { source: "ports" } };
  }

  if (context.profile.browser === false) {
    return { ok: false, report: { source: "none" }, failure: null };
  }

  const declaration = context.profile.browser;
  const repoRoot = context.repoRoot ?? context.ports.env.cwd();
  const loaded = await (context.loadAdapter ?? loadBrowserAdapter)({
    fs: context.ports.fs,
    repoRoot,
    declaration,
  });
  if (!loaded.ok) {
    return {
      ok: false,
      report: {
        source: "profile",
        module: declaration.module,
        ...(declaration.exportName === undefined ? {} : { exportName: declaration.exportName }),
        failure: loaded.error.message,
      },
      failure: loaded.error,
    };
  }
  return {
    ok: true,
    factory: loaded.value.factory,
    report: {
      source: "profile",
      module: declaration.module,
      exportName: loaded.value.exportName,
    },
  };
}

function blockedOutcome(
  detail: string,
  hint: string,
  adapter: PageAdapterReport,
  viewport: PageViewportReport | null,
  code: BlockedReason["code"],
): PageCheckOutcome {
  return { ...blocked(detail, hint, undefined, { code, message: detail, hint }), adapter, viewport };
}

/**
 * Run one page check.
 *
 * The function never throws: every failure is an outcome. The page and the
 * browser session are closed in `finally` even when the product failed, so a
 * red run does not leave a browser holding the instance's session.
 */
export async function runPageChecks(
  context: PageCheckContext,
  options: PageCheckOptions = {},
): Promise<PageCheckOutcome> {
  const note = context.note ?? ((): void => {});
  const { clock } = context.ports;
  const expectations = options.expectations ?? {};
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tolerance = expectations.sizeTolerance ?? DEFAULT_TOLERANCE_PX;
  const selectors = expectations.selectors ?? DEFAULT_SELECTORS;
  const headless = context.headless ?? true;

  const resolvedAdapter = await resolveAdapter(context);
  if (!resolvedAdapter.ok) {
    const loading = resolvedAdapter.report.source === "profile";
    const detail = loading
      ? `the browser adapter declared by profile.browser could not be loaded: ${resolvedAdapter.failure?.message ?? "unknown error"}`
      : context.adapter === null
        ? "no browser adapter was injected for page checks"
        : "no browser adapter is available: profile.browser is false and ports.browser is null";
    const hint = [resolvedAdapter.failure?.hint, missingBrowserAdapterHint()]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join("\n\n");
    return blockedOutcome(detail, hint, resolvedAdapter.report, null, "adapter-missing");
  }

  const adapter = resolvedAdapter.factory;
  const adapterReport = resolvedAdapter.report;
  let screenshotItem: EvidenceItem | undefined;
  note(`${PAGE_CHECK_ID}: adapter from ${adapterReport.source}${adapterReport.module === undefined ? "" : ` (${adapterReport.module})`}`);

  const screen = await resolveScreen(context);
  const screenSize: PageSize | null = screen === null ? null : { width: screen.width, height: screen.height };
  const baseViewport: PageViewportReport = {
    inner: null,
    outer: null,
    screen: screenSize,
    tolerance,
    fullscreen: expectations.fullscreen === true ? false : null,
  };

  if (expectations.fullscreen === true && screenSize === null) {
    return blockedOutcome(
      "fullscreen was requested but no display is available to compare the window against",
      "run on a machine with a display, or omit the fullscreen expectation; page checks never infer fullscreen from a resized viewport",
      adapterReport,
      baseViewport,
      "platform-unsupported",
    );
  }

  if (expectations.fullscreen === true && headless) {
    return blockedOutcome(
      "fullscreen was requested while the browser runs headless: a headless window has no real fullscreen state",
      "run this check with a headed browser (a display is required), or omit the fullscreen expectation",
      adapterReport,
      baseViewport,
      "platform-unsupported",
    );
  }

  let session: BrowserSessionHandle | undefined;
  try {
    const launched = await adapter.launch({ headless });
    if (!launched.ok) {
      return blockedOutcome(
        `the browser adapter could not launch a browser: ${launched.error.message}`,
        launched.error.hint ?? missingBrowserAdapterHint(),
        adapterReport,
        baseViewport,
        "adapter-missing",
      );
    }
    session = launched.value;

    const opened = await session.newPage();
    if (!opened.ok) {
      return blockedOutcome(
        `the browser adapter could not open a page: ${opened.error.message}`,
        opened.error.hint ?? "the adapter's newPage() must return a BrowserPageHandle",
        adapterReport,
        baseViewport,
        "adapter-missing",
      );
    }
    const page = opened.value as BrowserPageHandle;
    const targetUrl = resolveTargetUrl(context.instance, expectations);

    try {
      const navigation = await openPage(page, targetUrl, timeoutMs, () => clock.nowMs(), (ms) => clock.sleep(ms));
      const failures: ExpectationFailure[] = [];
      const blockers: Blocker[] = [];
      const evidence: EvidenceItemRef[] = [];

      let inner: PageSize | null = null;
      const innerRead = await page.innerSize();
      if (innerRead.ok) inner = asSize(innerRead.value);
      else blockers.push({ detail: `innerSize() failed: ${innerRead.error.message}`, hint: "the adapter must report the layout viewport" });
      if (innerRead.ok && inner === null) {
        blockers.push({ detail: "innerSize() returned a malformed value", hint: "return { width, height } in CSS pixels" });
      }

      let outer: PageSize | null = null;
      const outerRead = await page.outerSize();
      if (outerRead.ok) outer = asSize(outerRead.value);
      else blockers.push({ detail: `outerSize() failed: ${outerRead.error.message}`, hint: "the adapter must report the real window size" });
      if (outerRead.ok && outer === null) {
        blockers.push({ detail: "outerSize() returned a malformed value", hint: "return { width, height } in CSS pixels" });
      }

      let windowState: string | undefined;
      const probe = page as WindowStateProbe;
      if (typeof probe.windowState === "function") {
        const state = await probe.windowState();
        if (state.ok) windowState = typeof state.value.state === "string" ? state.value.state : undefined;
      }

      const viewport: PageViewportReport = {
        inner,
        outer,
        screen: screenSize,
        tolerance,
        fullscreen: expectations.fullscreen === true ? outer !== null && screenSize !== null && sameSize(outer, screenSize, tolerance) : null,
        ...(windowState === undefined ? {} : { windowState }),
      };

      const textValues: Record<string, string | null> = {};
      const missingSelectors: string[] = [];
      for (const selector of selectors) {
        const text = await page.text(selector);
        if (!text.ok) {
          blockers.push({ detail: `text(${JSON.stringify(selector)}) failed: ${text.error.message}`, hint: "the adapter must read element text" });
          textValues[selector] = null;
          continue;
        }
        textValues[selector] = text.value;
        if (text.value === null) missingSelectors.push(selector);
      }

      const pageErrors = [...page.pageErrors()];
      const screenshot = await captureScreenshot(context, page);
      if (screenshot.ok) {
        screenshotItem = screenshot.value;
        evidence.push(screenshotRef(screenshot.value));
      } else {
        blockers.push({ detail: `the screenshot could not be recorded: ${screenshot.error.message}`, hint: "the adapter must write a PNG screenshot to the given path" });
      }

      if (!navigation.ok) {
        failures.push({
          summary: "navigation failed",
          expected: `the page at ${targetUrl} completed loading`,
          actual: navigation.error,
          hint: "check the instance URL and that the app shell responds; the page itself never loaded",
        });
      }

      if (missingSelectors.length > 0) {
        failures.push({
          summary: `${missingSelectors.length} selector(s) had no text`,
          expected: `selectors with text: ${selectors.join(", ")}`,
          actual: `selectors with no matching element: ${missingSelectors.join(", ")}`,
          hint: "the page rendered without the expected shell; compare the screenshot with the expected DOM",
        });
      }

      if (pageErrors.length > 0) {
        failures.push({
          summary: `the page reported ${pageErrors.length} uncaught error(s)`,
          expected: "no uncaught page errors",
          actual: pageErrors.slice(0, 5).join(" | "),
          hint: "read the page errors and the screenshot; an uncaught exception means the shell did not finish loading",
        });
      }

      if (expectations.innerSize !== undefined && inner !== null && !sameSize(inner, expectations.innerSize, tolerance)) {
        failures.push({
          summary: "the layout viewport has the wrong size",
          expected: `innerSize=${sizeText(expectations.innerSize)} (${describeSizes(viewport)})`,
          actual: `innerSize=${sizeText(inner)} (${describeSizes(viewport)})`,
          hint: "compare the screenshot with the expected layout; resize assertions belong to the page, not the window",
        });
      }

      if (expectations.outerSize !== undefined && outer !== null && !sameSize(outer, expectations.outerSize, tolerance)) {
        failures.push({
          summary: "the window has the wrong size",
          expected: `outerSize=${sizeText(expectations.outerSize)} (${describeSizes(viewport)})`,
          actual: `outerSize=${sizeText(outer)} (${describeSizes(viewport)})`,
          hint: "the adapter controls the real window; a viewport resize must not be reported as a window size",
        });
      }

      if (expectations.fullscreen === true && outer !== null && screenSize !== null && !sameSize(outer, screenSize, tolerance)) {
        failures.push({
          summary: "the window is not fullscreen",
          expected: `outerSize=${sizeText(screenSize)} (screen=${sizeText(screenSize)}, ${describeSizes(viewport)})`,
          actual: `outerSize=${sizeText(outer)} (screen=${sizeText(screenSize)}, ${describeSizes(viewport)})`,
          hint: "make the launched window actually fullscreen through the adapter's window state; do not resize the viewport to imitate it",
        });
      }

      if (expectations.fullscreen === true && windowState !== undefined && windowState !== "fullscreen") {
        failures.push({
          summary: "the window state is not fullscreen",
          expected: `windowState=fullscreen (${describeSizes(viewport)})`,
          actual: `windowState=${windowState} (${describeSizes(viewport)})`,
          hint: "the adapter reports the real window state; set it to fullscreen before measuring",
        });
      }

      const observation = {
        check: PAGE_CHECK_ID,
        url: targetUrl,
        instanceUrl: context.instance.url,
        origin: context.instance.origin,
        ...(context.instance.tokenUrl === undefined ? {} : { tokenUrl: context.instance.tokenUrl }),
        headless,
        innerSize: inner,
        outerSize: outer,
        screen: screenSize,
        tolerance,
        fullscreen: expectations.fullscreen === true ? viewport.fullscreen : null,
        ...(windowState === undefined ? {} : { windowState }),
        text: textValues,
        pageErrors,
        navigation: navigation.ok ? { ok: true } : { ok: false, error: navigation.error },
        failures: failures.map((item) => item.summary),
        blockers: blockers.map((item) => item.detail),
        capturedAt: clock.iso(),
      };
      const recorded = await context.evidence.recordJson(PAGE_CHECK_ID, observation, {
        note: `the page observation behind ${PAGE_CHECK_ID}`,
      });
      if (recorded.ok) evidence.push({ path: recorded.value.path, sha256: recorded.value.sha256, kind: recorded.value.kind });
      else note(`${PAGE_CHECK_ID}: could not record the observation: ${recorded.error.message}`);

      if (failures.length > 0) {
        const detail = `the instance page failed ${failures.length} expectation${failures.length === 1 ? "" : "s"}: ${failures.map((item) => item.summary).join("; ")}`;
        const outcome = failed(
          detail,
          failures.map((item) => item.expected).join(" | "),
          failures.map((item) => item.actual).join(" | "),
          failures[0]?.hint ?? "read the screenshot and the page observation",
          evidence,
        );
        return {
          ...outcome,
          adapter: adapterReport,
          viewport,
          ...(screenshotItem === undefined ? {} : { screenshot: screenshotItem }),
        };
      }

      if (blockers.length > 0) {
        const detail = `the page could not be fully observed: ${blockers.map((item) => item.detail).join("; ")}`;
        const hint = blockers[0]?.hint ?? "the adapter could not complete the measurement";
        const outcome = blocked(detail, hint, evidence, { code: "adapter-missing", message: detail, hint });
        return {
          ...outcome,
          adapter: adapterReport,
          viewport,
          ...(screenshotItem === undefined ? {} : { screenshot: screenshotItem }),
        };
      }

      const detail =
        `the page at ${context.instance.origin} rendered (${describeSizes(viewport)}` +
        `${expectations.fullscreen === true ? ", window covers the display" : ""}); no page errors`;
      const outcome = passed(detail, evidence);
      return {
        ...outcome,
        adapter: adapterReport,
        viewport,
        ...(screenshotItem === undefined ? {} : { screenshot: screenshotItem }),
      };
    } finally {
      try {
        await page.close();
      } catch {
        // Closing is best-effort; the session close below reaps the context.
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return blockedOutcome(
      `the browser adapter threw while opening the page: ${message}`,
      "this is an adapter defect: launch(), newPage() and the page handle must return Result values instead of throwing",
      adapterReport,
      baseViewport,
      "adapter-missing",
    );
  } finally {
    if (session !== undefined) {
      try {
        await session.close();
      } catch {
        // Nothing useful to report: the process may already be gone.
      }
    }
  }
}

/**
 * The plan module ticket 12 composes into a single-instance or scenario run.
 *
 * `requires` is empty on purpose: the adapter may come from the profile and be
 * loaded at run time, so a plan-time "browser unavailable" gate would block a
 * check that could actually run.
 */
export function createPageCheckModule(options: PageCheckOptions = {}): CheckModule<PageCheckContext> {
  return {
    id: checkId(PAGE_CHECK_ID),
    title: options.title ?? PAGE_CHECK_TITLE,
    hard: options.hard ?? true,
    requires: [],
    onMissing: "blocked",
    missingHint: missingBrowserAdapterHint(),
    run: (context) => runPageChecks(context, options),
  };
}
