/**
 * Ticket 08: contract for the read-only local markdown ticket reader.
 *
 * Everything below is asserted across the process boundary: exit codes, stdout
 * JSON, stderr text and on-disk effects. The reader must resolve keys exactly,
 * report cross-effort ambiguity with candidates (never guess), and never write
 * to the repository it reads.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeTempDir, removeTempDir, runOps, writeFiles } from "./support/ops-fixtures";
import { TICKET_FIXTURE_FILES } from "./support/ticket-fixtures";

const SCRIPT = "scripts/ops/tickets.mjs";
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) removeTempDir(dir);
});

/** A fixture repo with several efforts, ambiguous keys and Chinese names. */
function makeTicketRepo(): string {
  const repo = tempDir("fh-ops-tickets-");
  writeFiles(repo, TICKET_FIXTURE_FILES);
  return repo;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

interface TicketProgress {
  percent: number;
  raw: string;
  rest: string;
}

interface TicketComment {
  heading: string;
  lines: string[];
}

interface TicketView {
  effort: string;
  key: string;
  displayKey?: string;
  type: string;
  title: string;
  state: string;
  stateRaw: string;
  parent: string | null;
  labels: string[];
  blockedBy: string[];
  progress: TicketProgress | null;
  comments: number;
  lastCommentAt: string | null;
  file: string;
  body: string;
  commentsText?: TicketComment[];
}

interface CandidateView {
  key: string;
  type: string;
  effort: string;
  state: string;
  stateRaw: string;
  title: string;
  parent: string | null;
  file: string;
}

interface FailureView {
  error: string;
  key: string;
  candidates: CandidateView[];
}

interface RunLike {
  code: number;
  stdout: string;
  stderr: string;
}

function parseJson<T>(run: RunLike): T {
  try {
    return JSON.parse(run.stdout) as T;
  } catch {
    throw new Error(
      "stdout is not JSON (exit " + run.code + "):\n" + run.stdout + "\nstderr:\n" + run.stderr,
    );
  }
}

/** Read one "name: value" line from the human-readable ticket view. */
function field(stdout: string, name: string): string {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(name + ":"));
  if (line === undefined) throw new Error("missing " + name + " field in:\n" + stdout);
  return line.slice(name.length + 1).trim();
}

/** Directories and files (bytes + size + mtime), so an empty dir also counts. */
function treeSignature(root: string): string {
  const rows: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (entry.isDirectory()) {
        rows.push("d " + rel);
        walk(abs);
        continue;
      }
      const stat = statSync(abs);
      const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
      rows.push("f " + rel + " " + stat.size + " " + stat.mtimeMs + " " + digest);
    }
  };
  walk(root);
  return rows.join("\n");
}

describe("ticket reader: one key inside one effort", () => {
  it("returns title, state, parent, blockers, progress and comments as JSON", async () => {
    const repo = makeTicketRepo();
    const run = await runOps(SCRIPT, [
      "--repo", repo, "--effort", "alpha", "--key", "02", "--json", "--comments", "1",
    ]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    expect(run.stderr, "successful --json must keep stderr quiet").toBe("");

    const data = parseJson<{ ticket: TicketView; comments: TicketComment[] }>(run);
    const ticket = data.ticket;
    expect(ticket.effort).toBe("alpha");
    expect(ticket.type).toBe("issue");
    expect(ticket.title).toBe("实施票");
    expect(ticket.state).toBe("open");
    expect(ticket.stateRaw).toBe("ready-for-agent");
    expect(ticket.parent).toBe("00");
    expect(ticket.blockedBy).toEqual(["01"]);
    expect(ticket.progress?.percent).toBe(40);
    expect(ticket.comments).toBe(1);
    expect(ticket.lastCommentAt).toBe("local — 2026-11-01T05:00:00.000Z");
    expect(normalizePath(ticket.file)).toMatch(/\/\.scratch\/alpha\/issues\/02-实施票\.md$/);
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0]?.heading).toBe("local — 2026-11-01T05:00:00.000Z");
    expect(data.comments[0]?.lines.join("\n")).toContain("只剩验证一步");
  }, 60_000);

  it("prints the same fields in human-readable form, with the requested comment bodies", async () => {
    const repo = makeTicketRepo();
    const run = await runOps(SCRIPT, [
      "--repo", repo, "--effort", "alpha", "--key", "02", "--comments", "1",
    ]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    expect(field(run.stdout, "title")).toBe("实施票");
    expect(field(run.stdout, "state")).toContain("open");
    expect(field(run.stdout, "parent")).toBe("00");
    expect(field(run.stdout, "blockedBy")).toBe("01");
    expect(field(run.stdout, "progress")).toMatch(/^40%/);
    expect(field(run.stdout, "comments")).toMatch(/^1\b/);
    expect(run.stdout).toContain("--- local — 2026-11-01T05:00:00.000Z ---");
    expect(run.stdout).toContain("只剩验证一步");
  }, 60_000);

  it("reads the effort's spec container through --key 00", async () => {
    const repo = makeTicketRepo();
    const run = await runOps(SCRIPT, ["--repo", repo, "--effort", "alpha", "--key", "00", "--json"]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    const { ticket } = parseJson<{ ticket: TicketView }>(run);
    expect(ticket.type).toBe("spec");
    expect(ticket.title).toBe("Alpha 规格");
    expect(ticket.state).toBe("open");
    expect(ticket.stateRaw).toBe("ready-for-agent");
    expect(ticket.parent).toBeNull();
    expect(ticket.blockedBy).toEqual([]);
    expect(ticket.progress?.percent).toBe(50);
    expect(ticket.comments).toBe(1);
  }, 60_000);

  it("prefers the exact --effort directory when a sibling effort name extends it", async () => {
    const repo = makeTicketRepo();

    // Key 04 lives in both "alpha" and "alpha-extra": without a filter it is ambiguous.
    const ambiguous = await runOps(SCRIPT, ["--repo", repo, "--key", "04", "--json"]);
    expect(ambiguous.code).toBe(1);
    const candidates = parseJson<FailureView>(ambiguous).candidates.map(
      (candidate) => candidate.effort + "/" + candidate.state,
    );
    expect(candidates).toEqual(["alpha/open", "alpha-extra/closed"]);

    const exact = await runOps(SCRIPT, ["--repo", repo, "--effort", "alpha", "--key", "04", "--json"]);
    expect(exact.code, "stderr: " + exact.stderr).toBe(0);
    const exactTicket = parseJson<{ ticket: TicketView }>(exact).ticket;
    expect(exactTicket.effort).toBe("alpha");
    expect(exactTicket.state).toBe("open");

    const sibling = await runOps(SCRIPT, ["--repo", repo, "--effort", "alpha-extra", "--key", "04", "--json"]);
    expect(sibling.code, "stderr: " + sibling.stderr).toBe(0);
    const siblingTicket = parseJson<{ ticket: TicketView }>(sibling).ticket;
    expect(siblingTicket.effort).toBe("alpha-extra");
    expect(siblingTicket.state).toBe("closed");
  }, 60_000);
});

describe("ticket reader: cross-effort ambiguity", () => {
  it("exits 1 and lists effort/state candidates on stderr, with no partial stdout", async () => {
    const repo = makeTicketRepo();
    const run = await runOps(SCRIPT, ["--repo", repo, "--key", "02"]);

    expect(run.code).toBe(1);
    expect(run.stdout, "an ambiguous lookup must not print a ticket").toBe("");
    const lines = run.stderr.split(/\r?\n/);
    const alphaLine = lines.find((line) => line.includes("effort=alpha"));
    const betaLine = lines.find((line) => line.includes("effort=beta"));
    expect(alphaLine, run.stderr).toContain("state=open");
    expect(betaLine, run.stderr).toContain("state=closed");
  }, 60_000);

  it("returns a structured candidates array with --json while still listing them on stderr", async () => {
    const repo = makeTicketRepo();
    const run = await runOps(SCRIPT, ["--repo", repo, "--key", "02", "--json"]);

    expect(run.code).toBe(1);
    const failure = parseJson<FailureView>(run);
    expect(failure.error).toBe("ambiguous-key");
    expect(failure.key).toBe("2");
    expect(failure.candidates.map((candidate) => candidate.effort + "/" + candidate.state)).toEqual([
      "alpha/open",
      "beta/closed",
    ]);
    for (const candidate of failure.candidates) {
      expect(normalizePath(candidate.file)).toContain("/.scratch/");
      expect(candidate.title).toBe("实施票");
      expect(candidate.type).toBe("issue");
    }
    expect(run.stderr).toMatch(/effort=alpha/);
    expect(run.stderr).toMatch(/effort=beta/);
  }, 60_000);
});

describe("ticket reader: filters and exit codes", () => {
  it("keeps --state filtering, and reports candidates when the key is filtered out", async () => {
    const repo = makeTicketRepo();

    const narrowed = await runOps(SCRIPT, ["--repo", repo, "--state", "closed", "--key", "01", "--json"]);
    expect(narrowed.code, "stderr: " + narrowed.stderr).toBe(0);
    const hit = parseJson<{ ticket: TicketView }>(narrowed).ticket;
    expect(hit.effort).toBe("alpha");
    expect(hit.state).toBe("closed");

    const filtered = await runOps(SCRIPT, [
      "--repo", repo, "--effort", "alpha", "--state", "open", "--key", "01", "--json",
    ]);
    expect(filtered.code).toBe(1);
    const failure = parseJson<FailureView>(filtered);
    expect(failure.error).toBe("filtered-out");
    expect(failure.candidates.map((candidate) => candidate.effort + "/" + candidate.state)).toEqual([
      "alpha/closed",
    ]);
    expect(filtered.stderr).toMatch(/effort=alpha/);
    expect(filtered.stderr).toMatch(/state=closed/);
  }, 60_000);

  it("exits 1 when the key exists nowhere (non-markdown neighbours are ignored)", async () => {
    const repo = makeTicketRepo();
    const run = await runOps(SCRIPT, ["--repo", repo, "--effort", "alpha", "--key", "99"]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("ticket not found: 99");
    expect(run.stdout).toBe("");
  }, 60_000);

  it("returns a structured not-found error with --json", async () => {
    const repo = makeTicketRepo();
    const run = await runOps(SCRIPT, ["--repo", repo, "--key", "99", "--json"]);

    expect(run.code).toBe(1);
    const failure = parseJson<FailureView>(run);
    expect(failure.error).toBe("not-found");
    expect(failure.key).toBe("99");
    expect(failure.candidates).toEqual([]);
  }, 60_000);

  it("exits 2 when the repo does not exist", async () => {
    const missing = join(tempDir("fh-ops-tickets-missing-"), "nope");
    const run = await runOps(SCRIPT, ["--repo", missing, "--key", "01"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("repo not found");
    expect(run.stdout).toBe("");
  }, 60_000);

  it("exits 2 when the repo has no .scratch directory", async () => {
    const empty = tempDir("fh-ops-tickets-empty-");
    const run = await runOps(SCRIPT, ["--repo", empty, "--key", "01"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("no .scratch directory");
  }, 60_000);

  it("exits 0 for --help", async () => {
    const run = await runOps(SCRIPT, ["--help"]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("Usage: node scripts/ops/tickets.mjs");
    expect(run.stderr).toBe("");
  }, 60_000);
});

describe("ticket reader: read-only contract", () => {
  it("leaves the repository byte-identical after reads, filters and failures", async () => {
    const repo = makeTicketRepo();
    const before = treeSignature(repo);

    const invocations: Array<{ args: string[]; cwd?: string; code: number }> = [
      { args: ["--repo", repo, "--json"], code: 0 },
      { args: ["--json"], cwd: repo, code: 0 },
      { args: ["--repo", repo, "--effort", "alpha", "--key", "02", "--json", "--comments", "2"], code: 0 },
      { args: ["--repo", repo, "--effort", "交付自举-示例", "--key", "03"], code: 0 },
      { args: ["--repo", repo, "--key", "02"], code: 1 },
      { args: ["--repo", repo, "--key", "99", "--json"], code: 1 },
    ];
    for (const invocation of invocations) {
      const run = await runOps(SCRIPT, invocation.args, invocation.cwd ? { cwd: invocation.cwd } : {});
      expect(run.code, invocation.args.join(" ") + "\nstderr: " + run.stderr).toBe(invocation.code);
    }

    expect(treeSignature(repo), "the reader must not write, cache or touch anything").toBe(before);
  }, 120_000);

  it("reads a Chinese effort name and Chinese content without mojibake", async () => {
    const repo = makeTicketRepo();
    const run = await runOps(SCRIPT, ["--repo", repo, "--effort", "交付自举-示例", "--key", "03", "--json"]);

    expect(run.code, "stderr: " + run.stderr).toBe(0);
    const { ticket } = parseJson<{ ticket: TicketView }>(run);
    expect(ticket.effort).toBe("交付自举-示例");
    expect(ticket.title).toBe("中文票标题");
    expect(ticket.state).toBe("open");
    expect(ticket.blockedBy).toEqual(["01", "02"]);
    expect(ticket.progress?.percent).toBe(65);
    expect(ticket.comments).toBe(2);
    expect(ticket.lastCommentAt).toBe("local — 2026-11-01T07:30:00.000Z");
    expect(ticket.body).toContain("中文评论：第一行，含逗号、顿号与破折号——都要原样保留。");
    expect(normalizePath(ticket.file)).toMatch(/\/\.scratch\/交付自举-示例\/issues\/03-中文票\.md$/);
  }, 60_000);
});
