/**
 * Gate source-scan contract (ticket 02).
 *
 * The gate entry (scripts/ops/base-verify.mjs) gains a scan step that walks
 * this repo's text sources and rejects NUL bytes / undecodable UTF-8. Every
 * assertion below crosses the process boundary: exit codes, stdout JSON,
 * stderr text and which steps ran. Script internals are never imported.
 */
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, removeTempDir, runOps } from "./support/ops-fixtures";
import { makeScanFixture } from "./support/scan-fixtures";

const BASE_VERIFY = "scripts/ops/base-verify.mjs";
const tempDirs: string[] = [];

function fixture(files: Record<string, string | Buffer> = {}): string {
  const dir = makeScanFixture(files);
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) removeTempDir(dir);
});

/** Compare paths across separators and (on Windows) case differences. */
function normalizePath(value: string): string {
  const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

interface ScanIssue {
  file: string;
  path: string;
  reason: string;
  message: string;
}

interface StepReport {
  id: string;
  ok: boolean;
  exitCode: number;
  summary?: { scanned?: number; issues?: ScanIssue[] };
}

interface VerifyReport {
  ok: boolean;
  steps: StepReport[];
}

function parseReport(stdout: string): VerifyReport {
  // JSON.parse is also the assertion that --json keeps stdout machine-readable.
  return JSON.parse(stdout) as VerifyReport;
}

function scanStep(report: VerifyReport): StepReport {
  const step = report.steps.find((candidate) => candidate.id === "scan");
  expect(step, "report has no scan step; steps were " + JSON.stringify(report.steps.map((s) => s.id))).toBeDefined();
  return step as StepReport;
}

const NUL_TEXT = Buffer.concat([
  Buffer.from("export const broken = ", "utf8"),
  Buffer.from([0x00]),
  Buffer.from(";\n", "utf8"),
]);

const INVALID_UTF8 = Buffer.concat([
  Buffer.from('export const broken = "', "utf8"),
  Buffer.from([0x80, 0xff]),
  Buffer.from('";\n', "utf8"),
]);

describe("gate source scan", () => {
  it("passes --only scan on this checkout", async () => {
    const run = await runOps(BASE_VERIFY, ["--only", "scan", "--no-log", "--json"], { cwd: REPO_ROOT });
    expect(run.code, run.stderr).toBe(0);
    const report = parseReport(run.stdout);
    expect(report.steps.map((step) => step.id)).toEqual(["scan"]);
    const step = scanStep(report);
    expect(step.ok).toBe(true);
    expect(step.exitCode).toBe(0);
    expect(step.summary?.issues).toEqual([]);
    expect(step.summary?.scanned ?? 0).toBeGreaterThan(100);
  }, 60_000);

  it("fails on a fixture with a NUL byte and names the offending file", async () => {
    const root = fixture({ "packages/base/src/nul.ts": NUL_TEXT });
    const run = await runOps(BASE_VERIFY, ["--repo", root, "--only", "scan", "--no-log"], { cwd: REPO_ROOT });
    expect(run.code, run.stderr).toBe(1);
    const seen = normalizePath(run.stdout + "\n" + run.stderr);
    expect(seen).toContain(normalizePath("packages/base/src/nul.ts"));
    expect(seen).toMatch(/nul-byte/i);
  }, 120_000);

  it("puts the offending path in structured JSON when --json is set", async () => {
    const root = fixture({ "packages/base/src/nul.ts": NUL_TEXT });
    const run = await runOps(BASE_VERIFY, ["--repo", root, "--only", "scan", "--no-log", "--json"], { cwd: REPO_ROOT });
    expect(run.code, run.stderr).toBe(1);
    const report = parseReport(run.stdout);
    const issues = scanStep(report).summary?.issues ?? [];
    expect(issues).toHaveLength(1);
    expect(normalizePath(issues[0].path)).toBe(normalizePath("packages/base/src/nul.ts"));
    expect(normalizePath(issues[0].file)).toContain(normalizePath(root));
    expect(issues[0].reason).toBe("nul-byte");
    expect(issues[0].message).toMatch(/NUL/i);
    expect(normalizePath(run.stderr)).toContain(normalizePath("packages/base/src/nul.ts"));
  }, 120_000);

  it("fails on text that is not valid UTF-8 with an explicit message", async () => {
    const root = fixture({ "docs/invalid-utf8.md": INVALID_UTF8 });
    const run = await runOps(BASE_VERIFY, ["--repo", root, "--only", "scan", "--no-log", "--json"], { cwd: REPO_ROOT });
    expect(run.code, run.stderr).toBe(1);
    const report = parseReport(run.stdout);
    const issues = scanStep(report).summary?.issues ?? [];
    expect(issues).toHaveLength(1);
    expect(normalizePath(issues[0].path)).toBe(normalizePath("docs/invalid-utf8.md"));
    expect(issues[0].reason).toBe("invalid-utf8");
    expect(issues[0].message).toMatch(/UTF-8/i);
    expect(normalizePath(run.stderr)).toContain(normalizePath("docs/invalid-utf8.md"));
  }, 120_000);

  it("ignores non-text extensions and skipped build/tool directories", async () => {
    const root = fixture({
      "packages/base/node_modules/pkg/nul.ts": NUL_TEXT,
      "packages/base/src/dist/nul.ts": NUL_TEXT,
      "scripts/.git/nul.ts": NUL_TEXT,
      "scripts/.tmp/nul.ts": NUL_TEXT,
      "scripts/.local/nul.ts": NUL_TEXT,
      "scripts/.scratch/nul.ts": NUL_TEXT,
      "scripts/node_modules/nul.ts": NUL_TEXT,
      "scripts/dist/nul.ts": NUL_TEXT,
      "scripts/asset.bin": Buffer.from([0x00, 0x01, 0x02]),
    });
    const run = await runOps(BASE_VERIFY, ["--repo", root, "--only", "scan", "--no-log", "--json"], { cwd: REPO_ROOT });
    expect(run.code, run.stdout + run.stderr).toBe(0);
    const report = parseReport(run.stdout);
    expect(scanStep(report).summary?.issues).toEqual([]);
  }, 120_000);

  it("runs the fixed chain typecheck -> tests -> docs -> scan -> build", async () => {
    const root = fixture();
    const run = await runOps(BASE_VERIFY, ["--repo", root, "--no-log", "--json"], { cwd: REPO_ROOT, timeoutMs: 180_000 });
    expect(run.code, run.stdout + "\n" + run.stderr).toBe(0);
    const report = parseReport(run.stdout);
    expect(report.steps.map((step) => step.id)).toEqual(["typecheck", "tests", "docs", "scan", "build"]);
    expect(report.steps.every((step) => step.ok)).toBe(true);
    expect(report.ok).toBe(true);
  }, 240_000);

  it("stops at a failing scan step and only continues with --keep-going", async () => {
    const root = fixture({ "packages/base/src/nul.ts": NUL_TEXT });
    const stopped = await runOps(BASE_VERIFY, ["--repo", root, "--no-log", "--json"], { cwd: REPO_ROOT, timeoutMs: 180_000 });
    expect(stopped.code, stopped.stderr).toBe(1);
    const stoppedReport = parseReport(stopped.stdout);
    expect(stoppedReport.steps.map((step) => step.id)).toEqual(["typecheck", "tests", "docs", "scan"]);
    expect(stoppedReport.steps[stoppedReport.steps.length - 1].ok).toBe(false);

    const kept = await runOps(BASE_VERIFY, ["--repo", root, "--no-log", "--json", "--keep-going"], { cwd: REPO_ROOT, timeoutMs: 180_000 });
    expect(kept.code, kept.stderr).toBe(1);
    const keptReport = parseReport(kept.stdout);
    expect(keptReport.steps.map((step) => step.id)).toEqual(["typecheck", "tests", "docs", "scan", "build"]);
    expect(keptReport.steps.map((step) => step.ok)).toEqual([true, true, true, false, true]);
  }, 300_000);

  it("keeps --quick at typecheck + tests", async () => {
    const root = fixture();
    const run = await runOps(BASE_VERIFY, ["--repo", root, "--no-log", "--json", "--quick"], { cwd: REPO_ROOT, timeoutMs: 180_000 });
    expect(run.code, run.stderr).toBe(0);
    const report = parseReport(run.stdout);
    expect(report.steps.map((step) => step.id)).toEqual(["typecheck", "tests"]);
  }, 240_000);

  it("documents the scan step and fixed order in --help", async () => {
    const run = await runOps(BASE_VERIFY, ["--help"], { cwd: REPO_ROOT });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("scan");
    expect(run.stdout).toMatch(/typecheck\s*->\s*tests\s*->\s*docs\s*->\s*scan\s*->\s*build/);
    expect(run.stderr).toBe("");
  }, 60_000);

  it("still rejects unknown step ids with exit 2", async () => {
    const root = fixture();
    const run = await runOps(BASE_VERIFY, ["--repo", root, "--only", "bogus", "--no-log"], { cwd: REPO_ROOT });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("unknown step");
  }, 60_000);
});
