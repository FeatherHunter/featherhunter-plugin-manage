/**
 * `dsh-verify single-instance` — the L1 contract, all in process.
 *
 * Every test drives the real command module against the fake machine. What is
 * under test is the command's claim: one isolated instance starts, the declared
 * checks observe it, the evidence lands on disk, the report is written and the
 * exit code follows the shared check contract. The dry run is tested for the one
 * property it promises — that it writes and starts nothing.
 *
 * No test reads the real home, starts a real process or opens a socket.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args";
import {
  runSingleInstanceCommand,
  SINGLE_INSTANCE_USAGE,
} from "../cli/commands/single-instance";
import type { Ports } from "../contracts/ports";
import { joinFsPath } from "../runtime/paths";
import { captureIo } from "./support/fake-capture";
import { createFakeBrowser } from "./support/fake-browser";
import {
  createLaunchFixture,
  fixtureLoader,
  readyLine,
  ScriptedProcess,
  type LaunchFixture,
} from "./support/fake-launch";

type Browser = ReturnType<typeof createFakeBrowser>;

interface SinglesFixture extends LaunchFixture {
  readonly browser: Browser | null;
}

interface SinglesOptions {
  /** `false` declares no plugin cache directory at all. */
  readonly pluginCacheDir?: string | false;
  /** What the plugin writes: real events (default), garbage only, or nothing. */
  readonly log?: "events" | "garbage" | "missing";
  /** `false` leaves `ports.browser` null, so the page check must block. */
  readonly browser?: boolean;
  /** The host dies immediately after spawning. */
  readonly exitEarly?: boolean;
  /** Text seeded into instance.stderr.log before readiness is checked. */
  readonly stderrTail?: string;
  /** The process survives the kill request, so teardown must fail. */
  readonly survivor?: boolean;
}

/** One JSON event line, as the plugin log writer produces it. */
function logEventLine(): string {
  return `${JSON.stringify({ ts: "2026-11-01T21:00:01.000+08:00", event: "plugin.loaded", level: "info" })}\n`;
}

/**
 * Build the machine for one scenario.
 *
 * The spawn hook is where the instance's own effects belong: it seeds the ready
 * line the host would print, the stderr the host would write, and the dated plugin
 * log inside the instance workdir. Seeding there (rather than before the run) also
 * proves the log is read from the path the plan chose.
 */
function createSinglesFixture(options: SinglesOptions = {}): SinglesFixture {
  const state: { fs: LaunchFixture["fs"] | null } = { fs: null };
  const pluginCacheDir = options.pluginCacheDir === false ? undefined : (options.pluginCacheDir ?? "plugin-cache");

  const process = new ScriptedProcess({
    pid: 4242,
    ...(options.exitEarly ? { alive: () => false } : {}),
    ...(options.survivor ? { alive: () => true, kill: () => ({ killed: true, alreadyGone: false }) } : {}),
    onSpawn: (request) => {
      const fs = state.fs;
      if (fs === null) throw new Error("the fixture filesystem was not attached before the spawn");
      fs.seedFile(request.stdoutPath, readyLine());
      if (options.stderrTail !== undefined) fs.seedFile(request.stderrPath, options.stderrTail);
      if (pluginCacheDir !== undefined && options.log !== "missing") {
        const file = joinFsPath(request.cwd, pluginCacheDir, "logs", "2026-11-01.log");
        fs.seedFile(file, options.log === "garbage" ? "this line is not JSON\n" : logEventLine());
      }
    },
  });

  const base = createLaunchFixture({
    ...(pluginCacheDir === undefined ? {} : { pluginCacheDir }),
    process,
  });
  state.fs = base.fs;

  if (options.browser === false) return { ...base, browser: null };
  const browser = createFakeBrowser({
    text: { body: "the fixture app shell" },
    writeScreenshot: (path, bytes) => {
      base.fs.seedFile(path, bytes);
    },
  });
  const ports: Ports = { ...base.ports, browser };
  return { ...base, ports, browser };
}

/** Run the command in-process and collect both streams and the exit code. */
async function runSingle(
  fixture: SinglesFixture,
  argv: readonly string[],
): Promise<{ readonly code: number; readonly captured: ReturnType<typeof captureIo> }> {
  const captured = captureIo();
  const args = parseArgs(["single-instance", ...argv]);
  const code = await runSingleInstanceCommand(args, {
    ports: fixture.ports,
    io: captured.io,
    runtime: fixture.runtime,
    loadDeclaration: fixtureLoader(fixture),
  });
  return { code, captured };
}

/** Assert stdout holds exactly one JSON document and return it. */
function reportOf(captured: ReturnType<typeof captureIo>): any {
  const stdout = captured.stdout().trim();
  expect(stdout.length).toBeGreaterThan(0);
  const parsed: unknown = JSON.parse(stdout);
  expect(typeof parsed).toBe("object");
  return parsed;
}

function checkOf(report: any, id: string): any {
  const check = report.checks.find((entry: any) => entry.id === id);
  expect(check, `no check ${id} in ${report.checks.map((c: any) => c.id).join(", ")}`).toBeDefined();
  return check;
}

/** The evidence file with the given stem, read back from the fake disk. */
function evidenceJson(fixture: SinglesFixture, report: any, stem: string): any {
  const dir = report.artifacts.evidence as string;
  const path = fixture.fs.children(dir).find((child) => child.endsWith(`${stem}.json`));
  expect(path, `no ${stem}.json under ${dir}`).toBeDefined();
  return fixture.fs.readJsonSync(path as string);
}

describe("single-instance: dry run", () => {
  it("prints the plan and writes, creates and spawns nothing", async () => {
    const fixture = createSinglesFixture();
    const { code, captured } = await runSingle(fixture, ["--dry-run"]);

    expect(code).toBe(0);
    expect(captured.stderr()).toBe("");
    expect(captured.stdout()).toContain("single-instance plan (dry run)");
    expect(captured.stdout()).toContain("argv:");
    expect(captured.stdout()).toContain("plugin log dir:");

    expect(fixture.fs.writes).toEqual([]);
    expect(await fixture.fs.exists(joinFsPath(fixture.paths.workRoot, "runs"))).toBe(false);
    expect(fixture.process.spawns).toHaveLength(0);
    expect(fixture.http).toBeDefined();
  });

  it("emits one plan document under --json", async () => {
    const fixture = createSinglesFixture();
    const { code, captured } = await runSingle(fixture, ["--dry-run", "--json"]);

    expect(code).toBe(0);
    const document = reportOf(captured);
    expect(document.command).toBe("single-instance");
    expect(document.dryRun).toBe(true);
    expect(document.plan.profile).toBe("web");
    expect(document.plan.logFiles.pluginLogDir).toContain("logs");
    expect(fixture.fs.writes).toEqual([]);
  });
});

describe("single-instance: the full run", () => {
  it("passes reachable, logs, pages and teardown, and records evidence", async () => {
    const fixture = createSinglesFixture();
    const { code, captured } = await runSingle(fixture, ["--json"]);

    expect(code, captured.stderr()).toBe(0);
    const report = reportOf(captured);
    expect(report.command).toBe("single-instance");
    expect(report.state).toBe("passed");
    expect(report.exitCode).toBe(0);
    expect(report.checks.map((check: any) => check.id)).toEqual([
      "instance-reachable",
      "logs-readable",
      "instance-pages",
      "teardown-clean",
    ]);
    expect(report.checks.every((check: any) => check.status === "pass")).toBe(true);
    expect(report.steps.map((step: any) => step.id)).toEqual(["plan", "launch", "checks", "cleanup"]);
    expect(report.steps.every((step: any) => step.state === "done")).toBe(true);

    // One spawn, one kill, and the pid is gone afterwards.
    expect(fixture.process.spawns).toHaveLength(1);
    expect(fixture.process.kills.map((entry) => entry.pid)).toEqual([4242]);
    expect(fixture.process.isAlive(4242)).toBe(false);

    // The report on disk ends with the digest trailer the rest of the tool uses.
    const reportPath = report.artifacts.report as string;
    expect(reportPath.endsWith("run.json")).toBe(true);
    const text = fixture.fs.readFileSync(reportPath);
    expect(text.endsWith("\n")).toBe(true);
    const digestText = fixture.fs.readFileSync(`${reportPath}.sha256`);
    expect(digestText).toMatch(/^[a-f0-9]{64}  run\.json\n$/);
    expect(digestText).toContain(report.artifacts.reportSha256);

    // The log summary is evidence; the raw log is not copied into the evidence dir.
    const logEvidence = evidenceJson(fixture, report, "logs-readable");
    expect(logEvidence.state).toBe("read");
    expect(logEvidence.total).toBe(1);
    expect(logEvidence.file).toMatch(/\.log$/);
    expect(logEvidence.events).toBeUndefined();
    expect(logEvidence.firstBadLine).toBeNull();
    // The evidence directory is addressable from the report; this command uses the
    // store but does not write a batch manifest, so report.evidence stays absent.
    expect(report.artifacts.evidence.endsWith("evidence")).toBe(true);
  });

  it("prints the human check lines and the report tail", async () => {
    const fixture = createSinglesFixture();
    const { code, captured } = await runSingle(fixture, []);

    expect(code).toBe(0);
    const lines = captured.lines();
    expect(lines.some((line) => line.startsWith("ok instance-reachable "))).toBe(true);
    expect(lines.some((line) => line.startsWith("ok logs-readable "))).toBe(true);
    expect(lines.some((line) => line.startsWith("report: "))).toBe(true);
    expect(lines.some((line) => line.startsWith("report-sha256: "))).toBe(true);
    expect(lines.some((line) => line.startsWith("evidence: "))).toBe(true);
  });
});

describe("single-instance: negative paths", () => {
  it("fails with the stderr tail when the host exits before readiness", async () => {
    const fixture = createSinglesFixture({
      exitEarly: true,
      stderrTail: "fatal: the configured port is already in use\n",
    });
    const { code, captured } = await runSingle(fixture, ["--json"]);

    expect(code).toBe(1);
    const report = reportOf(captured);
    expect(report.state).toBe("failed");
    expect(report.checks.map((check: any) => check.id)).toEqual(["instance-reachable"]);
    const reachable = checkOf(report, "instance-reachable");
    expect(reachable.status).toBe("fail");
    expect(reachable.actual).toContain("fatal: the configured port is already in use");
    expect(reachable.actual).toContain("stderr tail:");
    expect(reachable.expected).toContain("every enabled plugin entry reported fiberPhase active");
    expect(fixture.process.spawns).toHaveLength(1);
  });

  it("fails logs-readable when the log has zero parsed events", async () => {
    const fixture = createSinglesFixture({ log: "garbage" });
    const { code, captured } = await runSingle(fixture, ["--json"]);

    expect(code).toBe(1);
    const report = reportOf(captured);
    const check = checkOf(report, "logs-readable");
    expect(check.status).toBe("fail");
    expect(check.actual).toContain("0 parsed event(s)");
    expect(check.actual).toContain("unparsable line");
    expect(check.hint).toBeDefined();

    const evidence = evidenceJson(fixture, report, "logs-readable");
    expect(evidence.total).toBe(0);
    expect(evidence.badLines).toBe(1);
  });

  it("blocks instead of failing when the plugin log directory does not exist", async () => {
    const fixture = createSinglesFixture({ log: "missing" });
    const { code, captured } = await runSingle(fixture, ["--json"]);

    expect(code).toBe(2);
    const report = reportOf(captured);
    expect(report.state).toBe("blocked");
    const check = checkOf(report, "logs-readable");
    expect(check.status).toBe("blocked");
    expect(check.detail).toContain("does not exist yet");
  });

  it("blocks the page check when no browser adapter is available", async () => {
    const fixture = createSinglesFixture({ browser: false });
    const { code, captured } = await runSingle(fixture, ["--json"]);

    expect(code).toBe(2);
    const report = reportOf(captured);
    expect(report.state).toBe("blocked");
    const check = checkOf(report, "instance-pages");
    expect(check.status).toBe("blocked");
    expect(check.detail).toContain("no browser adapter");
    // The rest of the run still happened: reachable and logs passed, teardown ran.
    expect(checkOf(report, "instance-reachable").status).toBe("pass");
    expect(checkOf(report, "logs-readable").status).toBe("pass");
    expect(checkOf(report, "teardown-clean").status).toBe("pass");
  });

  it("fails teardown-clean when the pid survives the stop request", async () => {
    const fixture = createSinglesFixture({ survivor: true });
    const { code, captured } = await runSingle(fixture, ["--json"]);

    expect(code).toBe(1);
    const report = reportOf(captured);
    const check = checkOf(report, "teardown-clean");
    expect(check.status).toBe("fail");
    expect(check.actual).toContain("4242");
    expect(fixture.process.kills).toHaveLength(1);
  });

  it("leaves the instance running under --keep and notes it in the report", async () => {
    const fixture = createSinglesFixture();
    const { code, captured } = await runSingle(fixture, ["--keep", "--json"]);

    expect(code).toBe(0);
    const report = reportOf(captured);
    const check = checkOf(report, "teardown-clean");
    expect(check.status).toBe("skip");
    expect(check.detail).toContain("still running");
    expect(report.notes.join("\n")).toContain("stopped: false");
    expect(report.notes.join("\n")).toContain("--keep");
    expect(fixture.process.kills).toHaveLength(0);
    expect(fixture.process.isAlive(4242)).toBe(true);
  });
});

describe("single-instance: the CLI contract", () => {
  it("rejects an unknown flag with exit 2 and the usage line", async () => {
    const fixture = createSinglesFixture();
    const { code, captured } = await runSingle(fixture, ["--json", "--bogus"]);

    expect(code).toBe(2);
    expect(captured.stderr()).toContain(SINGLE_INSTANCE_USAGE);
    const document = reportOf(captured);
    expect(document.ok).toBe(false);
    expect(document.command).toBe("single-instance");
  });

  it("keeps --json stdout to exactly one document on failure", async () => {
    const fixture = createSinglesFixture({ log: "garbage" });
    const { captured } = await runSingle(fixture, ["--json"]);

    const stdout = captured.stdout();
    expect(stdout.trim().split("\n\n")).toHaveLength(1);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(captured.stderr()).toContain("logs-readable");
  });
});
