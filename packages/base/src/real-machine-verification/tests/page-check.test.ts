/**
 * `instance-pages` without a browser.
 *
 * Every observation comes from the fake adapter, so these tests pin the check's
 * judgments rather than Chromium's behavior: what becomes `pass`, what becomes
 * `blocked`, what becomes `fail`, and what evidence survives.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { decideExitCode } from "../contracts/check";
import { sha256Bytes } from "../contracts/identity";
import type { ScreenInfo } from "../contracts/ports";
import { err, failure, ok, type Result } from "../contracts/result";
import type { VerificationProfile } from "../contracts/verification-profile";
import { createEvidenceStore } from "../evidence/store";
import type {
  BrowserAdapterLoadResult,
  LoadBrowserAdapterOptions,
} from "../adapters/browser/loader";
import {
  createPageCheckModule,
  runPageChecks,
  type PageCheckContext,
  type PageExpectations,
} from "../orchestration/page-check";
import { toCheckResult } from "../orchestration/types";
import { FakeClock, FakeEnv, FakeFs } from "./support/fake-fs";
import { buildProfile } from "./support/fake-machine";
import { FakeScreen, makePorts } from "./support/fake-ports";
import {
  createFakeBrowser,
  FAKE_PNG_BYTES,
  type FakeBrowserOptions,
} from "./support/fake-browser";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const rmvRoot = resolve(testDirectory, "..");
const INSTANCE_URL = "http://127.0.0.1:4567/?token=abc";
const INSTANCE_ORIGIN = "http://127.0.0.1:4567";

interface FixtureOptions {
  readonly profile?: VerificationProfile;
  readonly screen?: Result<readonly ScreenInfo[]>;
}

function createFixture(options: FixtureOptions = {}) {
  const fs = new FakeFs("C:/repo");
  const clock = new FakeClock();
  const env = new FakeEnv({ cwd: "C:/repo" });
  const ports = makePorts({ fs, clock, env, screen: new FakeScreen(options.screen) });
  const evidence = createEvidenceStore({ fs, clock, root: "C:/work/evidence" });
  return {
    fs,
    clock,
    ports,
    evidence,
    profile: options.profile ?? buildProfile(),
    instance: { url: INSTANCE_URL, origin: INSTANCE_ORIGIN, tokenUrl: INSTANCE_URL },
  };
}

type Fixture = ReturnType<typeof createFixture>;

interface RunOptions {
  readonly profile?: VerificationProfile;
  readonly loadAdapter?: (options: LoadBrowserAdapterOptions) => Promise<BrowserAdapterLoadResult>;
  readonly screen?: Result<readonly ScreenInfo[]>;
  readonly headless?: boolean;
  readonly expectations?: PageExpectations;
}

async function execute(
  fixture: Fixture,
  options: RunOptions & { readonly adapter?: PageCheckContext["adapter"] },
) {
  return runPageChecks(
    {
      ports: fixture.ports,
      instance: fixture.instance,
      profile: options.profile ?? fixture.profile,
      evidence: fixture.evidence,
      headless: options.headless ?? true,
      ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
      ...(options.loadAdapter === undefined ? {} : { loadAdapter: options.loadAdapter }),
    },
    options.expectations === undefined ? {} : { expectations: options.expectations },
  );
}

/** A browser whose screenshot writer lands in the fixture's in-memory fs. */
async function runWithBrowser(browserOptions: FakeBrowserOptions = {}, options: RunOptions = {}) {
  const fixture = createFixture(options);
  const browser = createFakeBrowser({
    ...browserOptions,
    writeScreenshot:
      browserOptions.writeScreenshot ??
      ((target, bytes) => {
        fixture.fs.seedFile(target, bytes);
      }),
  });
  const outcome = await execute(fixture, { ...options, adapter: browser });
  return { fixture, browser, outcome };
}

async function runWithoutAdapter(options: RunOptions = {}) {
  const fixture = createFixture(options);
  const outcome = await execute(fixture, options);
  return { fixture, outcome };
}

describe("runPageChecks with an injected adapter", () => {
  it("passes, measures the page, and records the screenshot it actually wrote", async () => {
    const { fixture, browser, outcome } = await runWithBrowser({
      text: { body: "FeatherHunter shell" },
      inner: { width: 1440, height: 900 },
      outer: { width: 1440, height: 900 },
      screenshotBytes: FAKE_PNG_BYTES,
    });

    expect(outcome.status).toBe("pass");
    expect(outcome.adapter.source).toBe("context");
    expect(outcome.viewport).toMatchObject({
      inner: { width: 1440, height: 900 },
      outer: { width: 1440, height: 900 },
      screen: { width: 1920, height: 1080 },
      tolerance: 2,
      fullscreen: null,
    });
    expect(browser.launches).toEqual([{ headless: true }]);
    expect(browser.pages[0]?.visitedUrls).toContain(INSTANCE_URL);
    const screenshotPath = browser.pages[0]?.screenshotPaths[0] ?? "";
    expect(screenshotPath).toContain("screenshots");
    expect(screenshotPath.endsWith("instance-pages.png")).toBe(true);
    expect(browser.closedPages).toBe(1);
    expect(browser.sessionsClosed).toBe(1);

    const screenshot = outcome.screenshot;
    expect(screenshot).toBeDefined();
    expect(screenshot?.path).toBe("screenshots/instance-pages.png");
    expect(screenshot?.bytes).toBe(FAKE_PNG_BYTES.byteLength);
    expect(screenshot?.sha256).toBe(sha256Bytes(FAKE_PNG_BYTES));
    expect(screenshot?.capturedAt).toBe(fixture.clock.iso());
    expect(outcome.evidence?.map((item) => item.kind)).toEqual(["screenshot", "json"]);

    const stored = await fixture.fs.readBytes(screenshotPath);
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(Array.from(stored.value)).toEqual(Array.from(FAKE_PNG_BYTES));
      expect(screenshot?.sha256).toBe(sha256Bytes(stored.value));
    }

    const observation = fixture.evidence.items().find((item) => item.kind === "json");
    expect(observation?.path).toBe("instance-pages.json");
    const parsed = JSON.parse(fixture.fs.readFileSync("C:/work/evidence/instance-pages.json")) as {
      readonly check: string;
      readonly innerSize: { readonly width: number };
      readonly pageErrors: readonly string[];
      readonly fullscreen: boolean | null;
    };
    expect(parsed.check).toBe("instance-pages");
    expect(parsed.innerSize.width).toBe(1440);
    expect(parsed.pageErrors).toEqual([]);
    expect(parsed.fullscreen).toBeNull();
  });

  it("never launches a browser when fullscreen is claimed in headless mode", async () => {
    const { browser, outcome } = await runWithBrowser(
      {},
      { headless: true, expectations: { fullscreen: true } },
    );

    expect(outcome.status).toBe("blocked");
    expect(outcome.hint).toContain("headed browser");
    expect(browser.launches).toEqual([]);
  });

  it("passes a real fullscreen window when the adapter reports the window state", async () => {
    const { outcome } = await runWithBrowser(
      {
        text: { body: "FeatherHunter shell" },
        inner: { width: 1920, height: 1040 },
        outer: { width: 1920, height: 1080 },
        windowState: { state: "fullscreen", width: 1920, height: 1080 },
      },
      { headless: false, expectations: { fullscreen: true } },
    );

    expect(outcome.status).toBe("pass");
    expect(outcome.detail).toContain("window covers the display");
    expect(outcome.viewport?.fullscreen).toBe(true);
    expect(outcome.viewport?.windowState).toBe("fullscreen");
  });

  it("fails a fullscreen claim with the real window and display sizes", async () => {
    const { outcome } = await runWithBrowser(
      {
        text: { body: "FeatherHunter shell" },
        inner: { width: 1440, height: 813 },
        outer: { width: 1440, height: 900 },
      },
      { headless: false, expectations: { fullscreen: true } },
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("fullscreen");
    expect(outcome.expected).toContain("outerSize=1920x1080");
    expect(outcome.actual).toContain("outerSize=1440x900");
    expect(outcome.expected).toContain("innerSize=1440x813");
    expect(outcome.expected).toContain("screen=1920x1080");
    expect(outcome.actual).toContain("tolerance=2");
    expect(outcome.hint).toContain("do not resize the viewport");
    expect(outcome.viewport?.fullscreen).toBe(false);
  });

  it("fails a window-state claim that the adapter does not report as fullscreen", async () => {
    const { outcome } = await runWithBrowser(
      {
        inner: { width: 1920, height: 1040 },
        outer: { width: 1920, height: 1080 },
        windowState: { state: "maximized" },
      },
      { headless: false, expectations: { fullscreen: true } },
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("window state is not fullscreen");
    expect(outcome.expected).toContain("windowState=fullscreen");
    expect(outcome.actual).toContain("windowState=maximized");
  });

  it("fails when navigation never reaches the instance", async () => {
    const { outcome } = await runWithBrowser({
      failGoto: failure("io", "net::ERR_CONNECTION_REFUSED"),
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("navigation failed");
    expect(outcome.actual).toContain("net::ERR_CONNECTION_REFUSED");
    expect(outcome.expected).toContain("completed loading");
  });

  it("fails and lists the uncaught page errors", async () => {
    const { outcome } = await runWithBrowser({
      pageErrors: ["Error: bind failed", "Error: second"],
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("2 uncaught error");
    expect(outcome.actual).toContain("Error: bind failed");
    expect(outcome.actual).toContain("Error: second");
  });

  it("fails when an expected selector has no text", async () => {
    const { outcome } = await runWithBrowser({ text: { body: null } });

    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("selector");
    expect(outcome.expected).toContain("body");
    expect(outcome.actual).toContain("body");
  });

  it("fails a layout viewport that does not match the expectation", async () => {
    const { outcome } = await runWithBrowser(
      {
        inner: { width: 1280, height: 720 },
        outer: { width: 1280, height: 800 },
      },
      { expectations: { innerSize: { width: 1440, height: 900 } } },
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.expected).toContain("innerSize=1440x900");
    expect(outcome.actual).toContain("innerSize=1280x720");
    expect(outcome.actual).toContain("outerSize=1280x800");
  });

  it("blocks, not fails, when the adapter cannot open a page", async () => {
    const { browser, outcome } = await runWithBrowser({
      failNewPage: failure("unsupported", "no page target available"),
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.detail).toContain("could not open a page");
    expect(outcome.detail).toContain("no page target available");
    expect(outcome.blockedReason?.code).toBe("adapter-missing");
    expect(browser.sessionsClosed).toBe(1);
  });

  it("blocks when the adapter cannot launch the browser", async () => {
    const { outcome } = await runWithBrowser({
      failLaunch: failure("prerequisite", "the browser binary is missing"),
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.detail).toContain("could not launch a browser");
    expect(outcome.detail).toContain("the browser binary is missing");
    expect(outcome.blockedReason?.code).toBe("adapter-missing");
  });
});

describe("runPageChecks without an adapter", () => {
  it("blocks with a hint that explains how to inject one, and exits 2", async () => {
    const { outcome } = await runWithoutAdapter();

    expect(outcome.status).toBe("blocked");
    expect(outcome.adapter.source).toBe("none");
    expect(outcome.viewport).toBeNull();
    expect(outcome.blockedReason?.code).toBe("adapter-missing");
    expect(outcome.hint).toContain("browser: { module:");
    expect(outcome.hint).toContain("verify/browser.mjs");
    expect(outcome.hint).toContain("newPage()");

    const result = toCheckResult(createPageCheckModule(), outcome, 0);
    expect(result.id).toBe("instance-pages");
    expect(result.hard).toBe(true);
    expect(decideExitCode([result])).toBe(2);
  });

  it("blocks with the loader failure and still shows the injection hint", async () => {
    const loadAdapter = async (): Promise<BrowserAdapterLoadResult> =>
      err({ ...failure("prerequisite", "the adapter exploded"), kind: "blocked" });
    const profile = buildProfile({ browser: { module: "verify/browser.mjs" } });
    const { outcome } = await runWithoutAdapter({ profile, loadAdapter });

    expect(outcome.status).toBe("blocked");
    expect(outcome.adapter.source).toBe("profile");
    expect(outcome.adapter.module).toBe("verify/browser.mjs");
    expect(outcome.adapter.failure).toBe("the adapter exploded");
    expect(outcome.detail).toContain("could not be loaded");
    expect(outcome.detail).toContain("the adapter exploded");
    expect(outcome.hint).toContain("browser: { module:");
  });

  it("loads the profile's adapter through the injected loader, and records its source", async () => {
    const fixture = createFixture();
    const browser = createFakeBrowser({
      text: { body: "loaded from profile" },
      writeScreenshot: (target, bytes) => {
        fixture.fs.seedFile(target, bytes);
      },
    });
    const loadAdapter = async (): Promise<BrowserAdapterLoadResult> =>
      ok({
        factory: browser,
        specifier: "file:///C:/repo/verify/browser.mjs",
        module: "verify/browser.mjs",
        exportName: "default",
      });
    const profile = buildProfile({ browser: { module: "verify/browser.mjs" } });
    const outcome = await execute(fixture, { profile, loadAdapter });

    expect(outcome.status).toBe("pass");
    expect(outcome.adapter.source).toBe("profile");
    expect(outcome.adapter.module).toBe("verify/browser.mjs");
    expect(outcome.adapter.exportName).toBe("default");
    expect(browser.launches).toEqual([{ headless: true }]);
  });
});

describe("page check source", () => {
  it("never fakes a window size by resizing the viewport", () => {
    const source = readFileSync(join(rmvRoot, "orchestration", "page-check.ts"), "utf8");
    expect(source).not.toMatch(/setViewportSize/i);
    expect(source).not.toMatch(/from\s+["'](?:playwright|puppeteer)/);
  });

  it("keeps the reference adapter out of the exported surface", () => {
    const index = readFileSync(join(rmvRoot, "index.ts"), "utf8");
    expect(index).not.toContain("cdp-adapter");
    expect(index).not.toContain("createCdpBrowserFactory");
  });
});
