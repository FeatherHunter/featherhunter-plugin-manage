/**
 * The release gate's vocabulary: findings, audit lines, ticket sets and the
 * report shape. These are pure rules; orchestration lives under
 * `orchestration/release-gate/`, and the tracker protocol lives behind
 * `contracts/ticket-face.ts`.
 */
import { COMMIT_SHA_RE, SHA256_RE } from "./branding";
import type { CandidateManifest, CandidateIdentity } from "./candidate-rules";
import type { CheckResult, CheckTally } from "./check";
import type { ChecklistFormat } from "./checklist-format";
import { parseIdentityLine, type IdentityBinding } from "./identity";
import type { Failure } from "./result";
import type { ChecklistIssue, TicketComment } from "./ticket-face";

/** Why the gate could not observe a fact. Never conflated with a failure. */
export type ReleaseGateBlockedCode = "adapter-missing" | "prerequisite-missing" | "gate-error";

export interface ReleaseGateBlockedReason {
  readonly code: ReleaseGateBlockedCode;
  readonly message: string;
  readonly hint: string;
}

/** A gate failure that prevented a report from being produced at all. */
export interface GateFailure extends Failure {
  readonly stage: "input";
}

export type ReleaseGateFindingCode =
  | "checklist-missing"
  | "checklist-duplicate"
  | "checklist-not-closed"
  | "checklist-inconsistent"
  | "identity-missing"
  | "identity-conflict"
  | "identity-not-in-candidate"
  | "commit-not-ancestor"
  | "audit-missing"
  | "candidate-not-release"
  | "candidate-source-unstable"
  | "candidate-commit-invalid"
  | "candidate-digest-invalid"
  | "candidate-package-sha-invalid"
  | "candidate-commit-not-ancestor"
  | "candidate-package-sha-mismatch"
  | "candidate-not-registered"
  | "candidate-version-mismatch";

export interface ReleaseGateFinding {
  readonly code: ReleaseGateFindingCode;
  readonly message: string;
  readonly hint: string;
  readonly expected?: string;
  readonly actual?: string;
}

/* ------------------------------------------------------------------ audit */

/**
 * `- 候选提交 <40hex> → 发布提交 <40hex>：<reason>`
 *
 * The arrow may be `→` or `->`; the colon may be full- or half-width; leading
 * spaces are allowed because the line lives in a markdown list.
 */
export const AUDIT_LINE_RE =
  /^\s*-\s*候选提交\s+([0-9a-f]{40})\s*(?:→|->)\s*发布提交\s+([0-9a-f]{40})\s*[:：]\s*(\S[^\r\n]*)$/u;

export interface AuditLine {
  readonly candidateCommit: string;
  readonly releaseCommit: string;
  readonly reason: string;
}

export function parseAuditLine(line: string): AuditLine | null {
  const match = AUDIT_LINE_RE.exec(line);
  if (match === null) return null;
  return {
    candidateCommit: match[1] as string,
    releaseCommit: match[2] as string,
    reason: (match[3] as string).trimEnd(),
  };
}

export function formatAuditLine(line: AuditLine): string {
  return `- 候选提交 ${line.candidateCommit} → 发布提交 ${line.releaseCommit}：${line.reason}`;
}

/** Parse every audit line in a ticket body, ignoring everything else. */
export function collectAuditLines(body: string): readonly AuditLine[] {
  const lines: AuditLine[] = [];
  for (const raw of body.split(/\r?\n/u)) {
    const parsed = parseAuditLine(raw);
    if (parsed !== null) lines.push(parsed);
  }
  return lines;
}

/* ------------------------------------------------------------------ tickets */

export interface ChecklistTicketSet {
  readonly exact: readonly ChecklistIssue[];
  readonly placeholders: readonly ChecklistIssue[];
  readonly others: readonly ChecklistIssue[];
}

/** Strip a leading `v` and surrounding whitespace, matching the release scripts. */
export function normalizeReleaseVersion(version: string): string {
  return version.trim().replace(/^[vV]/u, "");
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/gu, " ").trim();
}

/** Split all checklist-prefixed tickets into exact, placeholder and other. */
export function splitChecklistTickets(
  issues: readonly ChecklistIssue[],
  version: string,
  format: ChecklistFormat,
): ChecklistTicketSet {
  const target = `${normalizeTitle(format.titlePrefix)} ${normalizeReleaseVersion(version)}`;
  const placeholder = `${normalizeTitle(format.titlePrefix)} ${format.placeholderWord.trim()}`;
  const exact: ChecklistIssue[] = [];
  const placeholders: ChecklistIssue[] = [];
  const others: ChecklistIssue[] = [];
  for (const issue of issues) {
    const title = normalizeTitle(issue.title);
    if (title === target) exact.push(issue);
    else if (title === placeholder) placeholders.push(issue);
    else others.push(issue);
  }
  return { exact, placeholders, others };
}

/** Presence rules: exactly one ticket for the target version, placeholders ignored. */
export function judgeChecklistPresence(
  set: ChecklistTicketSet,
  version: string,
  format: ChecklistFormat,
): readonly ReleaseGateFinding[] {
  const target = `${format.titlePrefix} ${normalizeReleaseVersion(version)}`;
  if (set.exact.length === 0) {
    const placeholderNote =
      set.placeholders.length === 0
        ? "no placeholder ticket was found either"
        : `${set.placeholders.length} placeholder ticket(s) still use "${format.placeholderWord}"`;
    return [
      {
        code: "checklist-missing",
        message: `no checklist ticket is titled "${target}" (${placeholderNote})`,
        hint:
          set.placeholders.length > 0
            ? `rename the placeholder ticket to "${target}", or create it`
            : `create a closed checklist ticket titled "${target}" for this release`,
        expected: `exactly one checklist ticket titled "${target}"`,
        actual: `0 exact tickets; ${set.placeholders.length} placeholder(s); ${set.others.length} other prefix ticket(s)`,
      },
    ];
  }
  if (set.exact.length > 1) {
    const numbers = set.exact.map((issue) => `#${issue.number}`).join(" ");
    return [
      {
        code: "checklist-duplicate",
        message: `${set.exact.length} checklist tickets claim "${target}": ${numbers}`,
        hint: "keep exactly one ticket for the target version; close or rename the duplicates",
        expected: `exactly one checklist ticket titled "${target}"`,
        actual: `${set.exact.length} tickets: ${numbers}`,
      },
    ];
  }
  return [];
}

/* ----------------------------------------------------------------- identity */

/** One parsed identity line, with enough position to point a reader at it. */
export interface ScannedIdentity extends IdentityBinding {
  /** 1-based comment index. */
  readonly commentIndex: number;
  /** 1-based line number inside that comment. */
  readonly line: number;
}

export interface IdentityScan {
  readonly identities: readonly ScannedIdentity[];
  /** Human-readable conflicts: same batch name, different commit or package sha. */
  readonly conflicts: readonly string[];
  /** 1-based comment indexes that look like batch records but carry no identity line. */
  readonly missingAt: readonly number[];
}

const BATCH_START_MARKER = "批次开始";
const LOCALIZED_STATUS_WORDS = ["通过", "失败", "豁免", "未测", "阻塞", "作废", "已验证", "待验证"];

function scenarioIdFull(format: ChecklistFormat): RegExp {
  const flags = format.scenarioIdPattern.flags.replace(/[gy]/gu, "");
  return new RegExp(`^(?:${format.scenarioIdPattern.source})$`, flags);
}

function scenarioIdsIn(text: string, format: ChecklistFormat): string[] {
  const pattern = new RegExp(format.scenarioIdPattern.source, `${format.scenarioIdPattern.flags.replace(/[gy]/gu, "")}g`);
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

function containsStatusWord(text: string, format: ChecklistFormat): boolean {
  return [...format.statusVocabulary, ...LOCALIZED_STATUS_WORDS].some((word) => text.includes(word));
}

/**
 * A comment that records a batch must also carry the identity line.
 *
 * The three shapes are the documented template forms; the batch-start marker
 * is protocol text ("批次开始"), not the body section heading, because that is
 * what comments actually contain.
 */
export function requiresIdentity(body: string, format: ChecklistFormat): boolean {
  if (new RegExp(`${BATCH_START_MARKER}\\s*[:：]`, "u").test(body)) return true;
  const full = scenarioIdFull(format);
  for (const raw of body.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const scenarioLine = /^场景\s+([^：:\n]+)[：:]/u.exec(line);
    if (scenarioLine !== null && scenarioIdsIn(scenarioLine[1] as string, format).length > 0) return true;
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/^\*\*|\*\*$/gu, ""));
      if (cells.length > 0 && full.test(cells[0] as string)) return true;
    }
    const bold = /^\s*-\s*\*\*(.+?)\*\*/u.exec(line);
    if (bold !== null) {
      const inner = bold[1] as string;
      if (scenarioIdsIn(inner, format).length > 0 && containsStatusWord(inner, format)) return true;
    }
  }
  return false;
}

/** Read every identity line and report missing/conflicting ones. */
export function scanIdentities(
  comments: readonly TicketComment[],
  format: ChecklistFormat,
): IdentityScan {
  const identities: ScannedIdentity[] = [];
  const missingAt: number[] = [];
  comments.forEach((comment, index) => {
    const commentIndex = index + 1;
    let found = false;
    comment.body.split(/\r?\n/u).forEach((raw, lineIndex) => {
      const parsed = parseIdentityLine(raw);
      if (parsed.ok) {
        identities.push({ ...parsed.value, commentIndex, line: lineIndex + 1 });
        found = true;
      }
    });
    if (!found && requiresIdentity(comment.body, format)) missingAt.push(commentIndex);
  });

  const firstByBatch = new Map<string, ScannedIdentity>();
  const conflicts: string[] = [];
  for (const identity of identities) {
    const batch = String(identity.batchName);
    const first = firstByBatch.get(batch);
    if (first === undefined) {
      firstByBatch.set(batch, identity);
      continue;
    }
    if (first.commit !== identity.commit || first.packageSha256 !== identity.packageSha256) {
      conflicts.push(
        `comment #${identity.commentIndex} repeats batch "${batch}" with a different identity: ` +
          `candidate ${first.commit} / ${identity.commit}, package sha256 ${first.packageSha256} / ${identity.packageSha256}`,
      );
    }
  }
  return { identities, conflicts, missingAt };
}

/**
 * Compare the latest batch identity with the candidate manifest.
 *
 * A missing candidate is not compared here; check 4 still proves that the
 * comment record is complete and internally consistent.
 */
export function judgeIdentityBinding(
  scan: IdentityScan,
  latestBatch: string | null,
  candidate: Pick<CandidateIdentity, "commit" | "tgzSha256"> | null,
): readonly ReleaseGateFinding[] {
  if (candidate === null) return [];
  if (latestBatch === null) return [];
  const identities = scan.identities.filter((identity) => String(identity.batchName) === latestBatch);
  if (identities.length === 0) {
    return [
      {
        code: "identity-missing",
        message: `the latest batch "${latestBatch}" has no identity line`,
        hint: "add the identity line to that batch's start comment",
        expected: `identity line for batch "${latestBatch}"`,
        actual: "no identity line",
      },
    ];
  }
  const latest = identities[identities.length - 1] as ScannedIdentity;
  const findings: ReleaseGateFinding[] = [];
  if (latest.commit !== candidate.commit) {
    findings.push({
      code: "identity-not-in-candidate",
      message: `the latest batch identity names candidate ${latest.commit}, but the candidate manifest names ${candidate.commit}`,
      hint: "freeze the candidate from the commit the ticket records, or correct the identity line",
      expected: `identity commit ${candidate.commit}`,
      actual: `${latest.commit} (comment #${latest.commentIndex})`,
    });
  }
  if (latest.packageSha256 !== candidate.tgzSha256) {
    findings.push({
      code: "candidate-package-sha-mismatch",
      message: `the latest batch identity names package sha256 ${latest.packageSha256}, but the candidate manifest names ${candidate.tgzSha256}`,
      hint: "record the package sha256 of the frozen candidate in the batch identity line",
      expected: `package sha256 ${candidate.tgzSha256}`,
      actual: `${latest.packageSha256} (comment #${latest.commentIndex})`,
    });
  }
  return findings;
}

/* ------------------------------------------------------------------- audit */

export interface AuditJudgement {
  /** True when the commits differ and the gate needs an audit line. */
  readonly required: boolean;
  /** True when an ancestor relationship or an exact audit line covers the pair. */
  readonly covered: boolean;
  /** True when the adapter could not answer; the check must be blocked. */
  readonly unknown: boolean;
  readonly audit: AuditLine | null;
}

export interface AuditInput {
  readonly candidateCommit: string;
  readonly releaseCommit: string;
  readonly isAncestor: boolean | "unknown";
  readonly auditLines: readonly AuditLine[];
}

/** Decide one candidate/release pair: ancestor, exact audit line, or neither. */
export function judgeAncestorAudit(input: AuditInput): {
  readonly findings: readonly ReleaseGateFinding[];
  readonly judgement: AuditJudgement;
} {
  const { candidateCommit, releaseCommit, isAncestor, auditLines } = input;
  if (candidateCommit === releaseCommit) {
    return {
      findings: [],
      judgement: { required: false, covered: true, unknown: false, audit: null },
    };
  }
  if (isAncestor === "unknown") {
    // "Unknown" is not "no": forcing a fail here would blame the candidate for
    // the adapter's inability to answer, so the check reports blocked instead.
    return {
      findings: [],
      judgement: { required: true, covered: false, unknown: true, audit: null },
    };
  }
  const matching =
    auditLines.find(
      (line) => line.candidateCommit === candidateCommit && line.releaseCommit === releaseCommit,
    ) ?? null;
  if (isAncestor) {
    return {
      findings: [],
      judgement: { required: false, covered: true, unknown: false, audit: matching },
    };
  }
  if (matching !== null) {
    return {
      findings: [],
      judgement: { required: true, covered: true, unknown: false, audit: matching },
    };
  }
  return {
    findings: [
      {
        code: "commit-not-ancestor",
        message: `candidate ${candidateCommit} is not an ancestor of release ${releaseCommit}`,
        hint: "rebase the release onto the candidate, or record the difference under the audit heading",
        expected: `${candidateCommit} is an ancestor of ${releaseCommit}`,
        actual: "not an ancestor",
      },
      {
        code: "audit-missing",
        message: `no audit line covers ${candidateCommit} → ${releaseCommit}`,
        hint: `add under "## 候选与发布差异审计": - 候选提交 ${candidateCommit} → 发布提交 ${releaseCommit}：<one-line reason>`,
        expected: `audit line for (${candidateCommit}, ${releaseCommit})`,
        actual: `${auditLines.length} audit line(s), none matching both commits`,
      },
    ],
    judgement: { required: true, covered: false, unknown: false, audit: null },
  };
}

/* --------------------------------------------------------------- candidate */

/** The candidate rules that do not need the batch directory. */
export function judgeCandidateValidity(
  candidate: CandidateManifest,
  version: string,
): readonly ReleaseGateFinding[] {
  const findings: ReleaseGateFinding[] = [];
  if (candidate.validity !== "release") {
    findings.push({
      code: "candidate-not-release",
      message: `the candidate was frozen from a ${candidate.validity} tree and cannot be published`,
      hint: "commit or stash the changes, re-freeze on a clean tree, and use that candidate",
      expected: "validity release",
      actual: candidate.validity,
    });
  }
  if (candidate.sourceStable !== true) {
    findings.push({
      code: "candidate-source-unstable",
      message: "the candidate's source moved while it was being frozen",
      hint: "re-freeze from a tree that does not change during the build",
      expected: "sourceStable true",
      actual: String(candidate.sourceStable),
    });
  }
  if (!COMMIT_SHA_RE.test(candidate.git.commit)) {
    findings.push({
      code: "candidate-commit-invalid",
      message: `the candidate commit "${candidate.git.commit}" is not 40 lowercase hex characters`,
      hint: "re-freeze the candidate; the commit field is malformed",
      expected: "40 lowercase hex characters",
      actual: candidate.git.commit,
    });
  }
  if (!SHA256_RE.test(candidate.package.fileDigest)) {
    findings.push({
      code: "candidate-digest-invalid",
      message: `the candidate fileDigest "${candidate.package.fileDigest}" is not 64 lowercase hex characters`,
      hint: "re-freeze the candidate; the file digest is malformed",
      expected: "64 lowercase hex characters",
      actual: candidate.package.fileDigest,
    });
  }
  if (!SHA256_RE.test(candidate.package.tgzSha256)) {
    findings.push({
      code: "candidate-package-sha-invalid",
      message: `the candidate package sha256 "${candidate.package.tgzSha256}" is not 64 lowercase hex characters`,
      hint: "re-freeze the candidate; the tarball digest is malformed",
      expected: "64 lowercase hex characters",
      actual: candidate.package.tgzSha256,
    });
  }
  if (normalizeReleaseVersion(candidate.version) !== normalizeReleaseVersion(version)) {
    findings.push({
      code: "candidate-version-mismatch",
      message: `the candidate version "${candidate.version}" does not match the release version "${version}"`,
      hint: "freeze the candidate from the release commit that declares the target version",
      expected: normalizeReleaseVersion(version),
      actual: normalizeReleaseVersion(candidate.version),
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ report */

export interface ReleaseGateReport {
  readonly schemaVersion: 1;
  readonly capability: "real-machine-verification";
  readonly command: "release-gate";
  readonly version: string;
  readonly releaseCommit: string;
  readonly decision: "pass" | "fail" | "blocked";
  readonly exitCode: 0 | 1 | 2;
  readonly checks: readonly CheckResult[];
  readonly tally: CheckTally;
  readonly ticket: {
    readonly number: number | null;
    readonly url?: string;
    readonly exactCount: number;
    readonly identities: number;
    readonly latestBatch: string | null;
  };
  readonly candidate: {
    readonly commit: string;
    readonly validity: string;
    readonly fileDigest: string;
  } | null;
  readonly audit: {
    readonly required: boolean;
    readonly covered: boolean;
    readonly line: string | null;
  };
  /** Every finding, flattened for a caller that only wants the red reasons. */
  readonly findings: readonly ReleaseGateFinding[];
  /** The exact ticket-face records the decision relied on. */
  readonly records: {
    readonly auditLine: string | null;
    readonly identities: readonly string[];
  };
  readonly blocked: readonly ReleaseGateBlockedReason[];
  readonly notes: readonly string[];
}
