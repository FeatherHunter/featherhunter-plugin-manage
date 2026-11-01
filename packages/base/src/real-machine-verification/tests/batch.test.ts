/**
 * Batch tests: the identity wire format, the freshness double criterion and the
 * evidence binding, all driven through the command layer with a scripted git.
 *
 * The wire format is locked here because a release comment quotes it verbatim:
 * the same test both renders and parses the two lines, so a change in either
 * direction fails before it can reach a published comment.
 */
import { describe, expect, it } from "vitest";

import type { BatchName, CommitSha, Sha256Hex } from "../contracts/branding";
import { parseArgs } from "../cli/args";
import { runBatchCommand } from "../cli/commands/batch";
import {
  formatBaseLine,
  formatIdentityLine,
  parseBaseLine,
  parseIdentityLine,
} from "../contracts/identity";
import { loadBatchContextForEvidence } from "../orchestration/batch";
import { failure, ok } from "../contracts/result";
import { joinFsPath } from "../runtime/paths";
import { captureIo } from "./support/fake-capture";
import {
  BASE_TIP,
  FIXTURE_HEAD,
  FakeBatchWorld,
  NEW_BASE_TIP,
  OTHER_HEAD,
} from "./support/fake-batch";

const COMMIT = FIXTURE_HEAD;
const SHA = "e".repeat(64);

interface CheckJson {
  readonly id: string;
  readonly title: string;
  readonly hard: boolean;
  readonly status: string;
  readonly detail: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
  readonly reason: string | null;
}

interface BatchJson {
  readonly schemaVersion: number;
  readonly command: string;
  readonly action: string | null;
  readonly ok: boolean;
  readonly exitCode?: number;
  readonly batch?: {
    readonly name: string;
    readonly dir: string;
    readonly file: string;
    readonly createdAt?: string;
    readonly reused?: boolean;
    readonly dryRun?: boolean;
    readonly status?: string;
  };
  readonly identityLine?: string;
  readonly baseLine?: string | null;
  readonly record?: Record<string, unknown>;
  readonly base?: { readonly ref: string; readonly tip: string; readonly expectedVersion: string; readonly allowOutdated: boolean } | null;
  readonly candidate?: { readonly commit: string; readonly version: string; readonly manifestSha256: string };
  readonly checks?: readonly CheckJson[];
  readonly evidence?: {
    readonly readable: boolean;
    readonly scanned: number;
    readonly bound: readonly { readonly relativePath: string }[];
    readonly rejected: readonly { readonly relativePath: string; readonly reason: string | null }[];
  };
  readonly freshness?: { readonly status: string; readonly problems: readonly { readonly code: string }[] };
  readonly allowedStale?: boolean;
  readonly error?: { readonly code: string; readonly message: string; readonly hint?: string; readonly stage: string };
  readonly notes?: readonly string[];
}

interface RunResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly json: BatchJson | null;
}

async function runBatch(world: FakeBatchWorld, argv: readonly string[]): Promise<RunResult> {
  const capture = captureIo();
  const args = parseArgs(["batch", ...argv]);
  const code = await runBatchCommand(args, {
    ports: world.ports,
    io: capture.io,
    runtime: { nodeVersion: "22.6.0" },
    loadDeclaration: async () => ok(world.declaration),
  });
  const out = capture.stdout();
  let json: BatchJson | null = null;
  if (out.trim().length > 0) {
    try {
      json = JSON.parse(out) as BatchJson;
    } catch {
      json = null;
    }
  }
  return { code, out, err: capture.stderr(), json };
}

function expectOneJson(result: RunResult): BatchJson {
  expect(result.out.trim().length).toBeGreaterThan(0);
  expect(result.out.trim().split("\n")).toHaveLength(1);
  expect(result.json).not.toBeNull();
  return result.json as BatchJson;
}

function checkById(json: BatchJson, id: string): CheckJson {
  const check = (json.checks ?? []).find((entry) => entry.id === id);
  expect(check, `missing check ${id}`).toBeDefined();
  return check as CheckJson;
}

function recordOf(world: FakeBatchWorld, name: string): Record<string, unknown> {
  return world.fs.readJsonSync(world.batchFile(name)) as Record<string, unknown>;
}

function identityLineFor(name: string, world: FakeBatchWorld): string {
  return `- 验证身份：批次 ${name}；候选提交 ${world.candidate.commit}；候选包 sha256 ${world.candidate.sha256}`;
}

function baseLineFor(ref: string, tip: string, version: string): string {
  return `- 验证基线：本地 ${ref} ${tip}；目标版本 ${version}`;
}

/* ------------------------------------------------------------------ format */

describe("batch identity wire format", () => {
  it("round-trips the identity line in both directions", () => {
    const binding = {
      batchName: "batch-20261101" as BatchName,
      commit: COMMIT as CommitSha,
      packageSha256: SHA as Sha256Hex,
    };
    const formatted = formatIdentityLine(binding);
    expect(formatted.ok).toBe(true);
    const line = formatted.ok ? formatted.value : "";
    expect(line).toBe(`- 验证身份：批次 batch-20261101；候选提交 ${COMMIT}；候选包 sha256 ${SHA}`);

    const parsed = parseIdentityLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(binding);

    const again = formatIdentityLine(parsed.ok ? parsed.value : binding);
    expect(again.ok && again.value).toBe(line);
  });

  it("round-trips the base line in both directions", () => {
    const base = { ref: "main", tip: BASE_TIP as CommitSha, expectedVersion: "1.2.3" };
    const formatted = formatBaseLine(base);
    expect(formatted.ok).toBe(true);
    const line = formatted.ok ? formatted.value : "";
    expect(line).toBe(`- 验证基线：本地 main ${BASE_TIP}；目标版本 1.2.3`);

    const parsed = parseBaseLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(base);
    const again = formatBaseLine(parsed.ok ? parsed.value : base);
    expect(again.ok && again.value).toBe(line);
  });

  it("rejects malformed identity lines with an expected-format hint", () => {
    const bad = [
      `- 验证身份：批次 b；候选提交 ${COMMIT.toUpperCase()}；候选包 sha256 ${SHA}`,
      `- 验证身份：批次 b；候选提交 ${COMMIT.slice(0, 39)}；候选包 sha256 ${SHA}`,
      `- 验证身份：批次 b；候选提交 ${COMMIT}；候选包 sha256 ${SHA.slice(0, 63)}`,
      `- 验证身份：批次 b；候选提交 ${COMMIT}；`,
      `- 验证身份：批次  b；候选提交 ${COMMIT}；候选包 sha256 ${SHA}`,
      `- 验证身份：批次 b；候选提交 ${COMMIT}；候选包 sha256 ${SHA}；多余字段 x`,
    ];
    for (const line of bad) {
      const parsed = parseIdentityLine(line);
      expect(parsed.ok, line).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("identity-mismatch");
        expect(parsed.error.hint ?? "").toContain("验证身份");
      }
    }
  });

  it("rejects malformed base lines with an expected-format hint", () => {
    const bad = [
      `- 验证基线：本地 main ${BASE_TIP.toUpperCase()}；目标版本 1.2.3`,
      `- 验证基线：本地 main ${BASE_TIP}；`,
      `- 验证基线：本地 main ${BASE_TIP}；目标版本`,
      `- 验证基线：本地 main ${BASE_TIP}；目标版本 1.2.3；额外 x`,
      `- 验证基线：本地 ${BASE_TIP}；目标版本 1.2.3`,
    ];
    for (const line of bad) {
      const parsed = parseBaseLine(line);
      expect(parsed.ok, line).toBe(false);
      if (!parsed.ok) expect(parsed.error.hint ?? "").toContain("验证基线");
    }
  });
});

/* -------------------------------------------------------------------- open */

describe("dsh-verify batch open", () => {
  it("records the batch and prints the two lines verbatim", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    expect(result.code).toBe(0);
    const lines = result.out.trim().split("\n");
    expect(lines[0] ?? "").toMatch(/^ok batch-open /);
    expect(lines[1]).toBe(identityLineFor("batch-a", world));
    expect(lines[2]).toBe(baseLineFor("main", BASE_TIP, "1.2.3"));

    const record = recordOf(world, "batch-a");
    expect(record.schemaVersion).toBe(1);
    expect(record.batchName).toBe("batch-a");
    expect(record.startHead).toBe(FIXTURE_HEAD);
    expect(record.status).toBe("active");
    expect(record.identityLine).toBe(identityLineFor("batch-a", world));
    expect(record.baseLine).toBe(baseLineFor("main", BASE_TIP, "1.2.3"));
    const base = record.base as Record<string, unknown>;
    expect(base.ref).toBe("main");
    expect(base.tip).toBe(BASE_TIP);
    expect(base.expectedVersion).toBe("1.2.3");
    expect(base.allowOutdated).toBe(false);
    const candidate = record.candidate as Record<string, unknown>;
    expect(candidate.commit).toBe(FIXTURE_HEAD);
    expect(candidate.sha256).toBe(world.candidate.sha256);
    expect(candidate.version).toBe("1.2.3");
  });

  it("emits a single JSON document that carries both lines", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main", "--json"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    expect(json.action).toBe("open");
    expect(json.ok).toBe(true);
    expect(json.identityLine).toBe(identityLineFor("batch-a", world));
    expect(json.baseLine).toBe(baseLineFor("main", BASE_TIP, "1.2.3"));
    expect(json.batch?.name).toBe("batch-a");
    expect(json.candidate?.commit).toBe(FIXTURE_HEAD);
    expect(json.candidate?.manifestSha256).toBe(world.candidate.sha256);
    expect(json.base?.tip).toBe(BASE_TIP);
    expect(result.err).toBe("");
  });

  it("records the explicit no-baseline state instead of skipping the check", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, ["open", "--name", "batch-nb", "--json"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    expect(json.base).toBeNull();
    expect(json.baseLine).toBeNull();
    const record = recordOf(world, "batch-nb");
    expect(record.base).toBeNull();
    expect(record.baseLine).toBeNull();

    const human = await runBatch(world, ["open", "--name", "batch-nb"]);
    expect(human.code).toBe(0);
    expect(human.out).toContain("无（本批次未记录基线");
  });

  it("is idempotent for the same identity and leaves the record untouched", async () => {
    const world = new FakeBatchWorld();
    const first = await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main", "--json"]);
    expect(first.code).toBe(0);
    const createdAt = first.json?.batch?.createdAt;
    const before = recordOf(world, "batch-a");

    world.advanceClock(60_000);
    const second = await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main", "--json"]);
    expect(second.code).toBe(0);
    const json = expectOneJson(second);
    expect(json.batch?.reused).toBe(true);
    expect(json.batch?.createdAt).toBe(createdAt);
    expect(recordOf(world, "batch-a")).toEqual(before);
    expect(json.notes?.some((note) => note.includes("reused"))).toBe(true);
  });

  it("refuses to rewrite an existing batch with a different candidate", async () => {
    const world = new FakeBatchWorld();
    const first = await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    expect(first.code).toBe(0);
    const before = recordOf(world, "batch-a");

    world.seedCandidate({ dirName: "cand-2", generatedAt: "2026-11-01T21:30:00.000Z" });
    const second = await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main", "--json"]);
    expect(second.code).toBe(1);
    const json = expectOneJson(second);
    expect(json.error?.code).toBe("conflict");
    expect(json.error?.stage).toBe("conflict");
    expect(recordOf(world, "batch-a")).toEqual(before);
  });

  it("uses the newest candidate under the work root by default", async () => {
    const world = new FakeBatchWorld();
    const newer = world.seedCandidate({ dirName: "cand-2", generatedAt: "2026-11-01T22:00:00.000Z" });
    expect(newer.sha256).not.toBe(world.candidate.sha256);
    const result = await runBatch(world, ["open", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(0);
    const record = recordOf(world, "batch-a");
    expect((record.candidate as Record<string, unknown>).sha256).toBe(newer.sha256);
  });

  it("honours an explicit --candidate directory", async () => {
    const world = new FakeBatchWorld();
    world.seedCandidate({ dirName: "cand-2", generatedAt: "2026-11-01T22:00:00.000Z" });
    const result = await runBatch(world, ["open", "--name", "batch-a", "--candidate", world.candidate.dir, "--json"]);
    expect(result.code).toBe(0);
    const record = recordOf(world, "batch-a");
    expect((record.candidate as Record<string, unknown>).sha256).toBe(world.candidate.sha256);
  });

  it("rejects a candidate frozen from another commit", async () => {
    const world = new FakeBatchWorld({ candidateCommit: OTHER_HEAD });
    const result = await runBatch(world, ["open", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.error?.code).toBe("identity-mismatch");
    expect(json.error?.hint ?? "").toContain("freeze");
    expect(await world.fs.exists(world.batchFile("batch-a"))).toBe(false);
  });

  it("rejects a candidate for another package version", async () => {
    const world = new FakeBatchWorld({ candidateVersion: "9.9.9" });
    const result = await runBatch(world, ["open", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.error?.code).toBe("identity-mismatch");
    expect(json.error?.message).toContain("9.9.9");
  });

  it("blocks when there is no candidate to open on", async () => {
    const world = new FakeBatchWorld();
    await world.fs.remove(joinFsPath(world.workRoot, "candidates"), { recursive: true });
    const result = await runBatch(world, ["open", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.error?.code).toBe("not-found");
    expect(json.error?.hint ?? "").toContain("freeze");
  });

  it("blocks when git HEAD cannot be read", async () => {
    const world = new FakeBatchWorld({ headFailure: true });
    const result = await runBatch(world, ["open", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.error?.code).toBe("prerequisite");
    expect(json.error?.stage).toBe("context");
  });

  it("blocks with exit 2 when the declaration does not load", async () => {
    const world = new FakeBatchWorld();
    const capture = captureIo();
    const code = await runBatchCommand(parseArgs(["batch", "open", "--name", "batch-a", "--json"]), {
      ports: world.ports,
      io: capture.io,
      runtime: { nodeVersion: "22.6.0" },
      loadDeclaration: async () => ({
        ok: false,
        error: {
          kind: "blocked",
          code: "prerequisite",
          message: "no verification declaration found",
          hint: "add verify/profile.ts to the plugin root",
        },
      }),
    });
    expect(code).toBe(2);
    const json = JSON.parse(capture.stdout()) as BatchJson;
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("declaration");
    expect(json.error?.code).toBe("prerequisite");
  });

  it("writes nothing on --dry-run", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main", "--dry-run", "--json"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    expect(json.batch?.dryRun).toBe(true);
    expect(await world.fs.exists(world.batchFile("batch-a"))).toBe(false);
    expect(json.identityLine).toBe(identityLineFor("batch-a", world));
  });

  it("records an explicitly allowed outdated baseline without pretending it is active", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, [
      "open",
      "--name",
      "batch-stale",
      "--base-ref",
      "main",
      "--allow-stale",
      "--json",
    ]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    expect(json.base?.allowOutdated).toBe(true);
    const record = recordOf(world, "batch-stale");
    expect(record.status).toBe("stale");
  });
});

/* ------------------------------------------------------------------ status */

describe("dsh-verify batch status freshness", () => {
  it("passes when HEAD and the baseline both still match", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    expect(json.ok).toBe(true);
    expect(json.exitCode).toBe(0);
    expect(checkById(json, "batch-head-fresh").status).toBe("pass");
    expect(checkById(json, "batch-baseline-fresh").status).toBe("pass");
    expect(checkById(json, "batch-evidence-bound").status).toBe("skip");
    expect(json.identityLine).toBe(identityLineFor("batch-a", world));
    expect(json.baseLine).toBe(baseLineFor("main", BASE_TIP, "1.2.3"));
    expect(recordOf(world, "batch-a").status).toBe("active");
  });

  it("fails and names both commits when HEAD moved", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.head = OTHER_HEAD;
    const result = await runBatch(world, ["status", "--name", "batch-a"]);
    expect(result.code).toBe(1);
    const failLine = result.out.split("\n").find((line) => line.startsWith("fail batch-head-fresh")) ?? "";
    expect(failLine).toContain(FIXTURE_HEAD);
    expect(failLine).toContain(OTHER_HEAD);
    expect(failLine).toContain("expected:");
    expect(failLine).toContain("actual:");

    const json = (await runBatch(world, ["status", "--name", "batch-a", "--json"])).json as BatchJson;
    const check = checkById(json, "batch-head-fresh");
    expect(check.reason).toBe("head-moved");
    expect(check.expected).toBe(FIXTURE_HEAD);
    expect(check.actual).toBe(OTHER_HEAD);
    const record = recordOf(world, "batch-a");
    expect(record.status).toBe("stale");
    expect(record.endHead).toBe(OTHER_HEAD);
  });

  it("fails when the baseline ref advanced", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.baseTip = NEW_BASE_TIP;
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    const check = checkById(json, "batch-baseline-fresh");
    expect(check.status).toBe("fail");
    expect(check.reason).toBe("baseline-advanced");
    expect(check.detail).toContain("advanced");
    expect(check.expected).toBe(BASE_TIP);
    expect(check.actual).toBe(NEW_BASE_TIP);
  });

  it("treats a deleted baseline ref as unreadable, not as unchanged", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.baseTip = null;
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    const check = checkById(json, "batch-baseline-fresh");
    expect(check.status).toBe("fail");
    expect(check.reason).toBe("baseline-unreadable");
    expect(check.detail).toContain("could not read baseline");
  });

  it("does not let --allow-stale excuse an unreadable baseline", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.baseTip = null;
    const result = await runBatch(world, ["status", "--name", "batch-a", "--allow-stale", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(checkById(json, "batch-baseline-fresh").status).toBe("fail");
    expect(json.allowedStale).toBe(true);
  });

  it("reports a moved HEAD as skip, with the flag named, under --allow-stale", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.head = OTHER_HEAD;
    const result = await runBatch(world, ["status", "--name", "batch-a", "--allow-stale", "--json"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    const check = checkById(json, "batch-head-fresh");
    expect(check.status).toBe("skip");
    expect(check.detail).toContain("--allow-stale");
    expect(json.allowedStale).toBe(true);
    expect(json.notes?.some((note) => note.includes("--allow-stale"))).toBe(true);
    expect(recordOf(world, "batch-a").status).toBe("stale");
  });

  it("reports an outdated baseline that was allowed when the batch opened", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main", "--allow-stale"]);
    world.baseTip = NEW_BASE_TIP;
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    const check = checkById(json, "batch-baseline-fresh");
    expect(check.status).toBe("skip");
    expect(check.reason).toBe("outdated-base-allowed");
    expect(check.detail).toContain("outdated");
  });

  it("keeps the explicit no-baseline state blocked, never skipped", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-nb"]);
    const result = await runBatch(world, ["status", "--name", "batch-nb", "--json"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    const check = checkById(json, "batch-baseline-fresh");
    expect(check.status).toBe("blocked");
    expect(check.reason).toBe("no-baseline");
    expect(check.detail).toContain("explicit \"no baseline\"");
    expect(recordOf(world, "batch-nb").status).toBe("stale");
  });

  it("judges the newest batch record when --name is omitted", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.advanceClock(60_000);
    await runBatch(world, ["open", "--name", "batch-b", "--base-ref", "main"]);
    const result = await runBatch(world, ["status", "--json"]);
    expect(result.code).toBe(0);
    expect(expectOneJson(result).batch?.name).toBe("batch-b");
  });

  it("blocks when the named batch has no record", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, ["status", "--name", "nope", "--json"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.error?.code).toBe("not-found");
    expect(json.error?.stage).toBe("record");
  });

  it("blocks when there is no batch at all", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, ["status", "--json"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.error?.hint ?? "").toContain("batch open");
  });

  it("does not rewrite the record on --dry-run", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    const before = recordOf(world, "batch-a");
    world.advanceClock(60_000);
    world.head = OTHER_HEAD;
    const result = await runBatch(world, ["status", "--name", "batch-a", "--dry-run"]);
    expect(result.code).toBe(1);
    expect(recordOf(world, "batch-a")).toEqual(before);
  });
});

/* ---------------------------------------------------------------- evidence */

describe("evidence binding", () => {
  it("counts evidence that carries this batch's candidate triple", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.seedEvidence("batch-a", "evidence", {
      candidate: { commit: world.candidate.commit, packageSha256: world.candidate.sha256 },
    });
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    expect(checkById(json, "batch-evidence-bound").status).toBe("pass");
    expect(json.evidence?.scanned).toBe(1);
    expect(json.evidence?.bound).toHaveLength(1);
  });

  it("rejects a foreign evidence manifest and names the path and the mismatched item", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.seedEvidence("batch-a", "evidence", {
      candidate: { commit: world.candidate.commit, packageSha256: world.candidate.sha256 },
    });
    world.seedEvidence("batch-a", "evidence-foreign", {
      candidate: { commit: OTHER_HEAD, packageSha256: world.candidate.sha256 },
    });
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    const check = checkById(json, "batch-evidence-bound");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("evidence-foreign/evidence.json");
    expect(check.detail).toContain("candidate-commit");
    expect(json.evidence?.scanned).toBe(2);
    expect(json.evidence?.bound).toHaveLength(1);
    const rejected = json.evidence?.rejected[0];
    expect(rejected?.relativePath).toBe("evidence-foreign/evidence.json");
    expect(rejected?.reason).toBe("candidate-commit");
    expect(check.expected).toContain(world.candidate.commit);
    expect(check.actual).toContain(OTHER_HEAD);
  });

  it("rejects evidence whose candidate manifest sha256 does not match", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    const otherSha = "f".repeat(64);
    world.seedEvidence("batch-a", "evidence-sha", {
      candidate: { commit: world.candidate.commit, packageSha256: otherSha },
    });
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    const check = checkById(json, "batch-evidence-bound");
    expect(check.status).toBe("fail");
    expect(check.actual).toContain(otherSha);
    expect(json.evidence?.rejected[0]?.reason).toBe("candidate-package-sha256");
    expect(json.evidence?.rejected[0]?.relativePath).toBe("evidence-sha/evidence.json");
  });

  it("rejects evidence for another batch name", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.seedEvidence("batch-a", "evidence", {
      batchName: "batch-b",
      candidate: { commit: world.candidate.commit, packageSha256: world.candidate.sha256 },
    });
    const result = await runBatch(world, ["status", "--name", "batch-a"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("batch-name");
  });

  it("rejects evidence without a candidate object", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.seedEvidence("batch-a", "evidence");
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.evidence?.rejected[0]?.reason).toBe("candidate-missing");
  });

  it("rejects a broken evidence manifest instead of counting it", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    world.fs.seedFile(joinFsPath(world.batchDir("batch-a"), "evidence", "evidence.json"), "{ not json");
    const result = await runBatch(world, ["status", "--name", "batch-a", "--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.evidence?.rejected[0]?.reason).toBe("manifest-invalid");
  });
});

/* ------------------------------------------------------------------- usage */

describe("batch usage", () => {
  it("rejects an unknown flag with exit 2 and the usage text", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, ["open", "--candidate-dir", "x"]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("dsh-verify batch");
    expect(result.err).toContain("--name");
  });

  it("rejects a missing or unknown subcommand", async () => {
    const world = new FakeBatchWorld();
    const missing = await runBatch(world, []);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("missing subcommand");
    const unknown = await runBatch(world, ["bogus"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("unknown subcommand");
  });

  it("emits one usage JSON document when --json was requested", async () => {
    const world = new FakeBatchWorld();
    const result = await runBatch(world, ["status", "--nope", "--json"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("usage");
    expect(json.error?.hint ?? "").toContain("dsh-verify batch");
  });
});

/* ------------------------------------------------------- evidence context */

describe("loadBatchContextForEvidence", () => {
  it("returns null when no batch was named", async () => {
    const world = new FakeBatchWorld();
    const context = await loadBatchContextForEvidence({}, { ports: world.ports, cwd: world.cwd });
    expect(context.ok).toBe(true);
    if (context.ok) expect(context.value).toBeNull();
  });

  it("returns the identity triple of an opened batch", async () => {
    const world = new FakeBatchWorld();
    await runBatch(world, ["open", "--name", "batch-a", "--base-ref", "main"]);
    const context = await loadBatchContextForEvidence({ batch: "batch-a" }, { ports: world.ports, cwd: world.cwd });
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.value).not.toBeNull();
    expect(context.value?.batchName).toBe("batch-a");
    expect(context.value?.batchDir).toBe(world.batchDir("batch-a"));
    expect(context.value?.candidate.commit).toBe(world.candidate.commit);
    expect(context.value?.candidate.packageSha256).toBe(world.candidate.sha256);
    expect(context.value?.candidate.version).toBe("1.2.3");
  });

  it("blocks for a batch that has no record", async () => {
    const world = new FakeBatchWorld();
    const context = await loadBatchContextForEvidence({ batch: "nope" }, { ports: world.ports, cwd: world.cwd });
    expect(context.ok).toBe(false);
    if (!context.ok) {
      expect(context.error.blocked).toBe(true);
      expect(context.error.code).toBe("not-found");
    }
  });
});
