/**
 * `dsh-verify concurrent` — the N-instance contract, all in-process.
 *
 * Each test drives the real command module against a fake machine, so the claims
 * under test are the command's claims: N instances launch, the four isolation
 * fields are pairwise distinct, every launched instance is verifiably dead, and
 * one failed launch does not cost the others their cleanup.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args";
import { runConcurrentCommand } from "../cli/commands/concurrent";
import type { ProfileName } from "../contracts/branding";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../declaration/loader";
import { err, failure } from "../contracts/result";
import { createInstancesDistinctCheck } from "../orchestration/checks/instances-distinct";
import { createTeardownCleanCheck } from "../orchestration/checks/teardown-clean";
import type { ConcurrentContext, ConcurrentRow } from "../orchestration/concurrent";
import { captureIo } from "./support/fake-capture";
import {
  concurrentLoader,
  createConcurrentFixture,
  seedProfile,
  type ConcurrentFixture,
} from "./support/fake-concurrent";
import { declarationLoader } from "./support/fake-machine";
import { makePorts } from "./support/fake-ports";

type Loader = (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;

/** Run the command in-process and collect both streams and the exit code. */
async function runConcurrent(
  fixture: ConcurrentFixture,
  argv: readonly string[],
  loadDeclaration: Loader = concurrentLoader(fixture),
): Promise<{ readonly code: number; readonly captured: ReturnType<typeof captureIo> }> {
  const captured = captureIo();
  const args = parseArgs(["concurrent", ...argv]);
  const code = await runConcurrentCommand(args, {
    ports: fixture.ports,
    io: captured.io,
    runtime: fixture.runtime,
    loadDeclaration,
  });
  return { code, captured };
}

/** Assert `--json` put exactly one JSON document on stdout and parse it. */
function reportOf(captured: ReturnType<typeof captureIo>): any {
  const stdout = captured.stdout().trim();
  expect(stdout.length).toBeGreaterThan(0);
  // One document, not one line: run reports are pretty-printed, failure documents
  // are single-line, and both are exactly one JSON value on stdout.
  const parsed: unknown = JSON.parse(stdout);
  expect(typeof parsed).toBe("object");
  return parsed;
}

/** One check from the report, by id. */
function checkOf(report: any, id: string): any {
  const check = report.checks.find((entry: any) => entry.id === id);
  expect(check).toBeDefined();
  return check;
}

/** Read the per-instance evidence artifact the report points at. */
function instanceEvidence(fixture: ConcurrentFixture, report: any): any {
  const path = report.artifacts.instances as string | undefined;
  expect(path).toBeDefined();
  return fixture.fs.readJsonSync(path as string);
}

function checkContext(rows: readonly ConcurrentRow[]): ConcurrentContext {
  return {
    count: rows.length,
    rows,
    failure: null,
    workRoot: "C:\\fake-work",
    dshHome: "C:\\fake-dsh-home",
    ports: makePorts(),
  };
}

/** A ready row whose four isolation fields are distinct from `rowFixture(i)`'s. */
function rowFixture(index: number, overrides: Partial<ConcurrentRow> = {}): ConcurrentRow {
  return {
    index,
    instanceId: `id-${index}`,
    profile: "web" as ProfileName,
    dir: `C:\\fake-work\\instances\\id-${index}`,
    home: `C:\\fake-work\\instances\\id-${index}\\home`,
    workdir: `C:\\fake-work\\instances\\id-${index}\\workdir`,
    pluginLogDir: `C:\\fake-work\\instances\\id-${index}\\workdir\\cache\\logs`,
    pid: 4240 + index,
    port: 53210 + index,
    tokenPresent: true,
    readiness: "ready",
    failure: null,
    cleanup: null,
    ...overrides,
  };
}

const CLEAN_CLEANUP = {
  verified: true,
  stopped: true,
  alreadyGone: false,
  aliveAfter: false,
  error: null,
} as const;

describe("concurrent: happy paths", () => {
  it("defaults to two instances and passes both checks", async () => {
    const fixture = createConcurrentFixture();
    const { code, captured } = await runConcurrent(fixture, ["--json"]);

    expect(code, captured.stdout()).toBe(0);
    const report = reportOf(captured);
    expect(report.command).toBe("concurrent");
    expect(report.state).toBe("passed");
    expect(report.exitCode).toBe(0);
    expect(report.checks.map((c: any) => c.id)).toEqual(["instances-distinct", "teardown-clean"]);
    expect(report.checks.every((c: any) => c.status === "pass")).toBe(true);
    expect(report.steps.map((s: any) => s.id)).toEqual(["plan", "launch", "cleanup"]);
    expect(report.steps.every((s: any) => s.state === "done")).toBe(true);

    // Two isolated spawns, two kills, nothing left running.
    expect(fixture.multi.started.map((entry) => entry.pid)).toEqual([4242, 4243]);
    expect(fixture.multi.started.map((entry) => entry.port)).toEqual([53211, 53212]);
    expect(fixture.multi.kills.map((entry) => entry.pid).sort()).toEqual([4242, 4243]);
    expect(fixture.multi.kills.every((entry) => fixture.multi.isAlive(entry.pid) === false)).toBe(true);

    // The per-instance comparison is in the human lines and in the evidence.
    expect(report.notes.filter((note: string) => note.startsWith("#"))).toHaveLength(2);
    expect(report.notes.join("\n")).toContain("home C:\\fake\\repo\\.scratch\\verify\\instances");
    expect(report.notes.join("\n")).toContain("plugin-log");
    const evidence = instanceEvidence(fixture, report);
    expect(evidence.rows).toHaveLength(2);
    expect(evidence.rows[0].port).not.toBe(evidence.rows[1].port);
    expect(evidence.rows[0].home).not.toBe(evidence.rows[1].home);
    expect(evidence.rows[0].workdir).not.toBe(evidence.rows[1].workdir);
    expect(evidence.rows[0].pluginLogDir).not.toBe(evidence.rows[1].pluginLogDir);
    expect(evidence.residualPids).toEqual([]);
    expect(checkOf(report, "teardown-clean").detail).toContain("stopped 2 instance(s)");
  });

  it("launches one instance when --count is 1", async () => {
    const fixture = createConcurrentFixture();
    const { code, captured } = await runConcurrent(fixture, ["--count", "1", "--json"]);

    expect(code).toBe(0);
    const report = reportOf(captured);
    expect(report.state).toBe("passed");
    expect(fixture.multi.spawns).toHaveLength(1);
    expect(fixture.multi.kills).toHaveLength(1);
    expect(checkOf(report, "instances-distinct").detail).toContain("1 instance(s) are pairwise distinct");
  });

  it("launches three instances with three distinct ports", async () => {
    const fixture = createConcurrentFixture();
    const { code, captured } = await runConcurrent(fixture, ["--count", "3", "--json"]);

    expect(code).toBe(0);
    const report = reportOf(captured);
    expect(report.state).toBe("passed");
    expect(fixture.multi.started.map((entry) => entry.port)).toEqual([53211, 53212, 53213]);
    expect(fixture.multi.kills).toHaveLength(3);
    const detail = checkOf(report, "instances-distinct").detail as string;
    expect(detail).toContain("53211, 53212, 53213");
  });

  it("prints human check lines and the per-instance table on stdout", async () => {
    const fixture = createConcurrentFixture();
    const { code, captured } = await runConcurrent(fixture, ["--count", "2"]);

    expect(code).toBe(0);
    const stdout = captured.stdout();
    expect(stdout).toContain("ok instances-distinct");
    expect(stdout).toContain("ok teardown-clean");
    expect(stdout).toContain("instances (2):");
    expect(stdout).toContain("port 53211");
    expect(stdout).toContain("start-cwd");
    expect(stdout).toContain("plugin-log");
    expect(stdout).toContain("report:");
    expect(() => JSON.parse(stdout)).toThrow();
    expect(captured.stderr()).toContain("dsh-verify concurrent:");
  });
});

describe("concurrent: isolation failures", () => {
  it("fails instances-distinct when two instances share a port", async () => {
    const fixture = createConcurrentFixture({ portFor: () => 53211 });
    const { code, captured } = await runConcurrent(fixture, ["--count", "2", "--json"]);

    expect(code).toBe(1);
    const report = reportOf(captured);
    expect(report.state).toBe("failed");
    const distinct = checkOf(report, "instances-distinct");
    expect(distinct.status).toBe("fail");
    expect(distinct.actual).toContain("port");
    expect(distinct.actual).toContain("#1");
    expect(distinct.actual).toContain("#2");
    expect(distinct.expected).toContain("pairwise distinct");
    expect(distinct.hint).toBeTruthy();
    // The failed claim does not cost the run its cleanup.
    expect(checkOf(report, "teardown-clean").status).toBe("pass");
    expect(fixture.multi.kills).toHaveLength(2);
    expect(fixture.multi.isAlive(4242)).toBe(false);
    expect(fixture.multi.isAlive(4243)).toBe(false);
  });

  it("keeps cleaning up when the second instance fails to start", async () => {
    const fixture = createConcurrentFixture({
      spawnFailures: { 1: failure("prerequisite", "the host exited before printing its token URL") },
    });
    const { code, captured } = await runConcurrent(fixture, ["--count", "3", "--json"]);

    expect(code).toBe(1);
    const report = reportOf(captured);
    expect(report.state).toBe("failed");
    const distinct = checkOf(report, "instances-distinct");
    expect(distinct.status).toBe("fail");
    expect(distinct.actual).toContain("instance 2");
    expect(distinct.actual).toContain("exited before printing");
    // The two instances that did start were both stopped; the failed one was reaped
    // by executeInstance, so there is no orphan for teardown-clean to report.
    const teardown = checkOf(report, "teardown-clean");
    expect(teardown.status).toBe("pass");
    expect(teardown.detail).toContain("stopped 2 instance(s)");
    expect(fixture.multi.kills.map((entry) => entry.pid).sort()).toEqual([4242, 4244]);
    expect(fixture.multi.started.map((entry) => entry.pid)).toEqual([4242, 4244]);
    expect(fixture.multi.isAlive(4242)).toBe(false);
    expect(fixture.multi.isAlive(4244)).toBe(false);
    expect(report.steps.find((step: any) => step.id === "launch").state).toBe("failed");
  });

  it("reports a surviving pid instead of trusting the kill request", async () => {
    const fixture = createConcurrentFixture({ stubbornPids: [4243] });
    const { code, captured } = await runConcurrent(fixture, ["--count", "2", "--json"]);

    expect(code).toBe(1);
    const report = reportOf(captured);
    expect(report.state).toBe("failed");
    expect(checkOf(report, "instances-distinct").status).toBe("pass");
    const teardown = checkOf(report, "teardown-clean");
    expect(teardown.status).toBe("fail");
    expect(teardown.actual).toContain("4243");
    expect(teardown.actual).toContain("instance 2");
    expect(teardown.expected).toContain("pid is gone");
    expect(fixture.multi.isAlive(4243)).toBe(true);
    expect(captured.stderr()).toContain("survived the stop request");
    const evidence = instanceEvidence(fixture, report);
    expect(evidence.residualPids).toEqual([4243]);
  });
});

describe("concurrent: input validation", () => {
  it("rejects a --profiles count that does not match --count", async () => {
    const fixture = createConcurrentFixture();
    const { code, captured } = await runConcurrent(fixture, [
      "--count",
      "3",
      "--profiles",
      "web,alpha",
      "--json",
    ]);

    expect(code).toBe(2);
    const payload = reportOf(captured);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("invalid-input");
    expect(payload.error.message).toContain("--profiles");
    expect(fixture.multi.spawns).toHaveLength(0);
  });

  it("rejects invalid and empty profile names", async () => {
    const fixture = createConcurrentFixture();
    const bad = await runConcurrent(fixture, ["--count", "2", "--profiles", "web,../evil", "--json"]);
    expect(bad.code).toBe(2);
    expect(reportOf(bad.captured).error.message).toContain("not a valid profile name");

    const empty = await runConcurrent(fixture, ["--count", "2", "--profiles", "web,", "--json"]);
    expect(empty.code).toBe(2);
    expect(reportOf(empty.captured).error.message).toContain("empty entry");
    expect(fixture.multi.spawns).toHaveLength(0);
  });

  it("rejects an out-of-range or non-numeric --count", async () => {
    const fixture = createConcurrentFixture();
    for (const raw of ["0", "33", "two"]) {
      const { code, captured } = await runConcurrent(fixture, ["--count", raw, "--json"]);
      expect(code).toBe(2);
      expect(reportOf(captured).error.code).toBe("invalid-input");
    }
    expect(fixture.multi.spawns).toHaveLength(0);
  });

  it("runs one instance per --profiles name", async () => {
    const fixture = createConcurrentFixture();
    seedProfile(fixture, "alpha");
    const { code, captured } = await runConcurrent(fixture, [
      "--count",
      "2",
      "--profiles",
      "web,alpha",
      "--json",
    ]);

    expect(code).toBe(0);
    const report = reportOf(captured);
    expect(report.profile).toBe("web,alpha");
    expect(report.state).toBe("passed");
    const evidence = instanceEvidence(fixture, report);
    expect(evidence.rows.map((row: any) => row.profile)).toEqual(["web", "alpha"]);
    expect(fixture.multi.kills).toHaveLength(2);
  });

  it("reports the plan in --dry-run without writing or spawning", async () => {
    const fixture = createConcurrentFixture();
    const { code, captured } = await runConcurrent(fixture, ["--count", "3", "--dry-run", "--json"]);

    expect(code).toBe(0);
    const payload = reportOf(captured);
    expect(payload).toMatchObject({
      schemaVersion: 1,
      command: "concurrent",
      ok: true,
      dryRun: true,
      count: 3,
    });
    expect(payload.instances).toHaveLength(3);
    expect(new Set(payload.instances.map((plan: any) => plan.instanceId)).size).toBe(3);
    expect(payload.instances.every((plan: any) => plan.port === 0)).toBe(true);
    expect(fixture.fs.writes).toHaveLength(0);
    expect(fixture.multi.spawns).toHaveLength(0);
    expect(fixture.http.requests).toHaveLength(0);
  });
});

describe("concurrent: blocked prerequisites", () => {
  it("blocks when the profile directory is missing", async () => {
    const fixture = createConcurrentFixture({ profilePresent: false });
    const { code, captured } = await runConcurrent(fixture, ["--count", "2", "--json"]);

    expect(code).toBe(2);
    const report = reportOf(captured);
    expect(report.state).toBe("blocked");
    expect(checkOf(report, "instances-distinct").status).toBe("blocked");
    expect(checkOf(report, "teardown-clean").status).toBe("skip");
    expect(fixture.multi.spawns).toHaveLength(0);
    // A blocked run still leaves a report on disk.
    expect(await fixture.fs.exists(report.artifacts.report)).toBe(true);
  });

  it("blocks when the declaration cannot be loaded", async () => {
    const fixture = createConcurrentFixture();
    const loader = declarationLoader(
      err({
        code: "prerequisite",
        message: "no verification declaration found",
        hint: "add verify/profile.ts",
        kind: "blocked",
      }),
    );
    const { code, captured } = await runConcurrent(fixture, ["--json"], loader as Loader);

    expect(code).toBe(2);
    const report = reportOf(captured);
    expect(report.state).toBe("blocked");
    expect(report.profile).toBe("(declaration not loaded)");
    expect(checkOf(report, "instances-distinct").status).toBe("blocked");
    expect(checkOf(report, "teardown-clean").status).toBe("skip");
    expect(fixture.multi.spawns).toHaveLength(0);
  });

  it("passes when the profile declares no plugin cache directory", async () => {
    const fixture = createConcurrentFixture({ pluginCacheDir: null });
    const { code, captured } = await runConcurrent(fixture, ["--count", "2", "--json"]);

    expect(code).toBe(0);
    const report = reportOf(captured);
    expect(report.state).toBe("passed");
    const distinct = checkOf(report, "instances-distinct");
    expect(distinct.status).toBe("pass");
    expect(distinct.detail).toContain("not declared");
    const evidence = instanceEvidence(fixture, report);
    expect(evidence.rows.every((row: any) => row.pluginLogDir === null)).toBe(true);
  });
});

describe("instances-distinct: comparison unit behaviour", () => {
  it("names the colliding field and both instances", async () => {
    const rows = [
      rowFixture(1),
      rowFixture(2),
    ];
    const distinct = createInstancesDistinctCheck();

    const cases: readonly { readonly label: string; readonly override: Partial<ConcurrentRow> }[] = [
      { label: "port", override: { port: 53211 } },
      { label: "DSH_HOME", override: { home: rows[0].home } },
      { label: "start directory", override: { workdir: rows[0].workdir } },
      { label: "plugin log directory", override: { pluginLogDir: rows[0].pluginLogDir } },
    ];
    for (const testCase of cases) {
      const colliding = [rows[0], rowFixture(2, testCase.override)];
      const outcome = await distinct.run(checkContext(colliding));
      expect(outcome.status).toBe("fail");
      expect(outcome.actual).toContain(testCase.label);
      expect(outcome.actual).toContain("#1 and #2");
    }
  });

  it("blames readiness before comparing fields", async () => {
    const rows = [
      rowFixture(1),
      rowFixture(2, { readiness: "failed", failure: failure("timeout", "the token URL never appeared") }),
    ];
    const outcome = await createInstancesDistinctCheck().run(checkContext(rows));
    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("1 of 2");
    expect(outcome.actual).toContain("instance 2");
  });

  it("does not fail a run where no plugin log directory is declared", async () => {
    const rows = [rowFixture(1, { pluginLogDir: null }), rowFixture(2, { pluginLogDir: null })];
    const outcome = await createInstancesDistinctCheck().run(checkContext(rows));
    expect(outcome.status).toBe("pass");
    expect(outcome.detail).toContain("not declared");
  });

  it("blocks when the run never planned any instance", async () => {
    const context: ConcurrentContext = {
      ...checkContext([]),
      failure: { stage: "runtime", message: "DSH executable not found", hint: "install DSH" },
    };
    const distinct = await createInstancesDistinctCheck().run(context);
    expect(distinct.status).toBe("blocked");
    expect(distinct.hint).toContain("install DSH");
    const teardown = await createTeardownCleanCheck().run(context);
    expect(teardown.status).toBe("skip");
  });
});

describe("teardown-clean: comparison unit behaviour", () => {
  it("passes when every launched instance is verified dead", async () => {
    const rows = [
      rowFixture(1, { cleanup: CLEAN_CLEANUP }),
      rowFixture(2, { cleanup: { ...CLEAN_CLEANUP, alreadyGone: true } }),
    ];
    const outcome = await createTeardownCleanCheck().run(checkContext(rows));
    expect(outcome.status).toBe("pass");
    expect(outcome.detail).toContain("stopped 2 instance(s)");
  });

  it("fails and names the pid when an instance is still alive", async () => {
    const rows = [
      rowFixture(1, { cleanup: { ...CLEAN_CLEANUP, verified: false, aliveAfter: true } }),
    ];
    const outcome = await createTeardownCleanCheck().run(checkContext(rows));
    expect(outcome.status).toBe("fail");
    expect(outcome.actual).toContain("4241");
    expect(outcome.actual).toContain("still alive");
    expect(outcome.hint).toContain("C:\\fake-work");
  });
});
