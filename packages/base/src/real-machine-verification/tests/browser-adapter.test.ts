/**
 * The adapter seam: loader behavior and the reference CDP adapter's command
 * mapping. No real browser, no network, no child process.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import type { BrowserProbeFactory } from "../contracts/ports";
import { err, failure, ok } from "../contracts/result";
import {
  loadBrowserAdapter,
  missingBrowserAdapterHint,
  type BrowserAdapterImport,
} from "../adapters/browser/loader";
import {
  createCdpBrowserFactory,
  resolveBrowserExecutable,
  type CdpHandlers,
  type CdpPageHandle,
  type CdpTransport,
} from "../adapters/browser/cdp-adapter";
import { FakeFs } from "./support/fake-fs";
import { FAKE_PNG_BYTES } from "./support/fake-browser";

// The loader turns the resolved path into a real file URL, so the fake repo root
// must be a path the host (including the Linux CI runner) can convert.
const REPO_ROOT = process.platform === "win32" ? "C:/repo" : "/repo";

function fakeFactory(): BrowserProbeFactory {
  return {
    async launch() {
      return err(failure("unsupported", "the test factory does not launch"));
    },
  };
}

function seedAdapter(fs: FakeFs, module = "verify/browser.mjs"): void {
  fs.seedFile(`${REPO_ROOT}/${module}`, "export default {};\n");
}

function loaderFor(
  fs: FakeFs,
  declaration: { readonly module: string; readonly exportName?: string },
  importModule: BrowserAdapterImport,
) {
  return loadBrowserAdapter({ fs, repoRoot: REPO_ROOT, declaration, importModule });
}

describe("loadBrowserAdapter", () => {
  it("imports a repository-relative module through a file URL", async () => {
    const fs = new FakeFs(REPO_ROOT);
    seedAdapter(fs);
    const factory = fakeFactory();
    const specifiers: string[] = [];
    const result = await loaderFor(fs, { module: "verify/browser.mjs" }, async (specifier) => {
      specifiers.push(specifier);
      return { default: factory };
    });

    expect(result.ok).toBe(true);
    expect(specifiers).toEqual([pathToFileURL(`${REPO_ROOT}/verify/browser.mjs`).href]);
    if (result.ok) {
      expect(result.value.factory).toBe(factory);
      expect(result.value.exportName).toBe("default");
      expect(result.value.module).toBe("verify/browser.mjs");
    }
  });

  it("uses the named export the profile asks for", async () => {
    const fs = new FakeFs(REPO_ROOT);
    seedAdapter(fs);
    const factory = fakeFactory();
    const result = await loaderFor(
      fs,
      { module: "verify/browser.mjs", exportName: "createBrowserAdapter" },
      async () => ({ default: {}, createBrowserAdapter: factory }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.factory).toBe(factory);
  });

  it("accepts a CommonJS module whose namespace is the factory", async () => {
    const fs = new FakeFs(REPO_ROOT);
    seedAdapter(fs);
    const factory = fakeFactory();
    const result = await loaderFor(fs, { module: "verify/browser.mjs" }, async () => factory);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.factory).toBe(factory);
      expect(result.value.exportName).toBe("module");
    }
  });

  it("blocks a missing relative module without importing anything", async () => {
    const fs = new FakeFs(REPO_ROOT);
    let imports = 0;
    const result = await loaderFor(fs, { module: "verify/missing.mjs" }, async () => {
      imports += 1;
      return {};
    });

    expect(result.ok).toBe(false);
    expect(imports).toBe(0);
    if (!result.ok) {
      expect(result.error.kind).toBe("blocked");
      expect(result.error.code).toBe("prerequisite");
      expect(result.error.message).toContain("does not exist");
      expect(result.error.hint).toContain("browser: { module:");
    }
  });

  it("blocks a module resolution failure and names the missing package", async () => {
    const fs = new FakeFs(REPO_ROOT);
    const result = await loaderFor(fs, { module: "@scope/browser-adapter" }, async () => {
      throw Object.assign(new Error("Cannot find package '@scope/browser-adapter'"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("blocked");
      expect(result.error.code).toBe("prerequisite");
      expect(result.error.message).toContain("@scope/browser-adapter");
      expect(result.error.hint).toContain("install @scope/browser-adapter");
    }
  });

  it("blocks an unsupported module format with a Node upgrade hint", async () => {
    const fs = new FakeFs(REPO_ROOT);
    seedAdapter(fs, "verify/browser.ts");
    const result = await loaderFor(fs, { module: "verify/browser.ts" }, async () => {
      throw Object.assign(new Error("Unknown file extension .ts"), {
        code: "ERR_UNKNOWN_FILE_EXTENSION",
      });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("blocked");
      expect(result.error.code).toBe("unsupported");
      expect(result.error.hint).toContain("22.6+");
    }
  });

  it("fails a module that throws while loading, and keeps the injection hint", async () => {
    const fs = new FakeFs(REPO_ROOT);
    seedAdapter(fs);
    const result = await loaderFor(fs, { module: "verify/browser.mjs" }, async () => {
      throw new SyntaxError("Unexpected token");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failed");
      expect(result.error.code).toBe("invalid-input");
      expect(result.error.message).toContain("threw while loading");
      expect(result.error.hint).toContain("adapter must only define its factory");
      expect(result.error.hint).toContain("browser: { module:");
    }
  });

  it("fails a module whose named export does not exist", async () => {
    const fs = new FakeFs(REPO_ROOT);
    seedAdapter(fs);
    const result = await loaderFor(
      fs,
      { module: "verify/browser.mjs", exportName: "createBrowserAdapter" },
      async () => ({ default: fakeFactory() }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failed");
      expect(result.error.message).toContain("no export named");
    }
  });

  it("fails an export that is not a BrowserProbeFactory", async () => {
    const fs = new FakeFs(REPO_ROOT);
    seedAdapter(fs);
    const result = await loaderFor(fs, { module: "verify/browser.mjs" }, async () => ({
      default: { launch: "not a function" },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failed");
      expect(result.error.message).toContain("is not a BrowserProbeFactory");
    }
  });
});

describe("missingBrowserAdapterHint", () => {
  it("shows the profile shape the adapter must satisfy", () => {
    const hint = missingBrowserAdapterHint();
    expect(hint).toContain(`browser: { module: "verify/browser.mjs" }`);
    expect(hint).toContain("exportName");
    expect(hint).toContain("newPage()");
    expect(hint).toContain("screenshot()");
    expect(hint).toContain("exit 2");
  });
});

/* --------------------------------------------------------------------- CDP */

interface RecordedCommand {
  readonly id: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
}

interface FakeTransport {
  readonly transport: CdpTransport;
  readonly commands: RecordedCommand[];
  emit(method: string, params: unknown, sessionId?: string): void;
}

/** A CDP server that answers from the test's script, never from a socket. */
function createFakeTransport(options: { readonly windowState?: string } = {}): FakeTransport {
  const commands: RecordedCommand[] = [];
  let handlers: CdpHandlers | undefined;

  const respond = (command: RecordedCommand, result: unknown): void => {
    handlers?.onMessage(JSON.stringify({ id: command.id, result }));
  };

  const connection = {
    send(data: string): void {
      const command = JSON.parse(data) as RecordedCommand;
      commands.push(command);
      queueMicrotask(() => {
        if (command.method === "Target.createTarget") {
          respond(command, { targetId: "target-1" });
        } else if (command.method === "Target.attachToTarget") {
          respond(command, { sessionId: "session-1" });
        } else if (command.method === "Runtime.evaluate") {
          const expression = String(command.params?.expression ?? "");
          const value = expression.includes("innerWidth")
            ? { width: 1440, height: 900 }
            : expression.includes("outerWidth")
              ? { width: 1440, height: 900 }
              : expression.includes("document.querySelector")
                ? "hello"
                : "complete";
          respond(command, { result: { value } });
        } else if (command.method === "Page.captureScreenshot") {
          respond(command, { data: Buffer.from(FAKE_PNG_BYTES).toString("base64") });
        } else if (command.method === "Browser.getWindowForTarget") {
          respond(command, { windowId: 7 });
        } else if (command.method === "Browser.getWindowBounds") {
          respond(command, {
            bounds: { windowState: options.windowState ?? "normal", width: 1440, height: 900 },
          });
        } else {
          respond(command, {});
        }
      });
    },
    close(): void {
      // The client owns the socket lifetime; no state to release in the fake.
    },
  };

  return {
    transport: {
      async connect(_endpoint, incoming) {
        handlers = incoming;
        return connection;
      },
    },
    commands,
    emit(method, params, sessionId) {
      handlers?.onMessage(JSON.stringify({ method, params, sessionId }));
    },
  };
}

describe("createCdpBrowserFactory", () => {
  it("maps page handles onto the real CDP command sequence", async () => {
    const fake = createFakeTransport({ windowState: "fullscreen" });
    let launcherClosed = false;
    const factory = createCdpBrowserFactory({
      launcher: async () => ({
        endpoint: "ws://fake",
        close: async () => {
          launcherClosed = true;
        },
      }),
      transport: fake.transport,
      windowState: "fullscreen",
    });

    const launched = await factory.launch({ headless: true });
    expect(launched.ok).toBe(true);
    if (!launched.ok) return;
    const session = launched.value;
    const opened = await session.newPage();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const page = opened.value as CdpPageHandle;

    expect(fake.commands.map((command) => command.method)).toEqual([
      "Target.createTarget",
      "Target.attachToTarget",
      "Page.enable",
      "Runtime.enable",
      "Log.enable",
      "Browser.getWindowForTarget",
      "Browser.setWindowBounds",
    ]);
    const bounds = fake.commands.find((command) => command.method === "Browser.setWindowBounds");
    expect(bounds?.params).toEqual({ windowId: 7, bounds: { windowState: "fullscreen" } });
    expect(fake.commands.find((command) => command.method === "Runtime.enable")?.sessionId).toBe(
      "session-1",
    );

    const inner = await page.innerSize();
    expect(inner.ok && inner.value).toEqual({ width: 1440, height: 900 });
    const outer = await page.outerSize();
    expect(outer.ok && outer.value).toEqual({ width: 1440, height: 900 });
    expect(await page.text("body")).toEqual(ok("hello"));
    expect(page.pageErrors()).toEqual([]);

    const directory = await mkdtemp(join(tmpdir(), "dsh-cdp-test-"));
    try {
      const file = join(directory, "shot.png");
      const shot = await page.screenshot(file);
      expect(shot.ok).toBe(true);
      const bytes = await readFile(file);
      expect(Array.from(bytes)).toEqual(Array.from(FAKE_PNG_BYTES));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    fake.emit(
      "Runtime.exceptionThrown",
      { exceptionDetails: { exception: { description: "Error: boom" } } },
      "session-1",
    );
    fake.emit("Log.entryAdded", { entry: { level: "error", text: "console failed" } }, "session-1");
    expect(page.pageErrors()).toEqual(["Error: boom", "console failed"]);

    const state = await page.windowState();
    expect(state.ok && state.value.state).toBe("fullscreen");

    await page.close();
    await session.close();
    expect(launcherClosed).toBe(true);
    expect(fake.commands.filter((command) => command.method === "Target.closeTarget")).toHaveLength(1);
  });

  it("does not touch the window when the adapter is left in the normal state", async () => {
    const fake = createFakeTransport();
    const factory = createCdpBrowserFactory({
      launcher: async () => ({ endpoint: "ws://fake", close: async () => {} }),
      transport: fake.transport,
    });
    const launched = await factory.launch({ headless: true });
    expect(launched.ok).toBe(true);
    if (!launched.ok) return;
    const opened = await launched.value.newPage();
    expect(opened.ok).toBe(true);
    expect(fake.commands.some((command) => command.method === "Browser.setWindowBounds")).toBe(false);
    await launched.value.close();
  });

  it("closes the launched browser when the CDP connection fails", async () => {
    let closed = false;
    const factory = createCdpBrowserFactory({
      launcher: async () => ({
        endpoint: "ws://fake",
        close: async () => {
          closed = true;
        },
      }),
      transport: {
        async connect() {
          throw new Error("connection refused");
        },
      },
    });

    const result = await factory.launch({ headless: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("prerequisite");
      expect(result.error.message).toContain("connection refused");
    }
    expect(closed).toBe(true);
  });
});

describe("resolveBrowserExecutable", () => {
  it("prefers an explicit path and accepts the documented environment override", () => {
    expect(
      resolveBrowserExecutable({
        executablePath: "C:\\tools\\chrome.exe",
        platform: "win32",
        env: {},
        exists: (path) => path === "C:\\tools\\chrome.exe",
      }),
    ).toBe("C:\\tools\\chrome.exe");

    expect(
      resolveBrowserExecutable({
        platform: "win32",
        env: { DSH_BROWSER_PATH: "D:\\browser\\msedge.exe" },
        exists: (path) => path === "D:\\browser\\msedge.exe",
      }),
    ).toBe("D:\\browser\\msedge.exe");
  });

  it("returns null when no candidate exists", () => {
    expect(resolveBrowserExecutable({ platform: "linux", env: {}, exists: () => false })).toBeNull();
  });
});
