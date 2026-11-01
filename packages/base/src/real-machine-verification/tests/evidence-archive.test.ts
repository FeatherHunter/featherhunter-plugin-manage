/**
 * Evidence archiving is the audit trail's anchor: a frozen copy, a checksum file
 * that can be recomputed later, and a verifier that names exactly what changed.
 *
 * These tests drive the real modules through the in-memory filesystem. They pin
 * the policy decisions on purpose: the summary file is path-sorted and every line
 * (including the last) ends with \n; two archives in the same second get -2; and
 * a correction is a sidecar note, never an edit of the original.
 */
import { describe, expect, it } from "vitest";

import { sha256Text } from "../contracts/identity";
import type { EvidenceCommandDeps } from "../cli/commands/evidence";
import { runEvidenceCommand } from "../cli/commands/evidence";
import type { CliIo } from "../cli/io";
import { parseArgs } from "../cli/args";
import { archiveEvidence, writeArchiveNote } from "../evidence/archive";
import {
  SHA256SUMS_FILENAME,
  archiveDirectoryBaseName,
  renderSha256Sums,
} from "../evidence/paths";
import { verifyEvidenceArchive } from "../evidence/verify";
import { joinFsPath } from "../runtime/paths";
import { FakeClock, FakeEnv, FakeFs } from "./support/fake-fs";
import { makePorts } from "./support/fake-ports";

const WORK_ROOT = "C:/Temp/verify-work";
const BATCH_DIR = WORK_ROOT + "/batches/batch-1";
const ARCHIVE_ROOT = WORK_ROOT + "/evidence-archive";
const ISO = "2026-11-01T21:00:00.000+08:00";
const SUMS = SHA256SUMS_FILENAME;

function p(...segments: string[]): string {
  return segments.join("/");
}

function workspace(): { fs: FakeFs; clock: FakeClock } {
  return { fs: new FakeFs("C:/fake/repo"), clock: new FakeClock(ISO) };
}

function seedBatch(fs: FakeFs): void {
  fs.seedFile(p(BATCH_DIR, "evidence/evidence.json"), '{"schemaVersion":1}\n');
  fs.seedFile(p(BATCH_DIR, "evidence/files/environment.txt"), "node: 24.19.0\n");
  fs.seedFile(p(BATCH_DIR, "logs/run.log"), "log line\n");
}

function archiveOf(fs: FakeFs, clock: FakeClock) {
  return archiveEvidence({ fs, clock, batchDir: BATCH_DIR, batchName: "batch-1", archiveRoot: ARCHIVE_ROOT });
}

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stdout: (text: string) => {
      stdout.push(text);
    },
    stderr: (text: string) => {
      stderr.push(text);
    },
  };
  return { io, stdout, stderr };
}

function parseSingleJson(stdout: readonly string[]): any {
  expect(stdout).toHaveLength(1);
  const text = stdout[0] ?? "";
  expect(text.endsWith("\n")).toBe(true);
  const body = text.slice(0, -1);
  expect(body.includes("\n")).toBe(false);
  return JSON.parse(body) as any;
}

function cliPorts(fs: FakeFs, clock: FakeClock) {
  return makePorts({ fs, clock, env: new FakeEnv({ cwd: "C:/fake/repo" }) });
}

function batchDeps(ports: ReturnType<typeof makePorts>, io: CliIo): EvidenceCommandDeps {
  return { ports, io, batch: { batchName: "batch-1", batchDir: BATCH_DIR } };
}

describe("SHA256SUMS rendering policy", () => {
  it("is path-sorted, one line per file, every line newline-terminated, empty means empty", () => {
    const rendered = renderSha256Sums([
      { path: "logs/z.log", sha256: sha256Text("z") },
      { path: "evidence/a.txt", sha256: sha256Text("a") },
    ]);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toBe(sha256Text("a") + "  evidence/a.txt\n" + sha256Text("z") + "  logs/z.log\n");

    const empty = renderSha256Sums([]);
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value).toBe("");

    const duplicate = renderSha256Sums([
      { path: "a.txt", sha256: sha256Text("a") },
      { path: "a.txt", sha256: sha256Text("b") },
    ]);
    expect(duplicate.ok).toBe(false);

    const reserved = renderSha256Sums([{ path: SUMS, sha256: sha256Text("x") }]);
    expect(reserved.ok).toBe(false);
  });
});

describe("evidence archive", () => {
  it("archives a batch and verifies green, locking the summary bytes", async () => {
    const { fs, clock } = workspace();
    seedBatch(fs);

    const archived = await archiveOf(fs, clock);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const directory = archived.value.directory;
    expect(directory).toBe(joinFsPath(ARCHIVE_ROOT, archiveDirectoryBaseName("batch-1", ISO)));
    expect(archived.value.files.map((file) => file.path)).toEqual([
      "evidence/evidence.json",
      "evidence/files/environment.txt",
      "logs/run.log",
    ]);

    const sums = fs.readFileSync(p(directory, SUMS));
    expect(sums.endsWith("\n")).toBe(true);
    expect(sums.includes("\r")).toBe(false);
    const lines = sums.slice(0, -1).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.slice(66))).toEqual([
      "evidence/evidence.json",
      "evidence/files/environment.txt",
      "logs/run.log",
    ]);
    expect(lines[0]).toBe(sha256Text('{"schemaVersion":1}\n') + "  evidence/evidence.json");
    expect(lines[1]).toBe(sha256Text("node: 24.19.0\n") + "  evidence/files/environment.txt");
    expect(lines[2]).toBe(sha256Text("log line\n") + "  logs/run.log");

    const verified = await verifyEvidenceArchive({ fs, directory });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.ok).toBe(true);
    expect(verified.value.checked).toBe(3);
    expect(verified.value.issues).toEqual([]);
    expect(verified.value.annotations).toEqual([]);
    expect(fs.readFileSync(p(directory, SUMS))).toBe(sums);
  });

  it("refuses a batch directory that does not exist", async () => {
    const { fs, clock } = workspace();
    const archived = await archiveOf(fs, clock);
    expect(archived.ok).toBe(false);
    if (!archived.ok) expect(archived.error.code).toBe("not-found");

    const verified = await verifyEvidenceArchive({ fs, directory: ARCHIVE_ROOT + "/nothing-here" });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("not-found");
  });

  it("names the modified, missing and extra files when an archive is tampered with", async () => {
    const { fs, clock } = workspace();
    seedBatch(fs);
    const archived = await archiveOf(fs, clock);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const directory = archived.value.directory;

    fs.seedFile(p(directory, "evidence/files/environment.txt"), "tampered\n");
    const removed = await fs.remove(p(directory, "logs/run.log"), { recursive: false });
    expect(removed.ok).toBe(true);
    fs.seedFile(p(directory, "intruder.txt"), "stray\n");

    const verified = await verifyEvidenceArchive({ fs, directory });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const result = verified.value;
    expect(result.ok).toBe(false);
    expect(result.counts).toEqual({ modified: 1, missing: 1, extra: 1, malformed: 0 });

    const modified = result.issues.find((issue) => issue.kind === "modified");
    expect(modified?.path).toBe("evidence/files/environment.txt");
    expect(modified?.expected).toBe(sha256Text("node: 24.19.0\n"));
    expect(modified?.actual).toBe(sha256Text("tampered\n"));

    const missing = result.issues.find((issue) => issue.kind === "missing");
    expect(missing?.path).toBe("logs/run.log");

    const extra = result.issues.find((issue) => issue.kind === "extra");
    expect(extra?.path).toBe("intruder.txt");
  });

  it("flags a malformed summary line with its line number and tolerates CRLF", async () => {
    const { fs, clock } = workspace();
    seedBatch(fs);
    const archived = await archiveOf(fs, clock);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const directory = archived.value.directory;
    const sums = fs.readFileSync(p(directory, SUMS));

    fs.seedFile(p(directory, SUMS), sums + "not a checksum line\n");
    const broken = await verifyEvidenceArchive({ fs, directory });
    expect(broken.ok).toBe(true);
    if (!broken.ok) return;
    const malformed = broken.value.issues.filter((issue) => issue.kind === "malformed");
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.line).toBe(4);
    expect(malformed[0]?.message).toContain("第 4 行");
    expect(broken.value.ok).toBe(false);

    fs.seedFile(p(directory, SUMS), sums.replace(/\n/g, "\r\n"));
    const crlf = await verifyEvidenceArchive({ fs, directory });
    expect(crlf.ok).toBe(true);
    if (crlf.ok) {
      expect(crlf.value.ok).toBe(true);
      expect(crlf.value.checked).toBe(3);
    }
  });

  it("keeps two archives of the same second apart and both verifiable", async () => {
    const { fs, clock } = workspace();
    seedBatch(fs);

    const first = await archiveOf(fs, clock);
    const second = await archiveOf(fs, clock);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.directory).toBe(first.value.directory + "-2");

    const firstVerified = await verifyEvidenceArchive({ fs, directory: first.value.directory });
    const secondVerified = await verifyEvidenceArchive({ fs, directory: second.value.directory });
    expect(firstVerified.ok && secondVerified.ok).toBe(true);
    if (firstVerified.ok && secondVerified.ok) {
      expect(firstVerified.value.ok).toBe(true);
      expect(secondVerified.value.ok).toBe(true);
      expect(firstVerified.value.checked).toBe(3);
    }
  });

  it("archives an empty batch to an empty summary that still verifies", async () => {
    const { fs, clock } = workspace();
    fs.seedDir(BATCH_DIR);

    const archived = await archiveOf(fs, clock);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(fs.readFileSync(p(archived.value.directory, SUMS))).toBe("");

    const verified = await verifyEvidenceArchive({ fs, directory: archived.value.directory });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.ok).toBe(true);
    expect(verified.value.checked).toBe(0);
  });

  it("writes corrections as sidecar notes without touching the archive originals", async () => {
    const { fs, clock } = workspace();
    seedBatch(fs);
    const archived = await archiveOf(fs, clock);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const directory = archived.value.directory;
    const sumsBefore = fs.readFileSync(p(directory, SUMS));

    const noteText = "更正：environment 取自第二次运行，第一次仅含版本号。";
    const note = await writeArchiveNote({ fs, clock, archiveDir: directory, note: noteText, author: "fixture" });
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    expect(note.value.path.startsWith("notes/")).toBe(true);
    expect(note.value.path.endsWith(".md")).toBe(true);
    expect(note.value.content).toContain(noteText);
    expect(fs.readFileSync(p(directory, note.value.path))).toBe(note.value.content);

    const verified = await verifyEvidenceArchive({ fs, directory });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.ok).toBe(true);
    expect(verified.value.annotations).toEqual([note.value.path]);
    expect(fs.readFileSync(p(directory, SUMS))).toBe(sumsBefore);

    const notArchive = await writeArchiveNote({ fs, clock, archiveDir: WORK_ROOT + "/not-an-archive", note: "x" });
    expect(notArchive.ok).toBe(false);
    if (!notArchive.ok) expect(notArchive.error.code).toBe("prerequisite");
  });
});

describe("evidence CLI", () => {
  it("injects the candidate from the batch context and ignores an extra candidate", async () => {
    const fs = new FakeFs("C:/fake/repo");
    const clock = new FakeClock(ISO);
    fs.seedFile("C:/fake/repo/captures/environment.txt", "node: 24.19.0\n");
    const ports = cliPorts(fs, clock);
    const { io, stdout, stderr } = captureIo();
    const deps: EvidenceCommandDeps = {
      ports,
      io,
      batch: {
        batchName: "batch-1",
        batchDir: BATCH_DIR,
        candidate: { commit: "abc1234" },
        meta: { packageName: "fixture-plugin" },
        extra: { candidate: { commit: "deadbeef" }, note: "from extra" },
      },
    };

    const code = await runEvidenceCommand(
      parseArgs(["evidence", "add", "--file", "captures/environment.txt", "--check", "environment=pass", "--json"]),
      deps,
    );
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const json = parseSingleJson(stdout);
    expect(json.ok).toBe(true);
    expect(json.subcommand).toBe("add");
    expect(json.items).toHaveLength(1);
    expect(json.items[0].path).toBe("files/environment.txt");
    expect(json.checks[0]).toMatchObject({ name: "environment", ok: true });
    expect(fs.readFileSync(p(BATCH_DIR, "evidence/files/environment.txt"))).toBe("node: 24.19.0\n");

    const manifest = fs.readJsonSync(p(BATCH_DIR, "evidence/evidence.json")) as {
      candidate?: unknown;
      note?: unknown;
      items: { path: string }[];
    };
    expect(manifest.candidate).toEqual({ commit: "abc1234" });
    expect(manifest.note).toBe("from extra");
    expect(manifest.items.map((item) => item.path)).toEqual(["files/environment.txt"]);
  });

  it("adds same-named evidence under the next ordinal instead of overwriting", async () => {
    const fs = new FakeFs("C:/fake/repo");
    const clock = new FakeClock(ISO);
    fs.seedFile("C:/fake/repo/captures/a/command.txt", "first\n");
    fs.seedFile("C:/fake/repo/captures/b/command.txt", "second\n");
    const ports = cliPorts(fs, clock);
    const deps = batchDeps(ports, captureIo().io);

    const code = await runEvidenceCommand(
      parseArgs(["evidence", "add", "--file", "captures/a/command.txt", "--file", "captures/b/command.txt", "--json"]),
      deps,
    );
    expect(code).toBe(0);
    expect(fs.readFileSync(p(BATCH_DIR, "evidence/files/command.txt"))).toBe("first\n");
    expect(fs.readFileSync(p(BATCH_DIR, "evidence/files/command-2.txt"))).toBe("second\n");

    const again = await runEvidenceCommand(
      parseArgs(["evidence", "add", "--file", "captures/a/command.txt", "--json"]),
      batchDeps(ports, captureIo().io),
    );
    expect(again).toBe(0);
    const manifest = fs.readJsonSync(p(BATCH_DIR, "evidence/evidence.json")) as { items: { path: string }[] };
    expect(manifest.items.map((item) => item.path)).toEqual([
      "files/command.txt",
      "files/command-2.txt",
      "files/command-3.txt",
    ]);
    expect(fs.readFileSync(p(BATCH_DIR, "evidence/files/command-3.txt"))).toBe("first\n");
  });

  it("prints human result lines when --json is absent", async () => {
    const fs = new FakeFs("C:/fake/repo");
    const clock = new FakeClock(ISO);
    fs.seedFile("C:/fake/repo/captures/environment.txt", "node: 24.19.0\n");
    const ports = cliPorts(fs, clock);
    const { io, stdout } = captureIo();

    const code = await runEvidenceCommand(
      parseArgs(["evidence", "add", "--file", "captures/environment.txt", "--check", "environment=pass"]),
      batchDeps(ports, io),
    );
    expect(code).toBe(0);
    const text = stdout.join("");
    expect(text).toContain("added files/environment.txt");
    expect(text).toContain("check environment pass");
    expect(text).toContain("manifest ");
  });

  it("archives and verifies through the CLI with one JSON document and 0/1 exit codes", async () => {
    const fs = new FakeFs("C:/fake/repo");
    const clock = new FakeClock(ISO);
    seedBatch(fs);
    const ports = cliPorts(fs, clock);

    const archiveIo = captureIo();
    const archiveCode = await runEvidenceCommand(
      parseArgs(["evidence", "archive", "--dir", BATCH_DIR, "--archive-root", ARCHIVE_ROOT, "--json"]),
      { ports, io: archiveIo.io },
    );
    expect(archiveCode).toBe(0);
    const archiveJson = parseSingleJson(archiveIo.stdout);
    expect(archiveJson.ok).toBe(true);
    expect(archiveJson.subcommand).toBe("archive");
    const directory = archiveJson.archive.directory as string;
    expect(directory).toBe(joinFsPath(ARCHIVE_ROOT, archiveDirectoryBaseName("batch-1", ISO)));
    expect(await fs.exists(p(directory, SUMS))).toBe(true);

    const verifyIo = captureIo();
    const verifyCode = await runEvidenceCommand(
      parseArgs(["evidence", "verify", "--dir", directory, "--json"]),
      { ports, io: verifyIo.io },
    );
    expect(verifyCode).toBe(0);
    const verifyJson = parseSingleJson(verifyIo.stdout);
    expect(verifyJson.ok).toBe(true);
    expect(verifyJson.checked).toBe(3);

    fs.seedFile(p(directory, "evidence/files/environment.txt"), "tampered\n");
    const badIo = captureIo();
    const badCode = await runEvidenceCommand(
      parseArgs(["evidence", "verify", "--dir", directory, "--json"]),
      { ports, io: badIo.io },
    );
    expect(badCode).toBe(1);
    const badJson = parseSingleJson(badIo.stdout);
    expect(badJson.ok).toBe(false);
    const modified = (badJson.issues as { kind: string; path?: string }[]).find(
      (issue) => issue.kind === "modified",
    );
    expect(modified?.path).toBe("evidence/files/environment.txt");
  });

  it("maps usage and prerequisite problems to exit 2 with a failure document", async () => {
    const fs = new FakeFs("C:/fake/repo");
    const clock = new FakeClock(ISO);
    const ports = cliPorts(fs, clock);

    const noDirIo = captureIo();
    const noDir = await runEvidenceCommand(parseArgs(["evidence", "verify", "--json"]), { ports, io: noDirIo.io });
    expect(noDir).toBe(2);
    expect(noDirIo.stderr.join("")).toContain("verify 需要 --dir");
    expect(parseSingleJson(noDirIo.stdout).ok).toBe(false);

    const noBatchIo = captureIo();
    const noBatch = await runEvidenceCommand(parseArgs(["evidence", "archive", "--json"]), { ports, io: noBatchIo.io });
    expect(noBatch).toBe(2);

    const badCheckIo = captureIo();
    const badCheck = await runEvidenceCommand(
      parseArgs(["evidence", "add", "--check", "not-a-check", "--json"]),
      batchDeps(ports, badCheckIo.io),
    );
    expect(badCheck).toBe(2);
    expect(badCheckIo.stderr.join("")).toContain("--check 需要");
    expect(await fs.exists(p(BATCH_DIR, "evidence/evidence.json"))).toBe(false);

    const unknownIo = captureIo();
    const unknown = await runEvidenceCommand(
      parseArgs(["evidence", "add", "--file", "x", "--bogus", "--json"]),
      batchDeps(ports, unknownIo.io),
    );
    expect(unknown).toBe(2);
    expect(unknownIo.stderr.join("")).toContain("unknown option");

    const subIo = captureIo();
    const badSub = await runEvidenceCommand(parseArgs(["evidence", "explode"]), { ports, io: subIo.io });
    expect(badSub).toBe(2);
    expect(subIo.stderr.join("")).toContain("未知子命令");

    const emptyIo = captureIo();
    const empty = await runEvidenceCommand(parseArgs(["evidence", "add", "--json"]), batchDeps(ports, emptyIo.io));
    expect(empty).toBe(2);
    expect(emptyIo.stderr.join("")).toContain("add 需要至少一个");
  });
});

describe("evidence --dry-run", () => {
  it("plans an archive without creating the archive root or copying any file", async () => {
    const { fs, clock } = workspace();
    seedBatch(fs);
    const capture = captureIo();

    const code = await runEvidenceCommand(
      parseArgs(["evidence", "archive", "--dir", BATCH_DIR, "--work-root", WORK_ROOT, "--json", "--dry-run"]),
      { ports: cliPorts(fs, clock), io: capture.io },
    );

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    const doc = parseSingleJson(capture.stdout);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.command).toBe("evidence");
    expect(doc.subcommand).toBe("archive");
    expect(doc.dryRun).toBe(true);
    expect(doc.plan.batch).toEqual({ name: "batch-1", dir: BATCH_DIR });
    expect(doc.plan.directory).toBe(
      joinFsPath(joinFsPath(WORK_ROOT, "evidence-archive"), archiveDirectoryBaseName("batch-1", ISO)),
    );
    expect(doc.plan.createdAt).toBe(ISO);
    expect(doc.plan.fileCount).toBe(3);
    expect(doc.plan.files.map((file: { readonly path: string }) => file.path)).toEqual([
      "evidence/evidence.json",
      "evidence/files/environment.txt",
      "logs/run.log",
    ]);
    expect(doc.plan.copied.files).toBe(3);
    expect(doc.plan.copied.bytes).toBeGreaterThan(0);
    expect(doc.plan.sumsPath).toBe(joinFsPath(doc.plan.directory, SUMS));
    expect(doc.plan.fileDigest).toMatch(/^[0-9a-f]{64}$/);

    expect(fs.writes).toEqual([]);
    expect(await fs.exists(ARCHIVE_ROOT)).toBe(false);
  });

  it("plans an add against the existing manifest without copying bytes or publishing it", async () => {
    const { fs, clock } = workspace();
    const ports = cliPorts(fs, clock);
    const source = p(WORK_ROOT, "src", "first.txt");
    fs.seedFile(source, "first\n");

    const firstIo = captureIo();
    const first = await runEvidenceCommand(
      parseArgs(["evidence", "add", "--file", source, "--check", "smoke=pass", "--json"]),
      batchDeps(ports, firstIo.io),
    );
    expect(first).toBe(0);

    fs.writes.splice(0);
    const second = p(WORK_ROOT, "src", "second.txt");
    fs.seedFile(second, "second\n");
    const capture = captureIo();
    const code = await runEvidenceCommand(
      parseArgs([
        "evidence",
        "add",
        "--file",
        second,
        "--check",
        "again=pass",
        "--dir",
        BATCH_DIR,
        "--json",
        "--dry-run",
      ]),
      { ports, io: capture.io },
    );

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    const doc = parseSingleJson(capture.stdout);
    expect(doc.subcommand).toBe("add");
    expect(doc.dryRun).toBe(true);
    expect(doc.plan.batch.name).toBe("batch-1");
    expect(doc.plan.batch.dir).toBe(BATCH_DIR);
    expect(doc.plan.fileCount).toBe(1);
    expect(doc.plan.files[0]).toMatchObject({
      source: second,
      name: "second.txt",
      target: joinFsPath(BATCH_DIR, "evidence", "files", "second.txt"),
      bytes: 7,
      sha256: sha256Text("second\n"),
    });
    expect(doc.plan.checks.map((check: { readonly name: string }) => check.name)).toEqual(["again"]);
    expect(doc.plan.manifest.replacing).toBe(true);
    expect(doc.plan.manifest.itemCount).toBe(2);

    expect(fs.writes).toEqual([]);
    expect(await fs.exists(joinFsPath(BATCH_DIR, "evidence", "files", "second.txt"))).toBe(false);
  });
});
