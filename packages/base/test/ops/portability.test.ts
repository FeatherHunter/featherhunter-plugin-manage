/**
 * Portability contract for the ops toolkit (ticket 01).
 *
 * The scripts must resolve "the repo that owns this toolkit" from their own
 * location — never from a machine-specific absolute path — so they behave in
 * any clone, any cwd and on CI. Everything below is asserted across the
 * process boundary: exit codes, stdout JSON, stderr text and on-disk effects.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  copyOpsToolkit,
  makeTempDir,
  removeTempDir,
  runOps,
} from "./support/ops-fixtures";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
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

/**
 * Fingerprint of the log files the scripts under test could write themselves.
 *
 * The shared .tmp/ops-logs directory is also where the gate writes its own
 * per-step logs (base-verify-<stamp>-<step>.log) and where background jobs tee
 * their output, so hashing the whole directory makes this assertion fail while
 * the gate runs the tests. Scoping to the three scripts' own log names keeps the
 * claim "these scripts' --help writes no logs" honest and still falsifiable.
 */
const OWNED_LOG = /^(?:matt-verify|repos-status|refresh-base)[-.]/;

function logSnapshot(): string {
  const logDir = join(REPO_ROOT, ".tmp", "ops-logs");
  if (!existsSync(logDir)) return "absent";
  const entries = readdirSync(logDir).filter((name) => OWNED_LOG.test(name)).sort();
  if (entries.length === 0) return "none";
  const hash = createHash("sha256");
  for (const name of entries) {
    const file = join(logDir, name);
    hash.update(name);
    hash.update("\u0000");
    if (statSync(file).isFile()) hash.update(readFileSync(file));
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

describe("ops toolkit portability", () => {
  it("resolves its own repo when the toolkit is copied to a bare directory (no --repo)", async () => {
    const root = tempDir("fh-ops-portable-");
    copyOpsToolkit(root);
    // No packages/base here on purpose: a machine-hardcoded repo would still
    // find the real checkout and run the docs gate against it.
    const run = await runOps(join(root, "scripts", "ops", "base-verify.mjs"), ["--json", "--only", "docs"], { cwd: root });

    expect(run.code, "expected prerequisite error, stdout: " + run.stdout).toBe(2);
    expect(normalizePath(run.stderr)).toContain(normalizePath(join(root, "packages", "base")));
  }, 60_000);

  it("finds the real repo from an unrelated cwd without --repo", async () => {
    const elsewhere = tempDir("fh-ops-cwd-");
    const run = await runOps("scripts/ops/base-verify.mjs", ["--json", "--only", "docs", "--no-log"], { cwd: elsewhere });

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    const report = JSON.parse(run.stdout) as {
      repo: string;
      packageDir: string;
      steps: Array<{ id: string; ok: boolean }>;
    };
    expect(normalizePath(report.repo)).toBe(normalizePath(REPO_ROOT));
    expect(normalizePath(report.packageDir)).toBe(normalizePath(join(REPO_ROOT, "packages", "base")));
    expect(report.steps.map((step) => step.id)).toEqual(["docs"]);
    expect(report.steps.every((step) => step.ok)).toBe(true);
  }, 180_000);

  it("keeps the cross-repo scripts' --help working from any cwd without writing logs", async () => {
    const elsewhere = tempDir("fh-ops-help-");
    const before = logSnapshot();
    for (const script of ["scripts/ops/matt-verify.mjs", "scripts/ops/repos-status.mjs", "scripts/ops/refresh-base.mjs"]) {
      const run = await runOps(script, ["--help"], { cwd: elsewhere });
      expect(run.code, script + " --help failed: " + run.stderr).toBe(0);
      expect(run.stdout, script + " --help has no usage text").toContain("Usage: node " + script);
      expect(run.stderr, script + " --help wrote to stderr").toBe("");
    }
    expect(logSnapshot(), "--help must not write logs").toBe(before);
  }, 60_000);
});
