/**
 * `run` is exercised through its command entry, with a fake machine and a real
 * plugin-repository `.mjs` fixture. The assertions are the external contract:
 * the single JSON report, exit codes, the builtin/custom source split, step
 * states under the two failure policies, and the artifacts under the work root.
 */
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseArgs } from "../cli/args";
import { runScenarioCommand, type RunCommandDeps } from "../cli/commands/run";
import { joinFsPath } from "../runtime/paths";
import { captureIo } from "./support/fake-capture";
import { createLaunchFixture, fixtureLoader, type LaunchFixture } from "./support/fake-launch";
import { createFakeBrowser } from "./support/fake-browser";
import type { ScenarioDefinition } from "../contracts/scenario";
import type { InstanceHandle } from "../orchestration/primitives";
import type { ScenarioContext } from "../orchestration/scenario-run";

interface CheckJson {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly source?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
}

interface RunJson {
  readonly schemaVersion: number;
  readonly command: string;
  readonly state: string;
  readonly exitCode: number;
  readonly checks: readonly CheckJson[];
  readonly steps: readonly { readonly id: string; readonly state: string }[];
  readonly artifacts?: { readonly report?: string; readonly evidence?: string };
}

interface CliRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

const scenarioPath = fileURLToPath(new URL("./support/fixture-scenario.mjs", import.meta.url));
const typescriptScenarioPath = fileURLToPath(new URL("./support/fixture-plugin-scenario.ts", import.meta.url));

async function run(
  fixture: LaunchFixture,
  argv: readonly string[],
  extra: Partial<RunCommandDeps> = {},
): Promise<CliRun> {
  const capture = captureIo();
  const deps: RunCommandDeps = {
    ports: fixture.ports,
    io: capture.io,
    runtime: fixture.runtime,
    loadDeclaration: fixtureLoader(fixture),
    ...extra,
  };
  const code = await runScenarioCommand(parseArgs(argv), deps);
  return { code, out: capture.stdout(), err: capture.stderr() };
}

function parseReport(text: string): RunJson {
  return JSON.parse(text) as RunJson;
}

function scenarioModule(id: string, steps: ScenarioDefinition["steps"]): unknown {
  return { default: { id, title: id, steps } };
}

describe("run command", () => {
  it("loads a plugin-repository .mjs scenario through the real import path and reports it", async () => {
    const fixture = createLaunchFixture();
    // The fake filesystem only needs the path to exist; the real import reads the
    // fixture file on disk, which is what proves the loader does not rewrite the
    // specifier or require the scenario to be registered in core.
    fixture.fs.seedFile(scenarioPath, "// real fixture is imported from disk\n");

    // Vitest evaluates modules inside a VM whose `new Function` has no dynamic
    // import callback, so the test injects the same dynamic import explicitly;
    // production uses the loader's new Function wrapper. The captured specifier
    // proves the loader resolves the plugin path rather than a core-owned copy.
    const imported: string[] = [];
    const result = await run(
      fixture,
      ["run", scenarioPath, "--work-root", fixture.paths.workRoot, "--json"],
      {
        importModule: async (specifier) => {
          imported.push(specifier);
          return import(/* @vite-ignore */ specifier);
        },
      },
    );

    expect(result.code).toBe(0);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatch(/fixture-scenario\.mjs$/);
    const report = parseReport(result.out);
    expect(report.command).toBe("run");
    expect(report.state).toBe("passed");
    expect(report.exitCode).toBe(0);
    expect(report.steps.map((step) => step.state)).toEqual(["done", "done", "done"]);
    const launch = report.checks.find((check) => check.id === "launch-host");
    expect(launch?.source).toBe("builtin");
    expect(launch?.status).toBe("pass");
    const custom = report.checks.find((check) => check.id === "plugin-custom");
    expect(custom?.source).toBe("custom");
    expect(custom?.status).toBe("pass");
    expect(result.err).toContain("fixture-plugin-smoke: passed");
    expect(result.err).toContain("report: ");

    const runsRoot = joinFsPath(fixture.paths.workRoot, "runs");
    expect(await fixture.fs.exists(runsRoot)).toBe(true);
    const runs = await fixture.fs.list(runsRoot);
    expect(runs.ok).toBe(true);
    if (runs.ok) {
      expect(runs.value.length).toBe(1);
      const runDir = joinFsPath(runsRoot, runs.value[0]?.name ?? "");
      expect(await fixture.fs.exists(joinFsPath(runDir, "run.json"))).toBe(true);
      expect(await fixture.fs.exists(joinFsPath(runDir, "evidence", "evidence.json"))).toBe(true);
    }
  });

  it("loads a TypeScript scenario that imports only the public entry", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile(typescriptScenarioPath, "// real TypeScript fixture is imported from disk\n");

    const result = await run(
      fixture,
      ["run", typescriptScenarioPath, "--work-root", fixture.paths.workRoot, "--json"],
      { importModule: async (specifier) => import(/* @vite-ignore */ specifier) },
    );

    expect(result.code).toBe(0);
    const report = parseReport(result.out);
    expect(report.state).toBe("passed");
    const check = report.checks.find((item) => item.id === "plugin-ts-check");
    expect(check?.status).toBe("pass");
    expect(check?.source).toBe("custom");
  });

  it("rejects a built-in step that carries a run() body instead of silently ignoring it", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile("C:\\fake\\repo\\verify\\bad.ts", "// fixture path\n");
    const module = scenarioModule("bad-scenario", [
      {
        id: "launch-host",
        title: "launch",
        kind: "launch",
        run: () => [],
      } as ScenarioDefinition["steps"][number],
    ]);

    const result = await run(
      fixture,
      ["run", "verify/bad.ts", "--work-root", fixture.paths.workRoot, "--json"],
      { importModule: async () => module },
    );

    expect(result.code).toBe(2);
    const payload = JSON.parse(result.out) as {
      readonly ok: boolean;
      readonly error: { readonly message: string; readonly stage: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error.stage).toBe("scenario-validate");
    expect(payload.error.message).toContain("provides run()");
  });

  it("stops at the first failing step with --fail-fast and keeps going with --collect-all", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile("C:\\fake\\repo\\verify\\policy.ts", "// fixture path\n");
    const module = scenarioModule("policy", [
      {
        id: "first",
        title: "first",
        kind: "custom",
        run: () => [
          {
            checkId: "first-check",
            ok: false,
            detail: "the first check failed",
            expected: "a passing invariant",
            actual: "the invariant did not hold",
            hint: "fix the invariant",
          },
        ],
      },
      {
        id: "second",
        title: "second",
        kind: "custom",
        run: () => [{ checkId: "second-check", ok: true, detail: "the second check ran" }],
      },
    ]);

    const failFast = await run(
      fixture,
      ["run", "verify/policy.ts", "--work-root", fixture.paths.workRoot, "--fail-fast", "--json"],
      { importModule: async () => module },
    );
    expect(failFast.code).toBe(1);
    const failFastReport = parseReport(failFast.out);
    expect(failFastReport.steps.map((step) => step.state)).toEqual(["failed", "skipped"]);
    const failedCheck = failFastReport.checks.find((check) => check.id === "first-check");
    expect(failedCheck?.status).toBe("fail");
    expect(failedCheck?.expected).toBe("a passing invariant");
    expect(failedCheck?.actual).toBe("the invariant did not hold");
    expect(failedCheck?.hint).toBe("fix the invariant");
    expect(failFastReport.checks.some((check) => check.id === "second-check")).toBe(false);

    const collectAll = await run(
      fixture,
      ["run", "verify/policy.ts", "--work-root", fixture.paths.workRoot, "--collect-all", "--json"],
      { importModule: async () => module },
    );
    expect(collectAll.code).toBe(1);
    const collectReport = parseReport(collectAll.out);
    expect(collectReport.steps.map((step) => step.state)).toEqual(["failed", "done"]);
    expect(collectReport.checks.some((check) => check.id === "second-check")).toBe(true);
  });

  it("accepts --concurrency and rejects conflicting or out-of-range policies with exit 2", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile("C:\\fake\\repo\\verify\\two.ts", "// fixture path\n");
    const module = {
      scenarios: [
        {
          id: "one",
          title: "one",
          steps: [{ id: "one-step", title: "one", kind: "custom", run: () => [{ ok: true, detail: "one ran" }] }],
        },
        {
          id: "two",
          title: "two",
          steps: [{ id: "two-step", title: "two", kind: "custom", run: () => [{ ok: true, detail: "two ran" }] }],
        },
      ],
    };

    const parallel = await run(
      fixture,
      ["run", "verify/two.ts", "--work-root", fixture.paths.workRoot, "--concurrency", "2", "--json"],
      { importModule: async () => module },
    );
    expect(parallel.code).toBe(0);
    const parallelReport = parseReport(parallel.out);
    expect(parallelReport.checks.map((check) => check.id).sort()).toEqual(["one-step", "two-step"]);

    const zero = await run(
      fixture,
      ["run", "verify/two.ts", "--work-root", fixture.paths.workRoot, "--concurrency", "0", "--json"],
      { importModule: async () => module },
    );
    expect(zero.code).toBe(2);

    const conflict = await run(
      fixture,
      [
        "run",
        "verify/two.ts",
        "--work-root",
        fixture.paths.workRoot,
        "--fail-fast",
        "--collect-all",
        "--json",
      ],
      { importModule: async () => module },
    );
    expect(conflict.code).toBe(2);
    const conflictPayload = JSON.parse(conflict.out) as { readonly error: { readonly message: string } };
    expect(conflictPayload.error.message).toContain("mutually exclusive");
  });

  it("keeps human stdout to check lines and the verifiable tail", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile(scenarioPath, "// real fixture is imported from disk\n");
    const result = await run(fixture, ["run", scenarioPath, "--work-root", fixture.paths.workRoot], {
      importModule: async (specifier) => import(/* @vite-ignore */ specifier),
    });

    expect(result.code).toBe(0);
    const lines = result.out.trimEnd().split("\n");
    for (const line of lines) {
      expect(line).toMatch(/^(ok|fail|skip|blocked) |^  (expected|actual|hint): |^report: |^report-sha256: |^evidence: /);
    }
    expect(lines.some((line) => line.startsWith("ok launch-host "))).toBe(true);
    expect(result.err).toContain("fixture-plugin-smoke: passed");
  });

  it("stops scheduling later scenarios under --fail-fast", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile("C:\\fake\\repo\\verify\\batch.ts", "// fixture path\n");
    let secondRan = false;
    const module = {
      scenarios: [
        {
          id: "first-scenario",
          title: "the first scenario fails",
          steps: [
            {
              id: "first-fail",
              title: "first",
              kind: "custom",
              run: () => [{ checkId: "first-fail", ok: false, detail: "the first scenario failed" }],
            },
          ],
        },
        {
          id: "second-scenario",
          title: "the second scenario must not start",
          steps: [
            {
              id: "second-run",
              title: "second",
              kind: "custom",
              run: () => {
                secondRan = true;
                return [{ checkId: "second-run", ok: true, detail: "the second scenario ran" }];
              },
            },
          ],
        },
      ],
    };

    const result = await run(
      fixture,
      ["run", "verify/batch.ts", "--work-root", fixture.paths.workRoot, "--concurrency", "1", "--fail-fast", "--json"],
      { importModule: async () => module },
    );

    expect(result.code).toBe(1);
    expect(secondRan).toBe(false);
    const report = parseReport(result.out);
    expect(report.checks.some((check) => check.id === "second-run")).toBe(false);
    const notes = (report as RunJson & { readonly notes?: readonly string[] }).notes ?? [];
    expect(notes.join("\n")).toContain("not run");
  });

  it("rejects a custom check id that is not lowercase kebab-case", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile("C:\\fake\\repo\\verify\\bad-id.ts", "// fixture path\n");
    const module = {
      default: {
        id: "bad-id-scenario",
        title: "a custom check must use the built-in id shape",
        steps: [
          {
            id: "bad-custom-id",
            title: "a custom check",
            kind: "custom",
            run: () => [{ checkId: "Plugin Custom!", ok: true, detail: "this id is invalid" }],
          },
        ],
      },
    };

    const result = await run(
      fixture,
      ["run", "verify/bad-id.ts", "--work-root", fixture.paths.workRoot, "--json"],
      { importModule: async () => module },
    );

    expect(result.code).toBe(1);
    const report = parseReport(result.out);
    const check = report.checks.find((item) => item.id === "bad-custom-id");
    expect(check?.status).toBe("fail");
    expect(check?.source).toBe("custom");
    expect(check?.expected).toContain("lowercase kebab-case");
  });

  it("runs the logs and evidence built-ins and records the evidence under the run directory", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile("C:\\fake\\repo\\verify\\logs.ts", "// fixture path\n");
    const module = {
      default: {
        id: "logs-evidence",
        title: "the scenario reads logs and records evidence",
        steps: [
          { id: "launch-host", title: "launch", kind: "launch" },
          { id: "host-logs", title: "read the host logs", kind: "logs", params: { bytes: 1000 } },
          {
            id: "plugin-note",
            title: "record a note",
            kind: "evidence",
            params: { name: "plugin-note", text: "the plugin observed the host" },
          },
          { id: "stop-host", title: "stop", kind: "stop" },
        ],
      },
    };

    const result = await run(
      fixture,
      ["run", "verify/logs.ts", "--work-root", fixture.paths.workRoot, "--json"],
      { importModule: async () => module },
    );

    expect(result.code).toBe(0);
    const report = parseReport(result.out);
    expect(report.checks.find((check) => check.id === "host-logs")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "plugin-note")?.status).toBe("pass");
    expect((report as RunJson & { evidence?: { itemCount?: number } }).evidence?.itemCount).toBeGreaterThanOrEqual(3);
  });

  it("exposes the L3 escape hatch: launch hooks, raw process, and a browser page handle", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile("C:\\fake\\repo\\verify\\l3.ts", "// fixture path\n");
    const fakeBrowser = createFakeBrowser({ url: "http://127.0.0.1:53211/", text: { "#app": "hello" } });
    const hooks: string[] = [];
    let launchedPid = 0;
    const module = {
      default: {
        id: "l3-escape",
        title: "the plugin uses the L3 escape hatch",
        hooks: {
          beforeLaunch: (_context: ScenarioContext, info: { readonly home: string; readonly dir: string; readonly profile: string }) => {
            hooks.push(`before:${info.profile}`);
          },
          afterLaunch: (_context: ScenarioContext, info: { readonly instance: unknown }) => {
            const handle = info.instance as InstanceHandle;
            launchedPid = handle.pid;
            hooks.push(`after:${handle.pid}:${handle.isAlive()}:${handle.rawProcess().isAlive()}`);
          },
        },
        steps: [
          { id: "launch-host", title: "launch", kind: "launch" },
          {
            id: "page-handle",
            title: "the plugin reads its page through the handle",
            kind: "custom",
            run: async (context: ScenarioContext) => {
              const handle = context.instance;
              if (handle === null) return [{ ok: false, detail: "no instance handle" }];
              const page = await handle.page();
              if (!page.ok) return [{ ok: false, detail: page.error.message }];
              const text = await page.value.text("#app");
              return [
                {
                  checkId: "page-handle",
                  ok: text.ok && text.value === "hello",
                  detail: text.ok ? `page text: ${text.value ?? "(null)"}` : text.error.message,
                  expected: "the page handle reads #app",
                  actual: text.ok ? String(text.value) : text.error.message,
                },
              ];
            },
          },
          { id: "stop-host", title: "stop", kind: "stop" },
        ],
      },
    };

    const result = await run(
      fixture,
      ["run", "verify/l3.ts", "--work-root", fixture.paths.workRoot, "--json"],
      { importModule: async () => module, adapter: fakeBrowser },
    );

    expect(result.code).toBe(0);
    expect(hooks).toEqual(["before:web", "after:4242:true:true"]);
    expect(launchedPid).toBe(4242);
    expect(fakeBrowser.launches).toHaveLength(1);
    expect(fakeBrowser.pages).toHaveLength(1);
    expect(fakeBrowser.closedPages).toBe(1);
    expect(fakeBrowser.sessionsClosed).toBe(1);
    const report = parseReport(result.out);
    expect(report.checks.find((check) => check.id === "page-handle")?.source).toBe("custom");
  });
});

describe("run --dry-run", () => {
  it("plans the scenario file and its steps without creating a run directory or executing anything", async () => {
    const fixture = createLaunchFixture();
    fixture.fs.seedFile(scenarioPath, "// real fixture is imported from disk\n");

    const result = await run(
      fixture,
      ["run", scenarioPath, "--work-root", fixture.paths.workRoot, "--dry-run", "--json"],
      { importModule: async (specifier) => import(/* @vite-ignore */ specifier) },
    );

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.trim().split("\n")).toHaveLength(1);
    const doc = JSON.parse(result.out) as {
      readonly schemaVersion: number;
      readonly command: string;
      readonly dryRun?: boolean;
      readonly plan?: {
        readonly runId: string;
        readonly runDir: string;
        readonly evidenceDir: string;
        readonly scenarioFile: string;
        readonly scenarios: readonly { readonly id: string; readonly stepCount: number }[];
        readonly scenarioCount: number;
        readonly stepCount: number;
        readonly concurrency: number;
        readonly failFast: boolean;
        readonly collectAll: boolean;
      };
    };
    expect(doc.schemaVersion).toBe(1);
    expect(doc.command).toBe("run");
    expect(doc.dryRun).toBe(true);
    expect(doc.plan?.runId.startsWith("run-")).toBe(true);
    expect(doc.plan?.scenarioFile).toBe(scenarioPath);
    expect(doc.plan?.scenarioCount).toBe(1);
    expect(doc.plan?.stepCount).toBe(3);
    expect(doc.plan?.scenarios[0]?.id).toBe("fixture-plugin-smoke");
    expect(doc.plan?.scenarios[0]?.stepCount).toBe(3);
    expect(doc.plan?.concurrency).toBe(1);
    expect(doc.plan?.failFast).toBe(false);
    expect(doc.plan?.collectAll).toBe(false);

    expect(fixture.fs.writes).toEqual([]);
    expect(await fixture.fs.exists(joinFsPath(fixture.paths.workRoot, "runs"))).toBe(false);
    expect(fixture.process.spawns).toHaveLength(0);
    expect(fixture.http.request).toBeDefined();
    expect((fixture.http as { readonly requests?: readonly unknown[] }).requests ?? []).toHaveLength(0);
  });
});
