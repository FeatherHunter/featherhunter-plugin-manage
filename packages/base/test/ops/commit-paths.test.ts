/**
 * Commit contract for the ops committer (ticket 07).
 *
 * commit-paths.mjs exists so an agent can commit exactly the paths it touched:
 * unrelated staged work must not ride along, paths outside the repo must be
 * refused, --dry-run must leave the index alone, and the message file must be
 * committed byte-for-byte (PowerShell mangles -m messages containing <tags>,
 * which is why the message comes from a file in the first place).
 *
 * Everything here drives the script across its process boundary and inspects
 * the resulting git repository: exit codes, stderr text, stdout JSON and the
 * actual commit object. Script internals are never imported.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  initGitRepo,
  makeTempDir,
  removeTempDir,
  runOps,
  writeFiles,
  type GitResult,
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

/** Git output is compared with forward slashes and a single EOL style. */
function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function normalizePath(value: string): string {
  return normalizeText(value).replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizePaths(values: readonly string[]): string[] {
  return values.map(normalizePath).sort();
}

/** Raw git invocation: no output trimming, so commit-message bytes survive. */
function gitRaw(repo: string, args: readonly string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    code: result.status === null ? 1 : result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function mustGit(repo: string, args: readonly string[], what: string): GitResult {
  const result = gitRaw(repo, args);
  if (result.code !== 0) throw new Error("git " + what + " failed (" + result.code + "): " + result.stderr);
  return result;
}

function gitPaths(repo: string, args: readonly string[]): string[] {
  return normalizePaths(mustGit(repo, args, args.join(" ")).stdout.split("\n").filter(Boolean));
}

function headOf(repo: string): string {
  return mustGit(repo, ["rev-parse", "HEAD"], "rev-parse HEAD").stdout.trim();
}

function commitCount(repo: string): number {
  return Number(mustGit(repo, ["rev-list", "--count", "HEAD"], "rev-list --count HEAD").stdout.trim());
}

function indexHash(repo: string): string {
  return createHash("sha256").update(readFileSync(join(repo, ".git", "index"))).digest("hex");
}

interface RepoFixture {
  /** Parent directory that also holds the message file and outside-path fixtures. */
  work: string;
  repo: string;
  messageFile: string;
  git: (args: readonly string[]) => GitResult;
}

/** A temp repo with one baseline commit and a message file outside the worktree. */
function makeRepo(files: Record<string, string>): RepoFixture {
  const work = tempDir("fh-commit-paths-");
  const repo = join(work, "repo");
  writeFiles(repo, files);
  const git = initGitRepo(repo);
  expect(git(["add", "-A"]).code, "baseline git add").toBe(0);
  expect(git(["commit", "-m", "baseline"]).code, "baseline commit").toBe(0);
  const messageFile = join(work, "message.txt");
  writeFileSync(messageFile, "ticket(07): subject\n\nbody\n", "utf8");
  return { work, repo, messageFile, git };
}

function runCommitPaths(fx: RepoFixture, args: readonly string[]) {
  return runOps(
    "scripts/ops/commit-paths.mjs",
    ["--repo", fx.repo, "--message-file", fx.messageFile, ...args],
    { cwd: fx.work },
  );
}
describe("commit-paths contract", () => {
  it("commits only the specified paths and reports the hash and file list as JSON", async () => {
    const fx = makeRepo({ "a.txt": "a1\n", "b.txt": "b1\n", "keep.txt": "k1\n" });
    writeFileSync(join(fx.repo, "a.txt"), "a2\n", "utf8");
    writeFileSync(join(fx.repo, "b.txt"), "b2\n", "utf8");
    writeFileSync(join(fx.repo, "untracked.txt"), "new\n", "utf8");
    const beforeHead = headOf(fx.repo);

    const run = await runCommitPaths(fx, ["--json", "a.txt"]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    const report = JSON.parse(run.stdout) as { ok: boolean; hash: string; files: string[]; message: string };
    const head = headOf(fx.repo);
    expect(report.ok).toBe(true);
    expect(report.hash).toBe(head);
    expect(head).not.toBe(beforeHead);
    expect(commitCount(fx.repo)).toBe(2);
    expect(normalizePaths(report.files)).toEqual(["a.txt"]);

    expect(gitPaths(fx.repo, ["show", "--pretty=format:", "--name-only", "HEAD"])).toEqual(["a.txt"]);
    expect(gitPaths(fx.repo, ["diff", "--cached", "--name-only"])).toEqual([]);

    const status = mustGit(fx.repo, ["status", "--porcelain"], "status").stdout.split("\n").filter(Boolean);
    expect(status).toContain(" M b.txt");
    expect(status).toContain("?? untracked.txt");
    expect(status.some((line) => line.includes("a.txt"))).toBe(false);
  });

  it("refuses unrelated staged changes with exit 2, lists them on stderr, and leaves the index alone", async () => {
    const fx = makeRepo({ "a.txt": "a1\n", "b.txt": "b1\n" });
    writeFileSync(join(fx.repo, "a.txt"), "a2\n", "utf8");
    writeFileSync(join(fx.repo, "b.txt"), "b2\n", "utf8");
    mustGit(fx.repo, ["add", "--", "b.txt"], "stage b.txt");
    const beforeHead = headOf(fx.repo);
    const beforeIndex = indexHash(fx.repo);
    const beforeCount = commitCount(fx.repo);

    const run = await runCommitPaths(fx, ["a.txt"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("b.txt");
    expect(run.stderr.toLowerCase()).toContain("refus");
    expect(headOf(fx.repo)).toBe(beforeHead);
    expect(commitCount(fx.repo)).toBe(beforeCount);
    expect(gitPaths(fx.repo, ["diff", "--cached", "--name-only"])).toEqual(["b.txt"]);
    expect(indexHash(fx.repo), "a refused commit must not rewrite the index").toBe(beforeIndex);
  });

  it("lets unrelated staged changes ride along only with --include-staged", async () => {
    const fx = makeRepo({ "a.txt": "a1\n", "b.txt": "b1\n" });
    writeFileSync(join(fx.repo, "a.txt"), "a2\n", "utf8");
    writeFileSync(join(fx.repo, "b.txt"), "b2\n", "utf8");
    mustGit(fx.repo, ["add", "--", "b.txt"], "stage b.txt");

    const run = await runCommitPaths(fx, ["--include-staged", "--json", "a.txt"]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    const report = JSON.parse(run.stdout) as { files: string[] };
    expect(normalizePaths(report.files)).toEqual(["a.txt", "b.txt"]);
    expect(gitPaths(fx.repo, ["show", "--pretty=format:", "--name-only", "HEAD"])).toEqual(["a.txt", "b.txt"]);
    expect(gitPaths(fx.repo, ["diff", "--cached", "--name-only"])).toEqual([]);
  });

  it("commits an already-staged requested path without demanding --include-staged", async () => {
    const fx = makeRepo({ "a.txt": "a1\n", "b.txt": "b1\n" });
    writeFileSync(join(fx.repo, "a.txt"), "a2\n", "utf8");
    writeFileSync(join(fx.repo, "b.txt"), "b2\n", "utf8");
    mustGit(fx.repo, ["add", "--", "a.txt"], "stage a.txt");

    const run = await runCommitPaths(fx, ["--json", "a.txt"]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    const report = JSON.parse(run.stdout) as { files: string[] };
    expect(normalizePaths(report.files)).toEqual(["a.txt"]);
    const status = mustGit(fx.repo, ["status", "--porcelain"], "status").stdout.split("\n").filter(Boolean);
    expect(status).toContain(" M b.txt");
  });

  it("refuses relative and absolute paths outside the repo without committing them", async () => {
    const fx = makeRepo({ "a.txt": "a1\n" });
    const outside = join(fx.work, "outside.txt");
    writeFileSync(outside, "outside\n", "utf8");
    const beforeHead = headOf(fx.repo);

    for (const escape of ["../outside.txt", outside]) {
      const run = await runCommitPaths(fx, ["--json", escape]);
      expect(run.code, "path: " + escape + " stderr: " + run.stderr).toBe(2);
      expect(run.stderr).toContain("escapes the repo");
      expect(headOf(fx.repo), "no commit for " + escape).toBe(beforeHead);
      expect(gitPaths(fx.repo, ["diff", "--cached", "--name-only"]), "no staging for " + escape).toEqual([]);
    }

    expect(readFileSync(outside, "utf8")).toBe("outside\n");
    const history = normalizeText(mustGit(fx.repo, ["log", "--all", "--pretty=format:", "--name-only"], "log").stdout);
    expect(history).not.toContain("outside.txt");
  });

  it("--dry-run creates no commit and leaves HEAD, the index and the worktree untouched", async () => {
    const fx = makeRepo({ "a.txt": "a1\n", "b.txt": "b1\n" });
    writeFileSync(join(fx.repo, "a.txt"), "a2\n", "utf8");
    writeFileSync(join(fx.repo, "new.txt"), "new\n", "utf8");
    // --no-optional-locks keeps these snapshots from refreshing the index
    // themselves, so the hash below reflects the script's behaviour only.
    const beforeStatus = mustGit(fx.repo, ["--no-optional-locks", "status", "--porcelain"], "status").stdout;
    const beforeHead = headOf(fx.repo);
    const beforeCached = gitPaths(fx.repo, ["diff", "--cached", "--name-only"]);
    const beforeIndex = indexHash(fx.repo);
    const beforeCount = commitCount(fx.repo);

    const run = await runCommitPaths(fx, ["--dry-run", "--json", "a.txt"]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    const report = JSON.parse(run.stdout) as { ok: boolean; dryRun: boolean; paths: string[] };
    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(normalizePaths(report.paths)).toEqual(["a.txt"]);

    expect(headOf(fx.repo)).toBe(beforeHead);
    expect(commitCount(fx.repo)).toBe(beforeCount);
    expect(gitPaths(fx.repo, ["diff", "--cached", "--name-only"])).toEqual(beforeCached);
    expect(indexHash(fx.repo), "--dry-run must not rewrite the index").toBe(beforeIndex);
    expect(mustGit(fx.repo, ["--no-optional-locks", "status", "--porcelain"], "status").stdout).toBe(beforeStatus);
  });

  it("commits the message file byte-for-byte (tags, quotes, multi-line, trailing spaces)", async () => {
    const fx = makeRepo({ "a.txt": "a1\n" });
    const message = [
      'ticket(07): keep <tag> & "double" \'single\'  ',
      "",
      "body line with trailing spaces   ",
      "second <angle> line",
      "# hash-prefixed line is part of the message",
      "",
    ].join("\n");
    writeFileSync(fx.messageFile, message, "utf8");
    writeFileSync(join(fx.repo, "a.txt"), "a2\n", "utf8");
    const firstLine = message.split("\n")[0];

    const run = await runCommitPaths(fx, ["--json", "a.txt"]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    const report = JSON.parse(run.stdout) as { message: string };
    expect(report.message).toBe(firstLine);

    const raw = mustGit(fx.repo, ["cat-file", "commit", "HEAD"], "cat-file commit").stdout;
    const stored = raw.slice(raw.indexOf("\n\n") + 2);
    expect(normalizeText(stored)).toBe(normalizeText(message));
    expect(stored).toContain("<tag>");
    expect(stored.split("\n")[0]).toBe(firstLine);
  });

  it("exits 1 and explains the index state when git refuses the commit", async () => {
    const fx = makeRepo({ "a.txt": "a1\n" });
    writeFileSync(join(fx.repo, "a.txt"), "a2\n", "utf8");
    // Force `git commit` to fail after `git add` has succeeded: COMMIT_EDITMSG
    // cannot be opened for writing when it is a directory.
    const editMessage = join(fx.repo, ".git", "COMMIT_EDITMSG");
    rmSync(editMessage, { recursive: true, force: true });
    mkdirSync(editMessage);
    const beforeHead = headOf(fx.repo);

    const run = await runCommitPaths(fx, ["--json", "a.txt"]);

    expect(run.code).toBe(1);
    expect(run.stdout.trim()).toBe("");
    expect(run.stderr).toContain("git commit failed");
    expect(run.stderr).toContain("staged paths were left in the index");
    expect(run.stderr).toContain("a.txt");
    expect(headOf(fx.repo)).toBe(beforeHead);
    expect(gitPaths(fx.repo, ["diff", "--cached", "--name-only"])).toEqual(["a.txt"]);
  });

  it("keeps --help and the exit-code contract in agreement", async () => {
    const help = await runOps("scripts/ops/commit-paths.mjs", ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: node scripts/ops/commit-paths.mjs");
    expect(help.stdout).toContain("Exit codes: 0 committed, 1 git refused, 2 prerequisite error.");
    expect(help.stderr).toBe("");

    const fx = makeRepo({ "a.txt": "a1\n" });

    const missingMessage = await runOps("scripts/ops/commit-paths.mjs", [
      "--repo", fx.repo, "--message-file", join(fx.work, "missing.txt"), "a.txt",
    ]);
    expect(missingMessage.code).toBe(2);
    expect(missingMessage.stderr).toContain("--message-file");

    const noPaths = await runOps("scripts/ops/commit-paths.mjs", [
      "--repo", fx.repo, "--message-file", fx.messageFile,
    ]);
    expect(noPaths.code).toBe(2);
    expect(noPaths.stderr).toContain("no paths given");

    const notARepo = await runOps("scripts/ops/commit-paths.mjs", [
      "--repo", fx.work, "--message-file", fx.messageFile, "a.txt",
    ]);
    expect(notARepo.code).toBe(2);
    expect(notARepo.stderr).toContain("not a git worktree");
  });
});