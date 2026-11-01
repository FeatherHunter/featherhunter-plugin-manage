/**
 * Batch rules: a batch is the unit that binds one candidate to one set of
 * observations, and these are the functions that keep that binding honest.
 *
 * A batch file (`batch.json`) records three things: where the tree was when the
 * batch opened (`startHead` plus the baseline tip), which candidate was frozen
 * for it, and whether it is still valid. The rules below answer the two questions
 * that actually matter later:
 *
 * - *Is this batch still describing the code under test?* If main moved, or the
 *   integrator branch moved, the observations describe a tree nobody can find
 *   any more. Comparing only `HEAD` misses that: on an integration branch HEAD
 *   can sit still while the baseline advances for days.
 * - *Does this evidence belong to this batch?* Evidence collected against
 *   candidate A must never be counted under candidate B, so the identity triple
 *   is compared, not trusted.
 *
 * As with candidate rules: the caller reads git and the disk, these functions
 * decide. `null` means "could not determine" and is never treated as a pass.
 */
import type { BatchName, CommitSha, Sha256Hex } from "./branding";
import { parseBatchName, parseCommitSha, parseSha256Hex } from "./branding";
import type { IdentityBinding, VerificationBase } from "./identity";
import { err, ok, type Result } from "./result";
import type { CandidateIdentity } from "./candidate-rules";

/** Schema of `batch.json`. Bumped only with a migration note in DESIGN.md. */
export const BATCH_SCHEMA_VERSION = 1;

export type BatchStatus = "active" | "stale";

/** The baseline a batch was opened against. */
export interface BatchBase extends VerificationBase {
  /** True when the operator explicitly allowed verifying an outdated base. */
  readonly allowOutdated: boolean;
}

/** The persisted state of one verification batch. */
export interface BatchRecord {
  readonly schemaVersion: typeof BATCH_SCHEMA_VERSION;
  readonly batchName: BatchName;
  readonly batchDir: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: BatchStatus;
  readonly startHead: CommitSha;
  readonly startBranch: string;
  /** `null` is a real value: it means this batch recorded no baseline. */
  readonly base: BatchBase | null;
  readonly endHead?: CommitSha | null;
  readonly endCheckedAt?: string | null;
  readonly candidate?: CandidateIdentity | null;
  /** Result of the preflight that ran when the batch opened. */
  readonly preflightOk?: boolean | null;
}

/* ------------------------------------------------------------------ parsing */

function invalid(message: string, hint?: string): Result<never> {
  return err({ code: "invalid-input", message, ...(hint === undefined ? {} : { hint }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDate(value: unknown, field: string): Result<string> {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return invalid(`${field} must be an ISO timestamp, got ${JSON.stringify(value)}`);
  }
  return ok(value);
}

function readCommit(value: unknown, field: string): Result<CommitSha> {
  const parsed = parseCommitSha(value);
  return parsed.ok ? parsed : invalid(`${field} must be a 40-character lowercase hex commit`);
}

/** Validate a batch record read from disk; normalizes a missing `base` to `null`. */
export function parseBatchRecord(value: unknown): Result<BatchRecord> {
  if (!isRecord(value)) return invalid("batch record must be a JSON object");
  if (value.schemaVersion !== BATCH_SCHEMA_VERSION) {
    return invalid(
      `batch record schemaVersion ${JSON.stringify(value.schemaVersion)} is not ${BATCH_SCHEMA_VERSION}`,
      "an old batch cannot be read by this version; open a new batch instead",
    );
  }
  const batchName = parseBatchName(value.batchName);
  if (!batchName.ok) return invalid(`batchName ${JSON.stringify(value.batchName)} is not a valid batch name`);
  if (typeof value.batchDir !== "string" || value.batchDir.length === 0) {
    return invalid("batchDir must be a non-empty string");
  }
  const createdAt = readDate(value.createdAt, "createdAt");
  if (!createdAt.ok) return createdAt;
  const updatedAt = readDate(value.updatedAt, "updatedAt");
  if (!updatedAt.ok) return updatedAt;
  if (value.status !== "active" && value.status !== "stale") {
    return invalid(`batch status ${JSON.stringify(value.status)} must be "active" or "stale"`);
  }
  const startHead = readCommit(value.startHead, "startHead");
  if (!startHead.ok) return startHead;
  if (typeof value.startBranch !== "string" || value.startBranch.length === 0) {
    return invalid("startBranch must be a non-empty string");
  }

  let base: BatchBase | null = null;
  if (value.base !== undefined && value.base !== null) {
    if (!isRecord(value.base)) return invalid("base must be an object or null");
    if (typeof value.base.ref !== "string" || value.base.ref.length === 0) return invalid("base.ref must be a non-empty string");
    const tip = readCommit(value.base.tip, "base.tip");
    if (!tip.ok) return tip;
    if (typeof value.base.expectedVersion !== "string" || value.base.expectedVersion.length === 0) {
      return invalid("base.expectedVersion must be a non-empty string");
    }
    if (typeof value.base.allowOutdated !== "boolean") return invalid("base.allowOutdated must be a boolean");
    base = { ref: value.base.ref, tip: tip.value, expectedVersion: value.base.expectedVersion, allowOutdated: value.base.allowOutdated };
  }

  let endHead: CommitSha | null | undefined;
  if (value.endHead !== undefined && value.endHead !== null) {
    const parsed = readCommit(value.endHead, "endHead");
    if (!parsed.ok) return parsed;
    endHead = parsed.value;
  } else if (value.endHead === null) {
    endHead = null;
  }
  let endCheckedAt: string | null | undefined;
  if (value.endCheckedAt !== undefined && value.endCheckedAt !== null) {
    const parsed = readDate(value.endCheckedAt, "endCheckedAt");
    if (!parsed.ok) return parsed;
    endCheckedAt = parsed.value;
  } else if (value.endCheckedAt === null) {
    endCheckedAt = null;
  }

  const record: BatchRecord = {
    schemaVersion: BATCH_SCHEMA_VERSION,
    batchName: batchName.value,
    batchDir: value.batchDir,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    status: value.status,
    startHead: startHead.value,
    startBranch: value.startBranch,
    base,
    ...(endHead === undefined ? {} : { endHead }),
    ...(endCheckedAt === undefined ? {} : { endCheckedAt }),
    ...(value.preflightOk === undefined || value.preflightOk === null ? {} : { preflightOk: value.preflightOk === true }),
    ...(isRecord(value.candidate) ? { candidate: readCandidateIdentity(value.candidate) } : {}),
  };
  return ok(record);
}

function readCandidateIdentity(value: Record<string, unknown>): CandidateIdentity | null {
  const commit = parseCommitSha(value.commit);
  const sha = parseSha256Hex(value.sha256);
  const tgzSha = parseSha256Hex(value.tgzSha256);
  const fileDigest = parseSha256Hex(value.fileDigest);
  const manifestDigest = parseSha256Hex(value.manifestDigest);
  if (!commit.ok || !sha.ok || !tgzSha.ok || !fileDigest.ok || !manifestDigest.ok) return null;
  if (typeof value.path !== "string" || typeof value.version !== "string" || typeof value.tgzPath !== "string") return null;
  if (value.validity !== "release" && value.validity !== "development") return null;
  return {
    path: value.path,
    sha256: sha.value,
    commit: commit.value,
    version: value.version,
    validity: value.validity,
    tgzPath: value.tgzPath,
    tgzSha256: tgzSha.value,
    fileDigest: fileDigest.value,
    manifestDigest: manifestDigest.value,
  };
}

/* ---------------------------------------------------------------- freshness */

export type FreshnessProblemCode =
  | "head-moved"
  | "no-baseline"
  | "baseline-unreadable"
  | "baseline-advanced"
  | "outdated-base-allowed";

export interface FreshnessProblem {
  readonly code: FreshnessProblemCode;
  readonly message: string;
  readonly hint?: string;
}

export interface FreshnessFacts {
  readonly record: BatchRecord;
  readonly currentHead: CommitSha;
  /** Current tip of `record.base.ref`; `null` when it could not be read. */
  readonly baseTipNow: CommitSha | null;
  /** Why reading the baseline failed, when it did. */
  readonly baseReadError?: string;
}

export interface FreshnessVerdict {
  readonly status: BatchStatus;
  readonly endHead: CommitSha;
  readonly endCheckedAt: string;
  readonly problems: readonly FreshnessProblem[];
  /** One sentence: `active` means the observations still describe this batch. */
  readonly message: string;
}

/** Decide whether a batch still describes the tree under verification. */
export function judgeFreshness(facts: FreshnessFacts, checkedAt: string): FreshnessVerdict {
  const problems: FreshnessProblem[] = [];
  const { record } = facts;

  if (facts.currentHead !== record.startHead) {
    problems.push({
      code: "head-moved",
      message: `HEAD moved from ${record.startHead} to ${facts.currentHead} since the batch opened`,
      hint: "re-run the affected checks on the current HEAD, or open a new batch",
    });
  }
  if (record.base === null) {
    problems.push({
      code: "no-baseline",
      message: "batch recorded no baseline ref, so freshness cannot be judged",
      hint: "open batches with --base-ref so later checks can tell whether the base advanced",
    });
  } else if (record.base.allowOutdated) {
    problems.push({
      code: "outdated-base-allowed",
      message: `batch was opened with --allow-outdated-base against ${record.base.ref} ${record.base.tip}`,
      hint: "this batch verifies code that does not contain the current baseline; note it in the batch comment",
    });
  } else if (facts.baseReadError !== undefined) {
    problems.push({
      code: "baseline-unreadable",
      message: `could not read baseline ${record.base.ref}: ${facts.baseReadError}`,
      hint: "fetch the baseline ref locally; an unreadable baseline cannot be assumed unchanged",
    });
  } else if (facts.baseTipNow === null) {
    problems.push({
      code: "baseline-unreadable",
      message: `baseline ${record.base.ref} did not resolve to a commit`,
      hint: "the ref was deleted or renamed after the batch opened",
    });
  } else if (facts.baseTipNow !== record.base.tip) {
    problems.push({
      code: "baseline-advanced",
      message: `baseline ${record.base.ref} advanced from ${record.base.tip} to ${facts.baseTipNow}`,
      hint: "the branch now contains commits this batch was not verified against; re-merge and re-run the affected checks",
    });
  }

  const status: BatchStatus = problems.length === 0 ? "active" : "stale";
  return {
    status,
    endHead: facts.currentHead,
    endCheckedAt: checkedAt,
    problems: Object.freeze(problems),
    message:
      status === "active"
        ? `active: HEAD ${facts.currentHead.slice(0, 12)} matches the batch start${record.base === null ? "" : ` and baseline ${record.base.ref} is unchanged`}`
        : `stale: ${problems.map((item) => item.message).join("; ")}`,
  };
}

/* ---------------------------------------------------------- evidence binding */

export interface EvidenceBindingFacts {
  readonly record: BatchRecord;
  readonly meta: {
    readonly batchName: string;
    readonly candidate?: { readonly batchName?: string; readonly commit?: string; readonly packageSha256?: string };
  };
}

/** True when the evidence was collected against exactly this batch's candidate. */
export function judgeEvidenceBinding(facts: EvidenceBindingFacts): Result<IdentityBinding> {
  const { record, meta } = facts;
  if (meta.batchName !== record.batchName) {
    return err({
      code: "identity-mismatch",
      message: `evidence belongs to batch ${JSON.stringify(meta.batchName)}, this batch is ${record.batchName}`,
      hint: "collect evidence with --batch of the batch you are verifying",
    });
  }
  const candidate = meta.candidate;
  if (candidate === undefined) {
    return err({
      code: "identity-mismatch",
      message: "evidence carries no candidate identity",
      hint: "collect evidence through the tool; identity is copied from batch.json, never hand-written",
    });
  }
  const recordCandidate = record.candidate ?? null;
  if (recordCandidate === null) {
    return err({
      code: "identity-mismatch",
      message: "batch record has no candidate identity yet",
      hint: "freeze a candidate and open the batch before collecting evidence",
    });
  }
  if (candidate.batchName !== undefined && candidate.batchName !== record.batchName) {
    return err({
      code: "identity-mismatch",
      message: `evidence candidate names batch ${candidate.batchName}, batch record is ${record.batchName}`,
    });
  }
  if (candidate.commit !== recordCandidate.commit) {
    return err({
      code: "identity-mismatch",
      message: `evidence candidate commit ${String(candidate.commit)} is not this batch's ${recordCandidate.commit}`,
      hint: "this evidence was collected against a different build and must not be counted here",
    });
  }
  if (candidate.packageSha256 !== recordCandidate.sha256) {
    return err({
      code: "identity-mismatch",
      message: `evidence candidate manifest sha256 ${String(candidate.packageSha256)} is not this batch's ${recordCandidate.sha256}`,
    });
  }
  return ok({ batchName: record.batchName, commit: recordCandidate.commit, packageSha256: recordCandidate.sha256 });
}

/** Reason the batch cannot be used, or `null` when it is ready for evidence. */
export function batchBlockingReason(record: BatchRecord): string | null {
  if (record.preflightOk === false) return "batch preflight failed; fix the reported items before collecting evidence";
  if (record.candidate === undefined || record.candidate === null) return "batch has no frozen candidate";
  return null;
}
