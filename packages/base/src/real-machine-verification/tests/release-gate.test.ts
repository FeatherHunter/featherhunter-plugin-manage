/**
 * The release gate, tested through its library API.
 *
 * Every test drives runReleaseGate with a fake ticket face and fake ports, so
 * the six rules are exercised as a caller sees them: no git, no network, no
 * real ticket tracker. The candidate fixture is a complete CandidateManifest
 * because a batch summary is deliberately not enough for this gate.
 */
import { describe, expect, it } from "vitest";

import { parseCandidateManifest, type CandidateManifest } from "../contracts/candidate-rules";
import { formatIdentityLine, parseIdentityLine } from "../contracts/identity";
import { formatAuditLine, parseAuditLine, type ReleaseGateReport } from "../contracts/release-gate";
import type { ChecklistIssue, TicketComment, TicketFaceAdapter } from "../contracts/ticket-face";
import { RELEASE_GATE_CHECK_IDS, runReleaseGate, type ReleaseGateOptions } from "../orchestration/release-gate/run";
import { fakeTicketFace } from "./support/fake-ticket-face";
import { makePorts } from "./support/fake-ports";

const LF = String.fromCharCode(10);
const CANDIDATE = "a".repeat(40);
const RELEASE = "b".repeat(40);
const OTHER = "c".repeat(40);
const TGZ = "d".repeat(64);
const FILE_DIGEST = "e".repeat(64);
const MANIFEST_DIGEST = "f".repeat(64);
const VERSION = "1.2.3";

function releaseCandidate(
  overrides: {
    readonly commit?: string;
    readonly version?: string;
    readonly validity?: "release" | "development";
    readonly sourceStable?: boolean;
    readonly tgzSha256?: string;
  } = {},
): CandidateManifest {
  const parsed = parseCandidateManifest({
    schemaVersion: 2,
    generatedAt: "2026-01-02T03:04:05.000Z",
    tool: "fake-freeze@0.1.5",
    version: overrides.version ?? VERSION,
    validity: overrides.validity ?? "release",
    sourceStable: overrides.sourceStable ?? true,
    git: {
      commit: overrides.commit ?? CANDIDATE,
      branch: "main",
      dirty: false,
      dirtyFiles: [],
    },
    package: {
      tgzPath: "C:/repo/candidates/plugin-1.2.3.tgz",
      tgzBytes: 2048,
      tgzSha256: overrides.tgzSha256 ?? TGZ,
      filename: "plugin-1.2.3.tgz",
      files: [{ path: "package.json", bytes: 120, sha256: FILE_DIGEST }],
      fileCount: 1,
      fileDigest: FILE_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
    },
  });
  if (!parsed.ok) throw new Error("candidate fixture is invalid: " + parsed.error.message);
  return parsed.value;
}

function identityLine(batch = "batch-1", commit = CANDIDATE, sha = TGZ): string {
  return "- 验证身份：批次 " + batch + "；候选提交 " + commit + "；候选包 sha256 " + sha;
}

function checklistBody(options: { readonly status?: string; readonly audit?: string } = {}): string {
  const lines = [
    "# 真机验证清单 1.2.3",
    "",
    "## 场景总览",
    "| 场景编号 | 来源票 | 一句话 | 状态 | 备注 |",
    "| --- | --- | --- | --- | --- |",
    "| 1600-01 | #16 | release gate | " + (options.status ?? "通过") + " | |",
  ];
  if (options.audit !== undefined) {
    lines.push("", "## 候选与发布差异审计", options.audit);
  }
  return lines.join(LF);
}

function checklistIssue(
  overrides: Partial<ChecklistIssue> & { readonly body?: string } = {},
): ChecklistIssue {
  return {
    number: overrides.number ?? 12,
    title: overrides.title ?? "[真机验证] 1.2.3",
    state: overrides.state ?? "CLOSED",
    body: overrides.body ?? checklistBody(),
    ...(overrides.url === undefined ? {} : { url: overrides.url }),
  };
}

function batchComment(
  options: {
    readonly batch?: string;
    readonly commit?: string;
    readonly sha?: string;
    readonly result?: string;
    readonly identity?: boolean;
    readonly passed?: number;
    readonly failed?: number;
  } = {},
): TicketComment {
  const result = options.result ?? "通过";
  const passed = options.passed ?? (result === "通过" ? 1 : 0);
  const failed = options.failed ?? (result === "失败" ? 1 : 0);
  const lines = ["批次开始"];
  if (options.identity !== false) {
    lines.push(identityLine(options.batch ?? "batch-1", options.commit ?? CANDIDATE, options.sha ?? TGZ));
  }
  lines.push("场景 1600-01：" + result);
  lines.push("[发布就绪] 通过 " + String(passed) + " / 失败 " + String(failed) + " / 豁免 0");
  return { body: lines.join(LF) };
}

async function runGate(
  adapter: TicketFaceAdapter | false | undefined,
  overrides: Partial<ReleaseGateOptions> = {},
): Promise<ReleaseGateReport> {
  const options: ReleaseGateOptions = {
    ports: makePorts(),
    candidate: releaseCandidate(),
    releaseCommit: RELEASE,
    releaseVersion: VERSION,
    ...(adapter === undefined ? {} : { ticketFace: adapter }),
    ...overrides,
  };
  const result = await runReleaseGate(options);
  if (!result.ok) throw new Error("gate rejected its input: " + result.error.message);
  return result.value;
}

function statusOf(report: ReleaseGateReport, id: string): string {
  const check = report.checks.find((item) => String(item.id) === id);
  if (check === undefined) throw new Error("report has no check " + id);
  return check.status;
}

function hasFinding(report: ReleaseGateReport, code: string): boolean {
  return report.findings.some((finding) => finding.code === code);
}

function happyFace(overrides: Parameters<typeof fakeTicketFace>[0] = {}): TicketFaceAdapter {
  return fakeTicketFace({
    issues: [checklistIssue()],
    comments: [batchComment()],
    releaseCommit: RELEASE,
    ...overrides,
  });
}

describe("runReleaseGate", () => {
  it("passes all six checks on a complete checklist and a frozen release candidate", async () => {
    const report = await runGate(happyFace());

    expect(report.decision).toBe("pass");
    expect(report.exitCode).toBe(0);
    expect(report.version).toBe(VERSION);
    expect(report.releaseCommit).toBe(RELEASE);
    for (const id of RELEASE_GATE_CHECK_IDS) expect(statusOf(report, id)).toBe("pass");
    // The id order is part of the report contract, not an implementation detail.
    expect(report.checks.map((check) => String(check.id))).toEqual([...RELEASE_GATE_CHECK_IDS]);
    expect(report.ticket.number).toBe(12);
    expect(report.ticket.exactCount).toBe(1);
    expect(report.ticket.latestBatch).toBe("batch-1");
    expect(report.candidate?.commit).toBe(CANDIDATE);
    expect(report.audit.required).toBe(false);
    expect(report.audit.covered).toBe(true);
    expect(report.records.identities).toHaveLength(1);
  });

  it("blocks every ticket-dependent check when no adapter is supplied, and never passes silently", async () => {
    const report = await runGate(undefined);

    expect(report.decision).toBe("blocked");
    expect(report.exitCode).toBe(2);
    for (const id of ["release-checklist-unique", "release-checklist-closed", "release-checklist-consistency", "release-batch-identity", "release-ancestor-audit"]) {
      expect(statusOf(report, id)).toBe("blocked");
    }
    // The candidate is still judgeable without a tracker, so it is not blocked.
    expect(statusOf(report, "release-candidate-valid")).toBe("pass");
    expect(report.ticket.number).toBeNull();
    expect(report.blocked[0]?.code).toBe("adapter-missing");
    const hint = report.blocked[0]?.hint ?? "";
    expect(hint).toContain("1. add to verify/profile.ts");
    expect(hint).toContain("2. the module must export");
    expect(hint).toContain("3. GitHub/GitLab adapters");
    expect(hint).toContain('true, false or "unknown"');
    expect(hint).toContain("without an adapter, release checks report blocked (exit 2), never fail.");
  });

  it("blocks when the adapter throws instead of reporting a green release", async () => {
    const report = await runGate(fakeTicketFace({ throws: "issues" }));

    expect(report.decision).toBe("blocked");
    expect(statusOf(report, "release-checklist-unique")).toBe("blocked");
    expect(report.blocked[0]?.code).toBe("adapter-missing");
    expect(report.blocked[0]?.message).toContain("threw while listing issues");
  });

  it("fails release-checklist-unique when two tickets carry the version title", async () => {
    const report = await runGate(happyFace({ issues: [checklistIssue(), checklistIssue({ number: 13 })] }));

    expect(statusOf(report, "release-checklist-unique")).toBe("fail");
    expect(hasFinding(report, "checklist-duplicate")).toBe(true);
    expect(report.ticket.exactCount).toBe(2);
    expect(report.exitCode).toBe(1);
  });

  it("fails release-checklist-unique when the version has no checklist ticket", async () => {
    const report = await runGate(happyFace({ issues: [] }));

    expect(statusOf(report, "release-checklist-unique")).toBe("fail");
    expect(hasFinding(report, "checklist-missing")).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("ignores the placeholder ticket when exactly one version ticket exists", async () => {
    const placeholder: ChecklistIssue = {
      number: 99,
      title: "[真机验证] 下一版",
      state: "OPEN",
      body: "placeholder",
    };
    const report = await runGate(happyFace({ issues: [checklistIssue(), placeholder] }));

    expect(statusOf(report, "release-checklist-unique")).toBe("pass");
    expect(report.ticket.exactCount).toBe(1);
    expect(report.notes.join(" ")).toContain("ignored 1 placeholder ticket(s): #99");
  });

  it("blocks release-checklist-unique when the pinned ticket is not returned by the adapter", async () => {
    const report = await runGate(happyFace(), { checklistTicket: 99 });

    expect(statusOf(report, "release-checklist-unique")).toBe("blocked");
    expect(report.decision).toBe("blocked");
  });

  it("fails release-checklist-closed while the checklist ticket is still open", async () => {
    const report = await runGate(happyFace({ issues: [checklistIssue({ state: "OPEN" })] }));

    expect(statusOf(report, "release-checklist-closed")).toBe("fail");
    expect(hasFinding(report, "checklist-not-closed")).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("fails release-checklist-consistency when a comment conclusion contradicts the overview row", async () => {
    const report = await runGate(happyFace({ comments: [batchComment({ result: "失败" })] }));

    expect(statusOf(report, "release-checklist-consistency")).toBe("fail");
    expect(hasFinding(report, "checklist-inconsistent")).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("fails release-batch-identity when a batch comment has no identity line", async () => {
    const report = await runGate(happyFace({ comments: [batchComment({ identity: false })] }));

    expect(statusOf(report, "release-batch-identity")).toBe("fail");
    expect(hasFinding(report, "identity-missing")).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("fails release-batch-identity when the identity names another commit than the candidate", async () => {
    const report = await runGate(happyFace({ comments: [batchComment({ commit: OTHER })] }));

    expect(statusOf(report, "release-batch-identity")).toBe("fail");
    expect(hasFinding(report, "identity-not-in-candidate")).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("fails release-batch-identity when one batch records two different identities", async () => {
    const report = await runGate(
      happyFace({ comments: [batchComment(), batchComment({ commit: OTHER })] }),
    );

    expect(statusOf(report, "release-batch-identity")).toBe("fail");
    expect(hasFinding(report, "identity-conflict")).toBe(true);
  });

  it("fails release-ancestor-audit when the candidate is not an ancestor and no audit line covers it", async () => {
    const report = await runGate(happyFace({ ancestry: false }));

    expect(statusOf(report, "release-ancestor-audit")).toBe("fail");
    expect(hasFinding(report, "commit-not-ancestor")).toBe(true);
    expect(hasFinding(report, "audit-missing")).toBe(true);
    expect(report.audit.required).toBe(true);
    expect(report.audit.covered).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  it("passes and records the audit line when the candidate is not an ancestor but the ticket audits the difference", async () => {
    const audit = formatAuditLine({
      candidateCommit: CANDIDATE,
      releaseCommit: RELEASE,
      reason: "release branch merged the candidate after the freeze",
    });
    const report = await runGate(happyFace({ ancestry: false, issues: [checklistIssue({ body: checklistBody({ audit }) })] }));

    expect(statusOf(report, "release-ancestor-audit")).toBe("pass");
    expect(report.audit.required).toBe(true);
    expect(report.audit.covered).toBe(true);
    expect(report.audit.line).toBe(audit);
    expect(report.records.auditLine).toBe(audit);
    expect(hasFinding(report, "audit-missing")).toBe(false);
    expect(report.decision).toBe("pass");
    expect(report.exitCode).toBe(0);
  });

  it("skips the audit check when the candidate is the release commit", async () => {
    // Nothing to compare, so "covered" is true: the requirement is vacuous,
    // not an unproven audit.
    const report = await runGate(happyFace({ comments: [batchComment({ commit: RELEASE })] }), {
      candidate: releaseCandidate({ commit: RELEASE }),
    });

    expect(statusOf(report, "release-ancestor-audit")).toBe("skip");
    expect(report.audit.required).toBe(false);
    expect(report.audit.covered).toBe(true);
    expect(report.audit.line).toBeNull();
    expect(report.exitCode).toBe(0);
  });

  it("blocks release-ancestor-audit when Git cannot answer, instead of treating unknown as not-an-ancestor", async () => {
    const report = await runGate(happyFace({ ancestry: "unknown" }));

    expect(statusOf(report, "release-ancestor-audit")).toBe("blocked");
    expect(report.decision).toBe("blocked");
    expect(report.exitCode).toBe(2);
    expect(hasFinding(report, "commit-not-ancestor")).toBe(false);
    expect(hasFinding(report, "audit-missing")).toBe(false);
    const check = report.checks.find((item) => String(item.id) === "release-ancestor-audit");
    expect(check?.hint).toContain('must return "unknown" (not false)');
  });

  it("fails release-candidate-valid for a development candidate", async () => {
    const report = await runGate(happyFace(), { candidate: releaseCandidate({ validity: "development" }) });

    expect(statusOf(report, "release-candidate-valid")).toBe("fail");
    expect(hasFinding(report, "candidate-not-release")).toBe(true);
    expect(report.decision).toBe("fail");
    expect(report.exitCode).toBe(1);
  });

  it("returns exit 1 when a failing candidate and blocked ticket checks happen together", async () => {
    // A hard failure outranks blocked: a known-bad candidate must not look like
    // missing infrastructure (check.ts decideExitCode: fail first, then blocked).
    const report = await runGate(undefined, { candidate: releaseCandidate({ validity: "development" }) });

    expect(statusOf(report, "release-checklist-unique")).toBe("blocked");
    expect(statusOf(report, "release-candidate-valid")).toBe("fail");
    expect(report.decision).toBe("fail");
    expect(report.exitCode).toBe(1);
  });

  it("blocks release-candidate-valid when no candidate was supplied", async () => {
    const report = await runGate(happyFace(), { candidate: null });

    expect(statusOf(report, "release-candidate-valid")).toBe("blocked");
    expect(report.candidate).toBeNull();
    expect(report.exitCode).toBe(2);
  });

  it("fails release-candidate-valid when the path requires a candidate but none was supplied", async () => {
    const report = await runGate(happyFace(), { candidate: null, requireCandidate: true });

    expect(statusOf(report, "release-candidate-valid")).toBe("fail");
    expect(hasFinding(report, "candidate-not-registered")).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("rejects an incomplete candidate manifest at the input stage", async () => {
    const summary = { version: VERSION, git: { commit: CANDIDATE }, package: { tgzSha256: TGZ } };
    const result = await runReleaseGate({
      ports: makePorts(),
      candidate: summary as unknown as CandidateManifest,
      releaseCommit: RELEASE,
      releaseVersion: VERSION,
      ticketFace: happyFace(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe("input");
    expect(result.error.hint).toContain("batch-summary JSON");
  });

  it("rejects a malformed audit line supplied as an option", async () => {
    const result = await runReleaseGate({
      ports: makePorts(),
      candidate: releaseCandidate(),
      releaseCommit: RELEASE,
      releaseVersion: VERSION,
      ticketFace: happyFace({ ancestry: false }),
      auditLines: ["- not an audit line"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("wire format");
  });
});

describe("audit line wire format", () => {
  it("round-trips the formatted line and accepts both arrows and both colons", () => {
    const parsed = parseAuditLine("  - 候选提交 " + CANDIDATE + " -> 发布提交 " + RELEASE + ":  rebased onto the candidate  ");
    expect(parsed).toEqual({
      candidateCommit: CANDIDATE,
      releaseCommit: RELEASE,
      reason: "rebased onto the candidate",
    });

    const formatted = formatAuditLine(parsed as NonNullable<typeof parsed>);
    expect(formatted).toBe("- 候选提交 " + CANDIDATE + " → 发布提交 " + RELEASE + "：rebased onto the candidate");
    expect(parseAuditLine(formatted)).toEqual(parsed);
  });

  it("rejects a line without a reason or with short commit ids", () => {
    expect(parseAuditLine("- 候选提交 " + CANDIDATE + " → 发布提交 " + RELEASE + "：")).toBeNull();
    expect(parseAuditLine("- 候选提交 abc → 发布提交 " + RELEASE + "：too short")).toBeNull();
  });

  it("parses an identity line in the same wire format the report writes", () => {
    const parsed = parseIdentityLine(identityLine());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const formatted = formatIdentityLine(parsed.value);
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) return;
    expect(formatted.value).toBe(identityLine());
  });
});
