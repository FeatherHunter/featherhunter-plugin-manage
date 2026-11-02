/**
 * Contract tests for scripts/ops/gate-summary.mjs (ticket 03).
 *
 * Everything below is asserted across the process boundary: exit codes, the JSON
 * on stdout, the human report on stdout/stderr, and the fact that the log file is
 * never modified. Fixture logs are written under os.tmpdir().
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeTempDir, removeTempDir, runOps } from "./support/ops-fixtures";
import {
  FAILING_GATE,
  OTHER_PASSING_GATE,
  PASSING_GATE,
  gatePair,
  gateResultLine,
  logText,
  writeLogFile,
} from "./support/log-fixtures";

const SCRIPT = "scripts/ops/gate-summary.mjs";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) removeTempDir(dir);
});

/** The stable JSON contract: every field the summarizer has always emitted. */
interface GateSummaryJson {
  log: string;
  bytes: number;
  gates: number;
  resultLines: number;
  totalAssertions: number;
  failed: Array<{ gate: string; assertions: number; failed: number }>;
  unparsed: Array<{ line: number; text: string }>;
  ok: boolean;
}

function parseSummary(stdout: string): GateSummaryJson {
  return JSON.parse(stdout) as GateSummaryJson;
}

/** Passing alpha (result + summary), failing beta (result + summary), passing gamma (result only). */
const MIXED_LINES: readonly string[] = [
  " RUN  v3.2.4 D:/tmp/base",
  ...gatePair(PASSING_GATE),
  "   Test Files  1 passed",
  ...gatePair(FAILING_GATE),
  gateResultLine(OTHER_PASSING_GATE),
];

function mixedLog(dir: string): string {
  return writeLogFile(dir, "mixed.log", MIXED_LINES);
}

describe("gate-summary", () => {
  it("summarizes gate count, assertion count and failing gates from a fixture log", async () => {
    const dir = tempDir("fh-gate-mixed-");
    const logPath = mixedLog(dir);
    const before = readFileSync(logPath, "utf8");

    const run = await runOps(SCRIPT, ["--log", logPath]);

    expect(run.code, run.stdout + run.stderr).toBe(1);
    expect(run.stdout).toContain("gates 3");
    expect(run.stdout).toContain("lines 5");
    expect(run.stdout).toContain("assertions 12");
    expect(run.stdout).toMatch(/FAIL\s+verify-beta\s+2\/5/);
    expect(run.stdout).not.toContain("verify-alpha");
    expect(run.stdout).not.toContain("verify-gamma");
    expect(readFileSync(logPath, "utf8"), "gate-summary must stay read-only").toBe(before);
  });

  it("keeps the documented JSON fields with their fixture values", async () => {
    const dir = tempDir("fh-gate-json-");
    const logPath = mixedLog(dir);
    const text = logText(MIXED_LINES);

    const run = await runOps(SCRIPT, ["--log", logPath, "--json"]);

    expect(run.code, run.stderr).toBe(1);
    const report = parseSummary(run.stdout);
    expect(report.log).toBe(logPath);
    expect(report.bytes).toBe(Buffer.byteLength(text, "utf8"));
    expect(report.gates).toBe(3);
    expect(report.resultLines).toBe(5);
    expect(report.totalAssertions).toBe(12);
    expect(report.failed).toEqual([{ gate: "verify-beta", assertions: 5, failed: 2 }]);
    expect(report.unparsed).toEqual([]);
    expect(report.ok).toBe(false);
  });

  it("lists only failing gates with --failures-only", async () => {
    const dir = tempDir("fh-gate-only-");
    const logPath = mixedLog(dir);

    const run = await runOps(SCRIPT, ["--log", logPath, "--failures-only"]);

    expect(run.code, run.stdout + run.stderr).toBe(1);
    expect(run.stdout).toContain("verify-beta");
    expect(run.stdout).not.toContain("verify-alpha");
    expect(run.stdout).not.toContain("verify-gamma");
    expect(run.stdout).not.toContain("all gates passed");

    // --failures-only only trims the human report; the JSON shape stays complete.
    const json = await runOps(SCRIPT, ["--log", logPath, "--json", "--failures-only"]);
    expect(json.code, json.stderr).toBe(1);
    const report = parseSummary(json.stdout);
    expect(report.gates).toBe(3);
    expect(report.failed).toEqual([{ gate: "verify-beta", assertions: 5, failed: 2 }]);
  });

  it("exits 0 when every gate passed", async () => {
    const dir = tempDir("fh-gate-green-");
    const logPath = writeLogFile(dir, "green.log", [
      ...gatePair(PASSING_GATE),
      "   Test Files  1 passed",
      gateResultLine(OTHER_PASSING_GATE),
    ]);

    const human = await runOps(SCRIPT, ["--log", logPath]);
    expect(human.code, human.stdout + human.stderr).toBe(0);
    expect(human.stdout).toContain("all gates passed");

    const json = await runOps(SCRIPT, ["--log", logPath, "--json"]);
    expect(json.code, json.stderr).toBe(0);
    const report = parseSummary(json.stdout);
    expect(report.ok).toBe(true);
    expect(report.gates).toBe(2);
    expect(report.totalAssertions).toBe(7);
    expect(report.failed).toEqual([]);
  });

  it("exits 2 and says no gate lines were found when the log has none", async () => {
    const dir = tempDir("fh-gate-none-");
    const quiet = writeLogFile(dir, "quiet.log", [
      " Test Files  12 passed (12)",
      "      Tests  1005 passed (1005)",
    ]);
    const empty = writeLogFile(dir, "empty.log", []);

    const human = await runOps(SCRIPT, ["--log", quiet]);
    expect(human.code, human.stdout + human.stderr).toBe(2);
    expect(human.stdout).toContain("未发现门禁行");

    const emptyRun = await runOps(SCRIPT, ["--log", empty]);
    expect(emptyRun.code, emptyRun.stdout + emptyRun.stderr).toBe(2);
    expect(emptyRun.stdout).toContain("未发现门禁行");

    const json = await runOps(SCRIPT, ["--log", quiet, "--json"]);
    expect(json.code, json.stdout + json.stderr).toBe(2);
    const report = parseSummary(json.stdout);
    expect(report.ok).toBe(false);
    expect(report.gates).toBe(0);
    expect(report.resultLines).toBe(0);
    expect(json.stderr).toContain("未发现门禁行");
  });

  it("fails on unparseable gate lines and lists them instead of passing", async () => {
    const dir = tempDir("fh-gate-broken-");
    const brokenJson = 'GATE-RESULT {"gate": "verify-broken", "assertions": 2,}';
    const missingJson = "GATE-RESULT not-json-at-all";
    const logPath = writeLogFile(dir, "broken.log", [
      gateResultLine(PASSING_GATE),
      brokenJson,
      missingJson,
    ]);

    const human = await runOps(SCRIPT, ["--log", logPath]);
    expect(human.code, human.stdout + human.stderr).toBe(1);
    expect(human.stdout).toContain("line 2");
    expect(human.stdout).toContain(brokenJson);
    expect(human.stdout).toContain("line 3");
    expect(human.stdout).toContain(missingJson);

    const json = await runOps(SCRIPT, ["--log", logPath, "--json"]);
    expect(json.code, json.stderr).toBe(1);
    const report = parseSummary(json.stdout);
    expect(report.ok).toBe(false);
    expect(report.gates).toBe(1);
    expect(report.totalAssertions).toBe(3);
    expect(report.failed).toEqual([]);
    expect(report.unparsed).toEqual([
      { line: 2, text: brokenJson },
      { line: 3, text: missingJson },
    ]);

    // A log whose only gate line is broken still proves a gate ran: it is a
    // corrupt result (exit 1), not "no gate lines at all" (exit 2).
    const onlyBroken = writeLogFile(dir, "only-broken.log", [brokenJson]);
    const brokenRun = await runOps(SCRIPT, ["--log", onlyBroken]);
    expect(brokenRun.code, brokenRun.stdout + brokenRun.stderr).toBe(1);
    expect(brokenRun.stdout).toContain("line 1");
    expect(brokenRun.stdout).not.toContain("未发现门禁行");
  });

  it("exits 2 when --log is missing or the file does not exist", async () => {
    const dir = tempDir("fh-gate-missing-");

    const noFlag = await runOps(SCRIPT, []);
    expect(noFlag.code, noFlag.stdout + noFlag.stderr).toBe(2);
    expect(noFlag.stderr).toContain("--log is required");

    const notFound = await runOps(SCRIPT, ["--log", join(dir, "does-not-exist.log")]);
    expect(notFound.code, notFound.stdout + notFound.stderr).toBe(2);
    expect(notFound.stderr).toContain("log not found");
  });

  it("prints usage on stdout and exits 0 for --help", async () => {
    const run = await runOps(SCRIPT, ["--help"]);

    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain("Usage: node scripts/ops/gate-summary.mjs");
    expect(run.stderr).toBe("");
  });
});
