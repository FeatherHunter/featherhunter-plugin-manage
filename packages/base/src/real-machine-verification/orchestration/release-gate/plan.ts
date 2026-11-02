/**
 * The six release-gate checks, as data.
 *
 * Each check is a small function over a snapshot the runner already collected.
 * Keeping them separate from collection makes every rule testable with a fake
 * adapter and keeps I/O errors classified once, in `run.ts`.
 */
import { missingTicketFaceHint } from "../../adapters/ticket-face/loader";
import type { CheckId } from "../../contracts/branding";
import type { CandidateManifest } from "../../contracts/candidate-rules";
import type { ChecklistFormat } from "../../contracts/checklist-format";
import type { ConsistencyReport } from "../../contracts/checklist-rules";
import {
  judgeAncestorAudit,
  judgeCandidateValidity,
  judgeChecklistPresence,
  judgeIdentityBinding,
  type AuditJudgement,
  type ReleaseGateBlockedReason,
  type ChecklistTicketSet,
  type IdentityScan,
  type ReleaseGateFinding,
  type ScannedIdentity,
} from "../../contracts/release-gate";
import type { ChecklistIssue, TicketComment } from "../../contracts/ticket-face";
import {
  blocked,
  checkId,
  failed,
  passed,
  skipped,
  type CheckOutcome,
} from "../types";

export const RELEASE_GATE_CHECK_IDS = [
  "release-checklist-unique",
  "release-checklist-closed",
  "release-checklist-consistency",
  "release-batch-identity",
  "release-ancestor-audit",
  "release-candidate-valid",
] as const;

export type ReleaseGateCheckId = (typeof RELEASE_GATE_CHECK_IDS)[number];

/** One candidate commit the gate asked about, plus the rule's answer. */
export interface GateAudit {
  readonly commit: string;
  readonly findings: readonly ReleaseGateFinding[];
  readonly judgement: AuditJudgement;
}

/** Everything the checks may look at, collected once. */
export interface GateSnapshot {
  readonly set: ChecklistTicketSet;
  readonly issue: ChecklistIssue | null;
  readonly comments: readonly TicketComment[];
  readonly releaseCommit: string;
  readonly scan: IdentityScan;
  readonly latestBatch: string | null;
  readonly latestIdentity: ScannedIdentity | null;
  readonly audits: readonly GateAudit[];
  readonly consistency: ConsistencyReport | null;
}

export interface GateContext {
  readonly version: string;
  readonly format: ChecklistFormat;
  readonly candidate: CandidateManifest | null;
  readonly requireCandidate: boolean;
  readonly snapshot: GateSnapshot | null;
  /** Hint to repeat when the ticket face is unavailable. */
  readonly ticketBlockedHint: string;
  readonly blocked: readonly ReleaseGateBlockedReason[];
}

export interface GateCheckOutcome {
  readonly outcome: CheckOutcome;
  readonly findings: readonly ReleaseGateFinding[];
}

export interface GateCheckDefinition {
  readonly id: CheckId;
  readonly title: string;
  readonly hard: true;
  readonly run: (context: GateContext) => GateCheckOutcome;
}

function definition(
  id: ReleaseGateCheckId,
  title: string,
  run: (context: GateContext) => GateCheckOutcome,
): GateCheckDefinition {
  return { id: checkId(id), title, hard: true, run };
}

function unavailable(context: GateContext, check: string): GateCheckOutcome {
  return {
    outcome: blocked(`${check}: the ticket face is unavailable`, context.ticketBlockedHint),
    findings: [],
  };
}

function findingOutcome(findings: readonly ReleaseGateFinding[]): GateCheckOutcome {
  const first = findings[0] as ReleaseGateFinding;
  const hint = findings.length === 1
    ? first.hint
    : `${first.hint} (also: ${findings.slice(1).map((item) => item.message).join("; ")})`;
  return {
    outcome: failed(first.message, first.expected ?? "the checklist record agrees with itself", first.actual ?? first.message, hint),
    findings,
  };
}

/** 1. Exactly one ticket is titled for this version. */
const checklistUnique = definition("release-checklist-unique", "checklist ticket is unique", (context) => {
  if (context.snapshot === null) return unavailable(context, "cannot locate the checklist ticket");
  const findings = judgeChecklistPresence(context.snapshot.set, context.version, context.format);
  if (findings.length > 0) return findingOutcome(findings);
  const issue = context.snapshot.issue;
  if (issue === null) {
    return {
      outcome: blocked(
        "the pinned checklist ticket is not among the issues the adapter returned",
        "drop checklistTicket, or make listChecklistIssues() return that ticket",
      ),
      findings: [],
    };
  }
  return {
    outcome: passed(`#${issue.number} is the only checklist ticket for ${context.version}`),
    findings: [],
  };
});

/** 2. That ticket is closed. */
const checklistClosed = definition("release-checklist-closed", "checklist ticket is closed", (context) => {
  if (context.snapshot === null) return unavailable(context, "cannot read the checklist state");
  const issue = context.snapshot.issue;
  if (issue === null) {
    return {
      outcome: blocked(
        "cannot check closure without exactly one checklist ticket",
        "make release-checklist-unique pass first",
      ),
      findings: [],
    };
  }
  if (issue.state === "CLOSED") {
    return { outcome: passed(`#${issue.number} is closed`), findings: [] };
  }
  const finding: ReleaseGateFinding = {
    code: "checklist-not-closed",
    message: `checklist ticket #${issue.number} is ${issue.state}`,
    hint: "record the final batch result as a comment first, then close the ticket before releasing",
    expected: "CLOSED",
    actual: issue.state === "OPEN" ? `OPEN (#${issue.number})` : "UNKNOWN",
  };
  return findingOutcome([finding]);
});

/** 3. Body and comments record the same conclusions. */
const checklistConsistency = definition("release-checklist-consistency", "checklist record is internally consistent", (context) => {
  if (context.snapshot === null) return unavailable(context, "cannot read the checklist record");
  const consistency = context.snapshot.consistency;
  if (consistency === null) {
    return {
      outcome: blocked(
        "cannot compare body and comments without exactly one checklist ticket",
        "make release-checklist-unique pass first",
      ),
      findings: [],
    };
  }
  if (!consistency.ok) return findingOutcome(consistency.findings);
  return {
    outcome: passed(
      `${consistency.rows.length} overview row(s) agree with ${context.snapshot.comments.length} comment(s)`,
    ),
    findings: [],
  };
});

/** 4. Identity lines are present, consistent, and match the candidate. */
const batchIdentity = definition("release-batch-identity", "batch identities are complete", (context) => {
  if (context.snapshot === null) return unavailable(context, "cannot read batch identities");
  const issue = context.snapshot.issue;
  if (issue === null) {
    return {
      outcome: blocked(
        "cannot read batch identities without exactly one checklist ticket",
        "make release-checklist-unique pass first",
      ),
      findings: [],
    };
  }
  const findings: ReleaseGateFinding[] = [];
  for (const conflict of context.snapshot.scan.conflicts) {
    findings.push({
      code: "identity-conflict",
      message: conflict,
      hint: "one batch must have exactly one commit and package sha256; correct the conflicting line",
    });
  }
  for (const commentIndex of context.snapshot.scan.missingAt) {
    findings.push({
      code: "identity-missing",
      message: `comment #${commentIndex} looks like a batch record but has no identity line`,
      hint: `add "- 验证身份：批次 <batch>；候选提交 <40hex>；候选包 sha256 <64hex>" to that comment`,
      expected: "an identity line in every batch-recording comment",
      actual: `no identity line in comment #${commentIndex}`,
    });
  }
  if (context.snapshot.scan.identities.length === 0 && context.snapshot.scan.missingAt.length === 0) {
    findings.push({
      code: "identity-missing",
      message: "no comment contains a verification identity line",
      hint: "record the batch identity line in the batch-start comment",
      expected: "at least one identity line",
      actual: `0 identity lines across ${context.snapshot.comments.length} comment(s)`,
    });
  }
  const candidateIdentity = context.candidate === null
    ? null
    : { commit: context.candidate.git.commit, tgzSha256: context.candidate.package.tgzSha256 };
  findings.push(...judgeIdentityBinding(context.snapshot.scan, context.snapshot.latestBatch, candidateIdentity));
  if (findings.length > 0) return findingOutcome(findings);

  const count = context.snapshot.scan.identities.length;
  if (context.candidate === null) {
    return {
      outcome: passed(`${count} identity line(s) are complete; no candidate was supplied for comparison`),
      findings: [],
    };
  }
  return {
    outcome: passed(
      `${count} identity line(s); latest batch "${context.snapshot.latestBatch ?? "?"}" matches candidate ${context.candidate.git.commit}`,
    ),
    findings: [],
  };
});

/** 5. The candidate commit is an ancestor of the release, or audited. */
const ancestorAudit = definition("release-ancestor-audit", "candidate is an ancestor of the release, or audited", (context) => {
  if (context.snapshot === null) return unavailable(context, "cannot determine the ancestor relationship");
  if (context.snapshot.audits.length === 0) {
    return {
      outcome: skipped("no batch identity or candidate commit differs from the release commit"),
      findings: [],
    };
  }
  const unknown = context.snapshot.audits.filter((audit) => audit.judgement.unknown);
  if (unknown.length > 0) {
    return {
      outcome: blocked(
        `isAncestor could not decide ${unknown.map((audit) => audit.commit).join(", ")} against ${context.snapshot.releaseCommit}`,
        'the ticket-face adapter must return "unknown" (not false) when Git cannot answer; run the gate in a full clone that contains the release commit',
      ),
      findings: [],
    };
  }
  const findings = context.snapshot.audits.flatMap((audit) => audit.findings);
  if (findings.length > 0) return findingOutcome(findings);
  const audited = context.snapshot.audits.filter((audit) => audit.judgement.audit !== null);
  if (audited.length > 0) {
    const audit = audited[0] as GateAudit;
    return {
      outcome: passed(
        `audit line covers ${audit.commit} → ${context.snapshot.releaseCommit}: ${audit.judgement.audit?.reason ?? ""}`,
      ),
      findings: [],
    };
  }
  return {
    outcome: passed(
      `${context.snapshot.audits.map((audit) => audit.commit).join(", ")} is an ancestor of ${context.snapshot.releaseCommit}`,
    ),
    findings: [],
  };
});

/** 6. The frozen candidate may represent a release. */
const candidateValid = definition("release-candidate-valid", "candidate is publishable", (context) => {
  if (context.candidate === null) {
    if (context.requireCandidate) {
      const finding: ReleaseGateFinding = {
        code: "candidate-not-registered",
        message: "no candidate manifest was supplied, but this path requires one",
        hint: "freeze the release candidate and pass its candidate.json to the gate",
        expected: "a frozen release candidate",
        actual: "none",
      };
      return findingOutcome([finding]);
    }
    // A candidate is optional evidence. A release path that ships without a
    // frozen artifact still has a ticket record to check, so a missing
    // candidate means "not checked here", not "the gate is blind". Callers
    // that do require one set requireCandidate and get a hard failure above.
    return {
      outcome: skipped(
        "no candidate manifest was supplied; the ticket record was checked without byte-level identity",
        "pass the frozen candidate.json to the gate as well, to prove which bytes would ship",
      ),
      findings: [],
    };
  }
  const findings = judgeCandidateValidity(context.candidate, context.version);
  if (findings.length > 0) return findingOutcome(findings);
  return {
    outcome: passed(
      `candidate ${context.candidate.git.commit} is a release build of ${context.candidate.version}`,
    ),
    findings: [],
  };
});

export const RELEASE_GATE_CHECKS: readonly GateCheckDefinition[] = Object.freeze([
  checklistUnique,
  checklistClosed,
  checklistConsistency,
  batchIdentity,
  ancestorAudit,
  candidateValid,
]);
