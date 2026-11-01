/**
 * Cleanup is the one command that deletes, so its tests are mostly about what it
 * refuses to do. Every test runs in-process against `FakeCleanupFs`: no real home,
 * no real work root, no network, and every filesystem effect is recorded so a
 * dry run can be proven to have written nothing.
 *
 * The four acceptance points from ticket 17 map to tests by name:
 * - a dry run reports and leaves the disk byte-for-byte unchanged;
 * - retention keeps the newest N by mtime;
 * - unknown categories are reported and never deleted;
 * - `--yes` deletes and reports counts/bytes, while candidates need `--include-pkg`.
 */
import { describe, expect, it } from "vitest";

import { parseArgs } from "../cli/args";
import { runCleanupCommand } from "../cli/commands/cleanup";
import type { CliIo } from "../cli/io";
import type { Ports } from "../contracts/ports";
import { captureIo } from "./support/fake-capture";
import { FakeCleanupFs } from "./support/fake-cleanup";
import { FakeClock, FakeEnv } from "./support/fake-fs";
import { makePorts } from "./support/fake-ports";

const WORK_ROOT = "C:\\work\\verify";

interface JsonEntry {
  readonly relativePath: string;
  readonly category: string;
  readonly action: string;
  readonly rank: number | null;
  readonly bytes: number;
  readonly unsafe: boolean;
  readonly mtime: string | null;
}

interface JsonFailure {
  readonly relativePath: string;
  readonly error: string;
}

interface JsonReport {
  readonly schemaVersion: number;
  readonly command: string;
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly workRoot: string;
  readonly exists: boolean;
  readonly retention: {
    readonly batches: number;
    readonly homes: number;
    readonly temp: number;
    readonly includePkg: boolean;
  };
  readonly entries: JsonEntry[];
  readonly summary: {
    readonly entries: number;
    readonly keep: number;
    readonly delete: number;
    readonly report: number;
    readonly unsafe: number;
    readonly deleted: number;
    readonly freedBytes: number;
  };
  readonly failures: JsonFailure[];
  readonly problems: string[];
  readonly error?: string;
}

interface Harness {
  readonly fs: FakeCleanupFs;
  readonly ports: Ports;
  readonly io: CliIo;
  readonly stdout: () => string;
  readonly stderr: () => string;
  run(argv: readonly string[]): Promise<number>;
}

/**
 * Build an in-process command. Unless a test is exercising the default work
 * root, every run targets `WORK_ROOT` so the seeded world is the one scanned.
 */
function harness(defaultWorkRoot: string | null = WORK_ROOT): Harness {
  const fs = new FakeCleanupFs();
  const clock = new FakeClock();
  const env = new FakeEnv();
  const capture = captureIo();
  const ports = makePorts({ fs, clock, env });
  return {
    fs,
    ports,
    io: capture.io,
    stdout: capture.stdout,
    stderr: capture.stderr,
    run: (argv) => {
      const scoped =
        defaultWorkRoot === null || argv.includes("--work-root")
          ? [...argv]
          : ["--work-root", defaultWorkRoot, ...argv];
      return runCleanupCommand(parseArgs(["cleanup", ...scoped]), { ports, io: capture.io });
    },
  };
}

/** The JSON document is one line; earlier runs in the same harness may have appended. */
function lastJson(h: Harness): JsonReport {
  const lines = h.stdout()
    .split("\n")
    .filter((line) => line.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1] ?? "") as JsonReport;
}

function entry(report: JsonReport, relativePath: string): JsonEntry {
  const found = report.entries.find((candidate) => candidate.relativePath === relativePath);
  expect(found, `missing entry ${relativePath}`).toBeDefined();
  return found as JsonEntry;
}

function seedFile(h: Harness, relativePath: string, mtimeMs: number, bytes: number): void {
  const path = `${WORK_ROOT}\\${relativePath.split("/").join("\\")}`;
  h.fs.seedFile(path, "x".repeat(bytes));
  h.fs.setMtime(path, mtimeMs);
}

function seedEntry(h: Harness, relativePath: string, mtimeMs: number, bytes: number): void {
  const path = `${WORK_ROOT}\\${relativePath.split("/").join("\\")}`;
  h.fs.seedFile(`${path}\\payload.bin`, "x".repeat(bytes));
  h.fs.setMtime(path, mtimeMs);
}

/** A world with at least one entry of every class and deliberately uneven mtimes. */
function seedWorld(h: Harness): void {
  seedEntry(h, "batches/b-old", 1_000, 10);
  seedEntry(h, "batches/b-mid", 2_000, 20);
  seedEntry(h, "batches/b-new", 3_000, 30);
  seedEntry(h, "runs/run-old", 1_000, 100);
  seedEntry(h, "isolation/probe-a", 1_000, 5);
  seedEntry(h, "instances/home-old", 1_000, 40);
  seedEntry(h, "instances/home-new", 2_000, 50);
  seedEntry(h, "archive/batch-1", 1_000, 9);
  seedFile(h, "candidates/pkg-old.tgz", 1_000, 7);
  seedFile(h, "candidates/pkg-new.tgz", 2_000, 8);
  seedEntry(h, "unknown-dir", 1_000, 3);
}

describe("cleanup", () => {
  it("dry run reports every class and never writes", async () => {
    const h = harness();
    seedWorld(h);

    const code = await h.run(["--json"]);

    expect(code).toBe(0);
    expect(h.fs.writes).toEqual([]);
    const report = lastJson(h);
    expect(report.schemaVersion).toBe(1);
    expect(report.command).toBe("cleanup");
    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.exists).toBe(true);
    expect(report.retention).toEqual({ batches: 2, homes: 0, temp: 0, includePkg: false });
    expect(report.summary).toEqual({
      entries: 11,
      keep: 3,
      delete: 5,
      report: 3,
      unsafe: 0,
      deleted: 0,
      freedBytes: 0,
    });
    expect(entry(report, "batches/b-new")).toMatchObject({ action: "keep", rank: 1, category: "batch" });
    expect(entry(report, "batches/b-mid")).toMatchObject({ action: "keep", rank: 2 });
    expect(entry(report, "batches/b-old")).toMatchObject({ action: "delete", rank: 3 });
    expect(entry(report, "runs/run-old")).toMatchObject({ action: "delete", category: "temp" });
    expect(entry(report, "isolation/probe-a")).toMatchObject({ action: "delete", category: "temp" });
    expect(entry(report, "instances/home-new")).toMatchObject({ action: "delete", category: "home" });
    expect(entry(report, "candidates/pkg-old.tgz")).toMatchObject({ action: "report", category: "candidate" });
    expect(entry(report, "unknown-dir")).toMatchObject({ action: "report", category: "unknown" });
    expect(entry(report, "archive/batch-1")).toMatchObject({
      action: "keep",
      category: "batch",
      unsafe: false,
    });
    expect(typeof entry(report, "batches/b-new").mtime).toBe("string");
  });

  it("human output is one line per entry plus a dry-run summary", async () => {
    const h = harness();
    seedWorld(h);

    const code = await h.run([]);

    expect(code).toBe(0);
    expect(h.fs.writes).toEqual([]);
    const lines = h
      .stdout()
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(12);
    expect(lines.some((line) => /^delete\s+temp\s+runs\/run-old\s+—/.test(line))).toBe(true);
    expect(lines.some((line) => /^keep\s+batch\s+batches\/b-new\s+—/.test(line))).toBe(true);
    expect(lines.some((line) => /^report\s+unknown\s+unknown-dir\s+—/.test(line))).toBe(true);
    expect(h.stdout()).toContain("nothing was deleted");
  });

  it("uses mtime to retain the newest N batches", async () => {
    const h = harness();
    seedWorld(h);

    await h.run(["--keep-batches", "1", "--json"]);
    let report = lastJson(h);
    expect(entry(report, "batches/b-new")).toMatchObject({ action: "keep", rank: 1 });
    expect(entry(report, "batches/b-mid")).toMatchObject({ action: "delete", rank: 2 });
    expect(entry(report, "batches/b-old")).toMatchObject({ action: "delete", rank: 3 });
    expect(report.retention.batches).toBe(1);

    await h.run(["--keep-batches", "0", "--json"]);
    report = lastJson(h);
    expect(entry(report, "batches/b-new")).toMatchObject({ action: "delete", rank: 1 });
  });

  it("retains isolated homes by --keep-homes, default none", async () => {
    const h = harness();
    seedWorld(h);

    await h.run(["--keep-homes", "1", "--json"]);
    const report = lastJson(h);

    expect(entry(report, "instances/home-new")).toMatchObject({ action: "keep", rank: 1 });
    expect(entry(report, "instances/home-old")).toMatchObject({ action: "delete", rank: 2 });
    expect(report.retention.homes).toBe(1);
  });

  it("reports unknown entries and keeps the archive even with every deletion flag", async () => {
    const h = harness();
    seedWorld(h);

    const code = await h.run([
      "--yes",
      "--include-pkg",
      "--keep-batches",
      "0",
      "--keep-homes",
      "0",
      "--json",
    ]);

    expect(code).toBe(0);
    const report = lastJson(h);
    expect(entry(report, "unknown-dir")).toMatchObject({ action: "report", unsafe: false });
    expect(entry(report, "archive/batch-1")).toMatchObject({ action: "keep", category: "batch" });
    expect(await h.fs.exists(`${WORK_ROOT}\\unknown-dir\\payload.bin`)).toBe(true);
    expect(await h.fs.exists(`${WORK_ROOT}\\archive\\batch-1\\payload.bin`)).toBe(true);
    expect(h.fs.removeCalls().some((path) => path.includes("unknown-dir"))).toBe(false);
    expect(h.fs.removeCalls().some((path) => path.includes("archive"))).toBe(false);
  });

  it("deletes only on --yes and reports counts and freed bytes", async () => {
    const h = harness();
    seedWorld(h);

    const code = await h.run(["--yes", "--json"]);

    expect(code).toBe(0);
    const report = lastJson(h);
    expect(report.dryRun).toBe(false);
    expect(report.summary).toMatchObject({ deleted: 5, freedBytes: 205 });
    expect([...h.fs.removeCalls()].sort()).toEqual(
      [
        "c:/work/verify/batches/b-old",
        "c:/work/verify/instances/home-new",
        "c:/work/verify/instances/home-old",
        "c:/work/verify/isolation/probe-a",
        "c:/work/verify/runs/run-old",
      ].sort(),
    );
    expect(await h.fs.exists(`${WORK_ROOT}\\runs\\run-old\\payload.bin`)).toBe(false);
    expect(await h.fs.exists(`${WORK_ROOT}\\instances\\home-new\\payload.bin`)).toBe(false);
    expect(await h.fs.exists(`${WORK_ROOT}\\batches\\b-old\\payload.bin`)).toBe(false);
    expect(await h.fs.exists(`${WORK_ROOT}\\batches\\b-mid\\payload.bin`)).toBe(true);
    expect(await h.fs.exists(`${WORK_ROOT}\\candidates\\pkg-old.tgz`)).toBe(true);
    expect(await h.fs.exists(WORK_ROOT)).toBe(true);
    expect(h.fs.removeCalls().every((path) => path.startsWith("c:/work/verify/"))).toBe(true);
  });

  it("deletes candidate packages only with --include-pkg", async () => {
    const without = harness();
    seedWorld(without);
    await without.run(["--yes", "--json"]);
    expect(await without.fs.exists(`${WORK_ROOT}\\candidates\\pkg-old.tgz`)).toBe(true);
    expect(entry(lastJson(without), "candidates/pkg-old.tgz").action).toBe("report");

    const withPkg = harness();
    seedWorld(withPkg);
    const code = await withPkg.run(["--yes", "--include-pkg", "--json"]);
    expect(code).toBe(0);
    const report = lastJson(withPkg);
    expect(report.retention.includePkg).toBe(true);
    expect(entry(report, "candidates/pkg-old.tgz").action).toBe("delete");
    expect(await withPkg.fs.exists(`${WORK_ROOT}\\candidates\\pkg-old.tgz`)).toBe(false);
    expect(await withPkg.fs.exists(`${WORK_ROOT}\\candidates\\pkg-new.tgz`)).toBe(false);
    expect(report.summary.freedBytes).toBe(220);
  });

  it("refuses drive roots, the home directory, the cwd and shallow paths", async () => {
    const cases: readonly (readonly [string, RegExp])[] = [
      ["C:\\", /fewer than three segments/],
      ["C:\\Users\\fixture", /protected root/],
      ["C:\\fake\\repo", /protected root/],
      ["C:\\work", /fewer than three segments/],
    ];

    for (const [workRoot, message] of cases) {
      const h = harness();
      h.fs.seedFile(`${WORK_ROOT}\\runs\\run-old\\payload.bin`, "x");

      const code = await h.run(["--work-root", workRoot, "--yes"]);

      expect(code, workRoot).toBe(2);
      expect(h.stderr()).toMatch(message);
      expect(h.fs.writes).toEqual([]);
    }
  });

  it("refuses a work root whose real path is a protected directory", async () => {
    const h = harness();
    h.fs.seedDir(WORK_ROOT);
    h.fs.setRealPath(WORK_ROOT, "C:\\Users\\fixture");

    const code = await h.run(["--yes", "--json"]);

    expect(code).toBe(2);
    const report = lastJson(h);
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/refusing to clean/);
    expect(report.error).toMatch(/fixture/);
    expect(h.fs.writes).toEqual([]);
  });

  it("never deletes an entry whose real path escapes the work root", async () => {
    const h = harness();
    seedWorld(h);
    h.fs.setRealPath(`${WORK_ROOT}\\runs\\run-old`, "C:\\Users\\fixture\\Documents");

    const code = await h.run(["--yes", "--json"]);

    expect(code).toBe(0);
    const report = lastJson(h);
    expect(entry(report, "runs/run-old")).toMatchObject({ action: "report", unsafe: true });
    expect(await h.fs.exists(`${WORK_ROOT}\\runs\\run-old\\payload.bin`)).toBe(true);
    expect(report.summary).toMatchObject({ deleted: 4, freedBytes: 105 });
  });

  it("reports a failed removal and exits 1 while deleting the rest", async () => {
    const h = harness();
    seedWorld(h);
    h.fs.failRemove(`${WORK_ROOT}\\batches\\b-old`);

    const code = await h.run(["--yes", "--json"]);

    expect(code).toBe(1);
    const report = lastJson(h);
    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.relativePath).toBe("batches/b-old");
    expect(report.summary.deleted).toBe(4);
    expect(await h.fs.exists(`${WORK_ROOT}\\batches\\b-old\\payload.bin`)).toBe(true);
  });

  it("rejects invalid retention values and unsupported flags with exit 2", async () => {
    const cases: readonly (readonly [readonly string[], RegExp])[] = [
      [["--keep-batches", "nope"], /non-negative integer/],
      [["--keep-homes", "-1"], /needs a value|non-negative integer/],
      [["--keep"], /not valid for this command/],
      [["--keep-batches", "2", "extra"], /unexpected argument/],
    ];

    for (const [argv, message] of cases) {
      const h = harness();

      const code = await h.run([...argv, "--json"]);

      expect(code, argv.join(" ")).toBe(2);
      expect(h.stderr()).toMatch(message);
      const report = lastJson(h);
      expect(report.ok).toBe(false);
      expect(report.entries).toEqual([]);
      expect(h.fs.writes).toEqual([]);
    }
  });

  it("lets --dry-run override --yes", async () => {
    const h = harness();
    seedWorld(h);

    const code = await h.run(["--yes", "--dry-run", "--json"]);

    expect(code).toBe(0);
    expect(h.fs.writes).toEqual([]);
    const report = lastJson(h);
    expect(report.dryRun).toBe(true);
    expect(report.summary).toMatchObject({ delete: 5, deleted: 0, freedBytes: 0 });
    expect(h.stderr()).toContain("--dry-run overrides --yes");
  });

  it("treats a missing or empty work root as a successful no-op", async () => {
    const missing = harness();
    const missingCode = await missing.run(["--work-root", "C:\\work\\absent", "--json"]);
    expect(missingCode).toBe(0);
    expect(lastJson(missing).exists).toBe(false);
    expect(missing.fs.writes).toEqual([]);

    const empty = harness();
    empty.fs.seedDir(WORK_ROOT);
    const emptyCode = await empty.run(["--json"]);
    expect(emptyCode).toBe(0);
    expect(lastJson(empty)).toMatchObject({ exists: true, entries: [] });
    expect(empty.fs.writes).toEqual([]);
  });

  it("defaults the work root to <cwd>/.scratch/verify", async () => {
    const h = harness(null);
    h.fs.seedFile("C:\\fake\\repo\\.scratch\\verify\\runs\\run-old\\payload.bin", "x");
    h.fs.setMtime("C:\\fake\\repo\\.scratch\\verify\\runs\\run-old", 1_000);

    const code = await h.run(["--json"]);

    expect(code).toBe(0);
    const report = lastJson(h);
    expect(report.workRoot).toBe("C:\\fake\\repo\\.scratch\\verify");
    expect(entry(report, "runs/run-old").action).toBe("delete");
  });
});
