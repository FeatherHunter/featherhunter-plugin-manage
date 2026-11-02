/**
 * Batch orchestration: opening a batch, checking it is still fresh, and binding
 * evidence to the candidate the batch was opened on.
 *
 * A batch is the unit that keeps one candidate, one baseline and one set of
 * observations together. This module owns the three things that must not drift
 * apart:
 *
 * - `openBatch` snapshots HEAD, the baseline tip and the candidate, writes
 *   `batch.json`, and renders the two wire-format lines a release comment quotes;
 * - `checkBatch` re-reads the tree and judges freshness with the batch rules
 *   (HEAD unchanged *and* baseline not advanced; an unreadable baseline is a
 *   failure, never a pass), then scans the batch's evidence manifests and
 *   rejects every one that is not bound to this batch's candidate;
 * - `loadBatchContextForEvidence` gives the evidence command the batch context it
 *   needs to stamp the identity triple onto new evidence.
 *
 * Everything here goes through ports, so the tests drive the same code with an
 * in-memory git and filesystem and never touch the machine.
 */
import type { BatchName, CheckId, CommitSha, ProfileName, Sha256Hex } from "../contracts/branding";
import { parseBatchName, parseCheckId, parseCommitSha } from "../contracts/branding";
import {
  BATCH_SCHEMA_VERSION,
  judgeEvidenceBinding,
  judgeFreshness,
  parseBatchRecord,
  type BatchBase,
  type BatchRecord,
  type FreshnessProblem,
  type FreshnessProblemCode,
  type FreshnessVerdict,
} from "../contracts/batch-rules";
import {
  candidateIdentityOf,
  parseCandidateManifest,
  type CandidateIdentity,
  type CandidateManifest,
} from "../contracts/candidate-rules";
import { decideExitCode, type CheckResult, type CheckStatus } from "../contracts/check";
import type { EvidenceManifest } from "../contracts/evidence-contract";
import { formatBaseLine, formatIdentityLine, sha256Text, type IdentityBinding } from "../contracts/identity";
import type { Ports } from "../contracts/ports";
import { err, ok, type Failure, type FailureCode, type Result } from "../contracts/result";
import type { VerificationDeclaration } from "../declaration/loader";
import { EVIDENCE_MANIFEST_FILENAME, validateEvidenceManifest } from "../evidence/manifest";
import { readGitState } from "../runtime/dsh/git-state";
import { joinFsPath, parentPath, toPosixPath } from "../runtime/paths";
import { resolveWorkRoot } from "./context";

/* ------------------------------------------------------------------ layout */

export const BATCHES_DIRNAME = "batches";
export const BATCH_RECORD_FILENAME = "batch.json";
export const BATCH_CANDIDATES_DIRNAME = "candidates";
export const BATCH_CANDIDATE_FILENAME = "candidate.json";

/** Evidence manifests live somewhere below the batch directory; how deep we look. */
const EVIDENCE_SCAN_DEPTH = 8;

/** Where all batches of one work root live. */
export function batchesRoot(workRoot: string): string {
  return joinFsPath(workRoot, BATCHES_DIRNAME);
}

/** The directory that belongs to one batch name. */
export function batchDirFor(workRoot: string, name: BatchName): string {
  return joinFsPath(batchesRoot(workRoot), name);
}

/* ----------------------------------------------------------------- failure */

/** Which step produced the failure; the CLI prints it in `--json` mode. */
export type BatchStage = "context" | "candidate" | "baseline" | "record" | "evidence" | "io" | "conflict";

/**
 * A failure that knows whether it is "nothing proven" (exit 2) or "proven wrong"
 * (exit 1). The distinction is the whole reason batches exist: a missing
 * prerequisite must never look like a failed verification.
 */
export interface BatchFailure extends Failure {
  readonly stage: BatchStage;
  /** True when the run proves nothing and the caller should exit 2. */
  readonly blocked: boolean;
}

export interface BatchFailureOptions {
  readonly hint?: string;
  readonly blocked?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function batchFailure(
  stage: BatchStage,
  code: FailureCode,
  message: string,
  options: BatchFailureOptions = {},
): BatchFailure {
  return {
    code,
    message,
    stage,
    blocked: options.blocked ?? false,
    ...(options.hint === undefined ? {} : { hint: options.hint }),
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}

/* ------------------------------------------------------------------ helpers */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function short(value: string, length = 12): string {
  return value.length <= length ? value : value.slice(0, length);
}

function checkId(value: string): CheckId {
  const parsed = parseCheckId(value);
  if (!parsed.ok) throw new Error(`batch check id ${value} is invalid: ${parsed.error.message}`);
  return parsed.value;
}

/** `batch-2026-11-01T21-00-00-000-08-00`: readable and collision-free per second. */
function defaultBatchName(ports: Ports): Result<BatchName, Failure> {
  const stamp = ports.clock
    .iso()
    .replace(/[^0-9A-Za-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return parseBatchName(`batch-${stamp.length === 0 ? "now" : stamp}`);
}

function relativeTo(root: string, path: string): string {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function describeRef(ref: string): string {
  return ref.length === 0 ? "(empty ref)" : ref;
}

/* ------------------------------------------------------------- the record */

export interface LoadedBatchRecord {
  readonly record: BatchRecord;
  /** The JSON object exactly as stored, so annotations survive a status write. */
  readonly raw: Readonly<Record<string, unknown>>;
  readonly path: string;
  readonly batchDir: string;
  readonly text: string;
}

/** Read and validate `<batchDir>/batch.json`. */
export async function loadBatchRecord(
  fs: Ports["fs"],
  batchDir: string,
): Promise<Result<LoadedBatchRecord, BatchFailure>> {
  const path = joinFsPath(batchDir, BATCH_RECORD_FILENAME);
  if (!(await fs.exists(path))) {
    return err(
      batchFailure("record", "not-found", `no batch record at ${path}`, {
        hint: "open a batch first: dsh-verify batch open --name <name> --base-ref <ref>",
        blocked: true,
        details: { path },
      }),
    );
  }
  const text = await fs.readText(path);
  if (!text.ok) {
    return err(
      batchFailure("record", "io", `could not read the batch record ${path}: ${text.error.message}`, {
        blocked: true,
        details: { path },
      }),
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text.value);
  } catch (error) {
    return err(
      batchFailure("record", "invalid-input", `batch record ${path} is not valid JSON: ${(error as Error).message}`, {
        hint: "the record is machine-written; delete the batch directory and open the batch again",
        blocked: true,
        details: { path },
      }),
    );
  }
  const parsed = parseBatchRecord(value);
  if (!parsed.ok) {
    return err(
      batchFailure("record", "invalid-input", `batch record ${path} does not match this version: ${parsed.error.message}`, {
        ...(parsed.error.hint === undefined ? {} : { hint: parsed.error.hint }),
        blocked: true,
        details: { path },
      }),
    );
  }
  return ok({
    record: parsed.value,
    raw: isRecord(value) ? value : {},
    path,
    batchDir,
    text: text.value,
  });
}

/** The newest batch record under the work root, by `createdAt`. */
export async function latestBatchRecord(
  fs: Ports["fs"],
  workRoot: string,
): Promise<Result<LoadedBatchRecord, BatchFailure>> {
  const root = batchesRoot(workRoot);
  const listed = await fs.list(root);
  if (!listed.ok) {
    return err(
      batchFailure("record", "not-found", `no batch directory at ${root}`, {
        hint: "open a batch first: dsh-verify batch open --name <name> --base-ref <ref>",
        blocked: true,
        details: { path: root },
      }),
    );
  }
  const dirs = listed.value
    .filter((entry) => entry.kind === "directory")
    .map((entry) => joinFsPath(root, entry.name))
    .sort();
  if (dirs.length === 0) {
    return err(
      batchFailure("record", "not-found", `no batch under ${root}`, {
        hint: "open a batch first: dsh-verify batch open --name <name> --base-ref <ref>",
        blocked: true,
        details: { path: root },
      }),
    );
  }
  const loaded: LoadedBatchRecord[] = [];
  let firstFailure: BatchFailure | null = null;
  for (const dir of dirs) {
    const record = await loadBatchRecord(fs, dir);
    if (record.ok) loaded.push(record.value);
    else if (firstFailure === null) firstFailure = record.error;
  }
  if (loaded.length === 0 || firstFailure !== null && loaded.length === 0) {
    return err(firstFailure ?? batchFailure("record", "not-found", `no readable batch record under ${root}`, { blocked: true }));
  }
  loaded.sort(
    (left, right) =>
      Date.parse(right.record.createdAt) - Date.parse(left.record.createdAt) ||
      (left.batchDir < right.batchDir ? 1 : -1),
  );
  const newest = loaded[0];
  if (newest === undefined) {
    return err(batchFailure("record", "not-found", `no readable batch record under ${root}`, { blocked: true }));
  }
  return ok(newest);
}

async function resolveBatchForStatus(
  fs: Ports["fs"],
  workRoot: string,
  rawName: string | undefined,
): Promise<Result<LoadedBatchRecord, BatchFailure>> {
  if (rawName === undefined) return latestBatchRecord(fs, workRoot);
  const name = parseBatchName(rawName);
  if (!name.ok) {
    return err(
      batchFailure("context", "invalid-input", `--name is not a valid batch name: ${rawName}`, {
        hint: "use 1-64 characters from A-Z a-z 0-9 . _ - (at least one letter or digit)",
        blocked: true,
      }),
    );
  }
  return loadBatchRecord(fs, batchDirFor(workRoot, name.value));
}

/* --------------------------------------------------------------- candidate */

export interface ResolvedCandidate {
  readonly manifest: CandidateManifest;
  readonly manifestPath: string;
  readonly dir: string;
  /** sha256 of the candidate.json bytes; binds evidence to the manifest, not to the tarball. */
  readonly manifestSha256: Sha256Hex;
  readonly identity: CandidateIdentity;
}

async function readCandidateFile(
  fs: Ports["fs"],
  manifestPath: string,
): Promise<Result<ResolvedCandidate, BatchFailure>> {
  const text = await fs.readText(manifestPath);
  if (!text.ok) {
    return err(
      batchFailure("candidate", "io", `could not read the candidate manifest ${manifestPath}: ${text.error.message}`, {
        hint: "run dsh-verify freeze, or pass --candidate with the directory it wrote",
        blocked: true,
        details: { path: manifestPath },
      }),
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text.value);
  } catch (error) {
    return err(
      batchFailure("candidate", "invalid-input", `candidate manifest ${manifestPath} is not valid JSON: ${(error as Error).message}`, {
        hint: "re-run dsh-verify freeze",
        blocked: true,
        details: { path: manifestPath },
      }),
    );
  }
  const parsed = parseCandidateManifest(value);
  if (!parsed.ok) {
    return err(
      batchFailure("candidate", "invalid-input", `candidate manifest ${manifestPath} is not usable: ${parsed.error.message}`, {
        ...(parsed.error.hint === undefined ? {} : { hint: parsed.error.hint }),
        blocked: true,
        details: { path: manifestPath },
      }),
    );
  }
  const manifestSha256 = sha256Text(text.value);
  return ok({
    manifest: parsed.value,
    manifestPath,
    dir: parentPath(manifestPath) ?? manifestPath,
    manifestSha256,
    identity: candidateIdentityOf(parsed.value, manifestPath, manifestSha256),
  });
}

/**
 * Resolve the candidate: an explicit `--candidate` file/directory, or the newest
 * manifest under `<workRoot>/candidates` (the directory freeze writes into).
 */
export async function resolveCandidate(
  fs: Ports["fs"],
  workRoot: string,
  explicit: string | undefined,
): Promise<Result<ResolvedCandidate, BatchFailure>> {
  if (explicit !== undefined) {
    const manifestPath = explicit.toLowerCase().endsWith(".json")
      ? explicit
      : joinFsPath(explicit, BATCH_CANDIDATE_FILENAME);
    if (!(await fs.exists(manifestPath))) {
      return err(
        batchFailure("candidate", "not-found", `no candidate manifest at ${manifestPath}`, {
          hint: "pass --candidate <dir> with the directory dsh-verify freeze wrote (or omit it to use the newest one)",
          blocked: true,
          details: { path: manifestPath },
        }),
      );
    }
    return readCandidateFile(fs, manifestPath);
  }

  const root = joinFsPath(workRoot, BATCH_CANDIDATES_DIRNAME);
  const listed = await fs.list(root);
  if (!listed.ok) {
    return err(
      batchFailure("candidate", "not-found", `no candidate directory at ${root}`, {
        hint: "run dsh-verify freeze first, or pass --candidate <dir>",
        blocked: true,
        details: { path: root },
      }),
    );
  }
  const dirs = listed.value
    .filter((entry) => entry.kind === "directory")
    .map((entry) => joinFsPath(root, entry.name))
    .sort();
  const candidates: ResolvedCandidate[] = [];
  let lastFailure: BatchFailure | null = null;
  for (const dir of dirs) {
    const read = await readCandidateFile(fs, joinFsPath(dir, BATCH_CANDIDATE_FILENAME));
    if (read.ok) candidates.push(read.value);
    else lastFailure = read.error;
  }
  if (candidates.length === 0) {
    return err(
      lastFailure === null
        ? batchFailure("candidate", "not-found", `no candidate manifest under ${root}`, {
            hint: "run dsh-verify freeze first, or pass --candidate <dir>",
            blocked: true,
            details: { path: root },
          })
        : batchFailure("candidate", lastFailure.code, `no readable candidate manifest under ${root}: ${lastFailure.message}`, {
            ...(lastFailure.hint === undefined ? {} : { hint: lastFailure.hint }),
            blocked: true,
            details: { path: root },
          }),
    );
  }
  candidates.sort(
    (left, right) =>
      Date.parse(right.manifest.generatedAt) - Date.parse(left.manifest.generatedAt) ||
      (left.manifestPath < right.manifestPath ? 1 : -1),
  );
  const newest = candidates[0];
  if (newest === undefined) {
    return err(batchFailure("candidate", "not-found", `no candidate manifest under ${root}`, { blocked: true }));
  }
  return ok(newest);
}

/* ------------------------------------------------------------ target package */

export interface TargetPackage {
  readonly path: string;
  readonly name: string;
  readonly version: string;
}

/** The repository root's package.json: the version the working tree declares. */
export async function readTargetPackage(
  fs: Ports["fs"],
  cwd: string,
): Promise<Result<TargetPackage, BatchFailure>> {
  const path = joinFsPath(cwd, "package.json");
  const read = await fs.readJson(path);
  if (!read.ok) {
    return err(
      batchFailure("context", "prerequisite", `could not read ${path}: ${read.error.message}`, {
        hint: "run batch open from the plugin repository root",
        blocked: true,
        details: { path },
      }),
    );
  }
  if (!isRecord(read.value)) {
    return err(
      batchFailure("context", "prerequisite", `${path} is not a JSON object`, {
        hint: "run batch open from the plugin repository root",
        blocked: true,
      }),
    );
  }
  const name = typeof read.value.name === "string" ? read.value.name : null;
  const version = typeof read.value.version === "string" ? read.value.version : null;
  if (name === null || name.length === 0 || version === null || version.length === 0) {
    return err(
      batchFailure("context", "prerequisite", `${path} has no name/version`, {
        hint: "a batch needs the package name and the version it is supposed to verify",
        blocked: true,
      }),
    );
  }
  return ok({ path, name, version });
}

/* ---------------------------------------------------------------- baseline */

/** Read the commit a ref currently points at, via git (no shell interpolation). */
export async function readRefTip(
  ports: Ports,
  cwd: string,
  ref: string,
): Promise<Result<CommitSha, BatchFailure>> {
  const argv = ["git", "rev-parse", "--verify", `${ref}^{commit}`];
  const run = await ports.command.run({ argv, cwd, timeoutMs: 15_000 });
  if (!run.ok) {
    return err(
      batchFailure("baseline", "prerequisite", `git could not run while reading baseline ${describeRef(ref)}: ${run.error.message}`, {
        hint: "install git and run inside the plugin repository",
        blocked: true,
        details: { ref, argv },
      }),
    );
  }
  const outcome = run.value;
  if (outcome.exitCode !== 0) {
    const stderr = outcome.stderr.trim().split(/\r?\n/)[0] ?? "";
    return err(
      batchFailure(
        "baseline",
        "prerequisite",
        `git rev-parse --verify ${ref}^{commit} failed with exit code ${String(outcome.exitCode)}${stderr.length === 0 ? "" : `: ${stderr}`}`,
        {
          hint: `fetch ${describeRef(ref)} locally (git fetch origin ${ref}), or open the batch without --base-ref to record the explicit "no baseline" state`,
          blocked: true,
          details: { ref, exitCode: outcome.exitCode },
        },
      ),
    );
  }
  const tip = parseCommitSha(outcome.stdout.trim());
  if (!tip.ok) {
    return err(
      batchFailure("baseline", "prerequisite", `reading baseline ${describeRef(ref)} printed no full commit sha`, {
        hint: `check that ${describeRef(ref)} names a commit`,
        blocked: true,
        details: { ref, stdout: outcome.stdout.trim().slice(0, 200) },
      }),
    );
  }
  return ok(tip.value);
}

/* ------------------------------------------------------------------ open */

export interface OpenBatchOptions {
  readonly ports: Ports;
  readonly cwd: string;
  readonly workRoot: string;
  /** Raw `--name`; omitted means a timestamped name. */
  readonly name?: string;
  /** Raw `--base-ref`; omitted means the explicit "no baseline" state. */
  readonly baseRef?: string;
  /** Raw `--candidate`; already resolved against the cwd by the caller. */
  readonly candidate?: string;
  readonly allowStale: boolean;
  readonly dryRun: boolean;
  readonly profile: VerificationDeclaration["profile"];
  readonly profileName: ProfileName;
  readonly declaration: VerificationDeclaration;
}

export interface OpenBatchOutcome {
  readonly record: BatchRecord;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly batchDir: string;
  readonly batchFile: string;
  readonly identity: IdentityBinding;
  readonly identityLine: string;
  readonly baseLine: string | null;
  readonly base: BatchBase | null;
  readonly candidate: CandidateIdentity;
  readonly candidatePath: string;
  readonly reused: boolean;
  readonly dryRun: boolean;
  readonly createdAt: string;
  readonly allowStale: boolean;
  readonly notes: readonly string[];
}

interface BatchAnnotations {
  readonly profile: {
    readonly id: string;
    readonly packageName: string;
    readonly defaultProfile: string;
    readonly clientEntry: string;
  };
  readonly declaration: {
    readonly path: string;
    readonly kind: string;
    readonly exportName: string;
    readonly requiredNode: string;
  };
  readonly profileName: string;
  readonly identityLine: string;
  readonly baseLine: string | null;
}

function sameBase(left: BatchBase | null, right: BatchBase | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.ref === right.ref &&
    left.tip === right.tip &&
    left.expectedVersion === right.expectedVersion &&
    left.allowOutdated === right.allowOutdated
  );
}

function sameBatchIdentity(
  existing: BatchRecord,
  name: BatchName,
  startHead: CommitSha,
  base: BatchBase | null,
  candidate: CandidateIdentity,
  allowStale: boolean,
): boolean {
  if (existing.batchName !== name) return false;
  if (existing.startHead !== startHead) return false;
  if (!sameBase(existing.base, base)) return false;
  if (existing.base !== null && existing.base.allowOutdated !== allowStale) return false;
  const existingCandidate = existing.candidate ?? null;
  if (existingCandidate === null) return false;
  return (
    existingCandidate.commit === candidate.commit &&
    existingCandidate.sha256 === candidate.sha256 &&
    existingCandidate.version === candidate.version
  );
}

function describeRecordIdentity(record: BatchRecord): string {
  const base =
    record.base === null ? "no baseline" : `${record.base.ref}@${short(record.base.tip)} (target ${record.base.expectedVersion})`;
  const candidate =
    record.candidate === null || record.candidate === undefined
      ? "no candidate"
      : `${short(record.candidate.commit)} manifest ${short(record.candidate.sha256)}`;
  return `HEAD ${short(record.startHead)}, ${base}, ${candidate}`;
}

/**
 * Open (or idempotently re-open) one batch.
 *
 * Validation order matters for the exit code: a missing candidate or an
 * unreadable baseline is a blocked prerequisite (2), while a candidate that was
 * frozen from a different commit is a provable mismatch (1).
 */
export async function openBatch(options: OpenBatchOptions): Promise<Result<OpenBatchOutcome, BatchFailure>> {
  const { ports, cwd, workRoot } = options;

  const nameResult = options.name === undefined ? defaultBatchName(ports) : parseBatchName(options.name);
  if (!nameResult.ok) {
    return err(
      batchFailure("context", "invalid-input", `batch name is not valid: ${options.name ?? ""}`, {
        hint: "use 1-64 characters from A-Z a-z 0-9 . _ - (at least one letter or digit)",
        blocked: true,
      }),
    );
  }
  const name = nameResult.value;

  const git = await readGitState({ ports, cwd });
  if (!git.ok) {
    return err(
      batchFailure("context", "prerequisite", `could not read the current git HEAD: ${git.error.message}`, {
        hint: "open a batch inside the plugin repository work tree",
        blocked: true,
      }),
    );
  }

  const pkg = await readTargetPackage(ports.fs, cwd);
  if (!pkg.ok) return err(pkg.error);

  const resolved = await resolveCandidate(ports.fs, workRoot, options.candidate);
  if (!resolved.ok) return err(resolved.error);
  const candidate = resolved.value;
  const notes: string[] = [];

  if (candidate.manifest.git.commit !== git.value.commit) {
    return err(
      batchFailure(
        "candidate",
        "identity-mismatch",
        `candidate ${candidate.manifestSha256.slice(0, 12)} was frozen from commit ${candidate.manifest.git.commit}, but HEAD is ${git.value.commit}`,
        {
          hint: "open the batch on the commit the candidate was frozen from, or freeze the current HEAD first",
          details: {
            expected: git.value.commit,
            actual: candidate.manifest.git.commit,
            candidate: candidate.manifestPath,
          },
        },
      ),
    );
  }
  if (candidate.manifest.version !== pkg.value.version) {
    return err(
      batchFailure(
        "candidate",
        "identity-mismatch",
        `candidate version ${candidate.manifest.version} does not match the working tree version ${pkg.value.version}`,
        {
          hint: "the candidate was frozen from another package version; freeze the current tree and open a new batch",
          details: { expected: pkg.value.version, actual: candidate.manifest.version },
        },
      ),
    );
  }
  if (candidate.manifest.validity === "development") {
    notes.push("candidate is a development build (dirty tree); it must not be published");
  }

  let base: BatchBase | null = null;
  if (options.baseRef !== undefined) {
    const tip = await readRefTip(ports, cwd, options.baseRef);
    if (!tip.ok) return err(tip.error);
    base = {
      ref: options.baseRef,
      tip: tip.value,
      expectedVersion: candidate.manifest.version,
      allowOutdated: options.allowStale,
    };
  }

  const identity: IdentityBinding = {
    batchName: name,
    commit: candidate.manifest.git.commit,
    // The identity line names the candidate *package* digest (the tarball), which
    // is what a release check can recompute from candidate.json on another
    // machine. The manifest file digest is a different value: it binds evidence.
    packageSha256: candidate.identity.tgzSha256,
  };
  const identityLine = formatIdentityLine(identity);
  if (!identityLine.ok) {
    return err(
      batchFailure("context", "invalid-input", `could not render the identity line: ${identityLine.error.message}`, {
        blocked: true,
      }),
    );
  }
  const baseLine =
    base === null
      ? null
      : formatBaseLine({ ref: base.ref, tip: base.tip, expectedVersion: base.expectedVersion });
  if (baseLine !== null && !baseLine.ok) {
    return err(
      batchFailure("baseline", "invalid-input", `could not render the base line: ${baseLine.error.message}`, {
        hint: "the ref and the version must be non-empty and space-free",
        blocked: true,
      }),
    );
  }

  const batchDir = batchDirFor(workRoot, name);
  const batchFile = joinFsPath(batchDir, BATCH_RECORD_FILENAME);
  const existing = await loadBatchRecord(ports.fs, batchDir);
  if (existing.ok) {
    if (
      !sameBatchIdentity(existing.value.record, name, candidate.manifest.git.commit, base, candidate.identity, options.allowStale)
    ) {
      return err(
        batchFailure("conflict", "conflict", `batch ${name} already exists with a different identity`, {
          hint: "pick another --name, or delete the stale batch directory if it is no longer needed",
          details: {
            path: existing.value.path,
            existing: describeRecordIdentity(existing.value.record),
            requested: `HEAD ${short(candidate.manifest.git.commit)}, ${
              base === null ? "no baseline" : `${base.ref}@${short(base.tip)} (target ${base.expectedVersion})`
            }, ${short(candidate.identity.commit)} manifest ${short(candidate.identity.sha256)}`,
          },
        }),
      );
    }
    notes.push(`reused the existing batch record at ${batchFile}`);
    return ok({
      record: existing.value.record,
      raw: existing.value.raw,
      batchDir,
      batchFile,
      identity,
      identityLine: identityLine.value,
      baseLine: baseLine === null ? null : baseLine.value,
      base,
      candidate: candidate.identity,
      candidatePath: candidate.manifestPath,
      reused: true,
      dryRun: options.dryRun,
      createdAt: existing.value.record.createdAt,
      allowStale: options.allowStale,
      notes,
    });
  }
  if (existing.error.code !== "not-found") return err(existing.error);

  const createdAt = ports.clock.iso();
  const annotations: BatchAnnotations = {
    profile: {
      id: options.profile.id,
      packageName: options.profile.packageName,
      defaultProfile: options.profile.defaultProfile,
      clientEntry: options.profile.clientEntry,
    },
    declaration: {
      path: options.declaration.path,
      kind: options.declaration.kind,
      exportName: options.declaration.exportName,
      requiredNode: options.declaration.requiredNode,
    },
    profileName: options.profileName,
    identityLine: identityLine.value,
    baseLine: baseLine === null ? null : baseLine.value,
  };
  const recordValue: Record<string, unknown> = {
    schemaVersion: BATCH_SCHEMA_VERSION,
    batchName: name,
    batchDir,
    createdAt,
    updatedAt: createdAt,
    status: base !== null && base.allowOutdated ? "stale" : "active",
    startHead: git.value.commit,
    startBranch: git.value.branch,
    base,
    candidate: candidate.identity,
    preflightOk: true,
    ...annotations,
  };

  const parsed = parseBatchRecord(recordValue);
  if (!parsed.ok) {
    return err(
      batchFailure("record", "internal", `the batch record this tool built is not valid: ${parsed.error.message}`, {
        hint: "this is a bug; please report the batch open output",
        blocked: true,
      }),
    );
  }

  if (!options.dryRun) {
    const made = await ports.fs.makeDir(batchDir);
    if (!made.ok) {
      return err(
        batchFailure("io", "io", `could not create the batch directory ${batchDir}: ${made.error.message}`, {
          blocked: true,
          details: { path: batchDir },
        }),
      );
    }
    const written = await ports.fs.writeText(batchFile, `${JSON.stringify(recordValue, null, 2)}\n`);
    if (!written.ok) {
      return err(
        batchFailure("io", "io", `could not write ${batchFile}: ${written.error.message}`, {
          blocked: true,
          details: { path: batchFile },
        }),
      );
    }
  } else {
    notes.push("dry run: batch.json was not written");
  }

  return ok({
    record: parsed.value,
    raw: recordValue,
    batchDir,
    batchFile,
    identity,
    identityLine: identityLine.value,
    baseLine: baseLine === null ? null : baseLine.value,
    base,
    candidate: candidate.identity,
    candidatePath: candidate.manifestPath,
    reused: false,
    dryRun: options.dryRun,
    createdAt,
    allowStale: options.allowStale,
    notes,
  });
}

/* ---------------------------------------------------------------- evidence */

export type EvidenceRejectionReason =
  | "batch-name"
  | "candidate-missing"
  | "batch-candidate-missing"
  | "candidate-batch-name"
  | "candidate-commit"
  | "candidate-package-sha256"
  | "manifest-invalid"
  | "manifest-unreadable";

export interface EvidenceBindingEntry {
  readonly path: string;
  /** Path relative to the batch directory, `/`-separated, for the report. */
  readonly relativePath: string;
  readonly status: "bound" | "rejected";
  readonly reason: EvidenceRejectionReason | null;
  readonly batchName: string | null;
  readonly commit: string | null;
  readonly packageSha256: string | null;
  readonly message: string | null;
  readonly expected: string | null;
  readonly actual: string | null;
  readonly hint: string | null;
}

export interface EvidenceScan {
  readonly root: string;
  readonly readable: boolean;
  readonly scanned: number;
  readonly bound: readonly EvidenceBindingEntry[];
  readonly rejected: readonly EvidenceBindingEntry[];
}

async function findEvidenceManifests(
  fs: Ports["fs"],
  root: string,
): Promise<{ readonly readable: boolean; readonly paths: readonly string[] }> {
  const paths: string[] = [];
  const stack: { readonly path: string; readonly depth: number }[] = [{ path: root, depth: 0 }];
  let readable = false;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const listed = await fs.list(current.path);
    if (!listed.ok) {
      if (current.depth === 0) return { readable: false, paths: [] };
      continue;
    }
    readable = true;
    for (const entry of listed.value) {
      const child = joinFsPath(current.path, entry.name);
      if (entry.kind === "directory") {
        if (current.depth >= EVIDENCE_SCAN_DEPTH) continue;
        if (entry.name === "files" || entry.name === ".git") continue;
        stack.push({ path: child, depth: current.depth + 1 });
      } else if (entry.name === EVIDENCE_MANIFEST_FILENAME) {
        paths.push(child);
      }
    }
  }
  return { readable, paths: paths.sort() };
}

function invalidEntry(
  path: string,
  relativePath: string,
  reason: EvidenceRejectionReason,
  message: string,
): EvidenceBindingEntry {
  return {
    path,
    relativePath,
    status: "rejected",
    reason,
    batchName: null,
    commit: null,
    packageSha256: null,
    message,
    expected: "an evidence.json written by dsh-verify evidence add",
    actual: message,
    hint: "delete the unreadable file or regenerate it through the tool",
  };
}

function bindOne(
  record: BatchRecord,
  manifest: EvidenceManifest,
  path: string,
  relativePath: string,
): EvidenceBindingEntry {
  const candidate = manifest.candidate === undefined || !isRecord(manifest.candidate) ? null : manifest.candidate;
  const batchName =
    candidate !== null && typeof candidate.batchName === "string" ? candidate.batchName : null;
  const commit = candidate !== null && typeof candidate.commit === "string" ? candidate.commit : null;
  const packageSha256 =
    candidate !== null && typeof candidate.packageSha256 === "string" ? candidate.packageSha256 : null;

  const verdict = judgeEvidenceBinding({
    record,
    meta: {
      batchName: manifest.batch.name,
      ...(candidate === null
        ? {}
        : {
            candidate: {
              ...(batchName === null ? {} : { batchName }),
              ...(commit === null ? {} : { commit }),
              ...(packageSha256 === null ? {} : { packageSha256 }),
            },
          }),
    },
  });
  const entry: EvidenceBindingEntry = {
    path,
    relativePath,
    status: "bound",
    reason: null,
    batchName: manifest.batch.name,
    commit,
    packageSha256,
    message: null,
    expected: null,
    actual: null,
    hint: null,
  };
  if (verdict.ok) return entry;

  const recordCandidate = record.candidate ?? null;
  let reason: EvidenceRejectionReason;
  let expected: string;
  let actual: string;
  if (manifest.batch.name !== record.batchName) {
    reason = "batch-name";
    expected = record.batchName;
    actual = manifest.batch.name;
  } else if (candidate === null) {
    reason = "candidate-missing";
    expected =
      recordCandidate === null
        ? `batch ${record.batchName}`
        : `${recordCandidate.commit} / ${recordCandidate.sha256}`;
    actual = "evidence.json carries no candidate object";
  } else if (recordCandidate === null) {
    reason = "batch-candidate-missing";
    expected = "a frozen candidate in batch.json";
    actual = "batch.json candidate is null";
  } else if (batchName !== null && batchName !== record.batchName) {
    reason = "candidate-batch-name";
    expected = record.batchName;
    actual = batchName;
  } else if (commit !== recordCandidate.commit) {
    reason = "candidate-commit";
    expected = recordCandidate.commit;
    actual = commit ?? "(missing)";
  } else {
    reason = "candidate-package-sha256";
    expected = recordCandidate.sha256;
    actual = packageSha256 ?? "(missing)";
  }
  return {
    ...entry,
    status: "rejected",
    reason,
    message: verdict.error.message,
    expected,
    actual,
    hint: verdict.error.hint ?? null,
  };
}

/** Walk the batch directory and bind every `evidence.json` to the record. */
export async function scanBatchEvidence(
  fs: Ports["fs"],
  batchDir: string,
  record: BatchRecord,
): Promise<EvidenceScan> {
  const found = await findEvidenceManifests(fs, batchDir);
  if (!found.readable) {
    return { root: batchDir, readable: false, scanned: 0, bound: [], rejected: [] };
  }
  const bound: EvidenceBindingEntry[] = [];
  const rejected: EvidenceBindingEntry[] = [];
  for (const path of found.paths) {
    const relativePath = toPosixPath(relativeTo(batchDir, path));
    const text = await fs.readText(path);
    if (!text.ok) {
      rejected.push(
        invalidEntry(path, relativePath, "manifest-unreadable", `could not read the manifest: ${text.error.message}`),
      );
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(text.value);
    } catch (error) {
      rejected.push(
        invalidEntry(path, relativePath, "manifest-invalid", `not valid JSON: ${(error as Error).message}`),
      );
      continue;
    }
    const manifest = validateEvidenceManifest(value);
    if (!manifest.ok) {
      rejected.push(
        invalidEntry(
          path,
          relativePath,
          "manifest-invalid",
          `not a valid evidence manifest: ${manifest.error.message}`,
        ),
      );
      continue;
    }
    const entry = bindOne(record, manifest.value, path, relativePath);
    if (entry.status === "bound") bound.push(entry);
    else rejected.push(entry);
  }
  return { root: batchDir, readable: true, scanned: found.paths.length, bound, rejected };
}

/* ---------------------------------------------------------------- checking */

export type BatchCheckReason =
  | FreshnessProblemCode
  | "git-unreadable"
  | "evidence-binding"
  | "evidence-scan"
  | "no-evidence"
  | "record-invalid"
  | "record-write";

/** A check plus the machine-readable reason the CLI prints alongside it. */
export interface BatchCheck extends CheckResult {
  readonly reason: BatchCheckReason | null;
}

export const CHECK_HEAD_FRESH = checkId("batch-head-fresh");
export const CHECK_BASELINE_FRESH = checkId("batch-baseline-fresh");
export const CHECK_EVIDENCE_BOUND = checkId("batch-evidence-bound");
export const CHECK_BATCH_RECORD = checkId("batch-record");

const TITLE_HEAD = "the batch still starts at the current HEAD";
const TITLE_BASELINE = "the baseline ref still points where the batch opened";
const TITLE_EVIDENCE = "every evidence manifest belongs to this batch's candidate";
const TITLE_RECORD = "the batch record could be read and updated";

interface BatchCheckDraft {
  readonly id: CheckId;
  readonly title: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly reason: BatchCheckReason | null;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
}

function toCheck(draft: BatchCheckDraft): BatchCheck {
  return {
    id: draft.id,
    title: draft.title,
    hard: true,
    status: draft.status,
    detail: draft.detail,
    ...(draft.expected === undefined ? {} : { expected: draft.expected }),
    ...(draft.actual === undefined ? {} : { actual: draft.actual }),
    ...(draft.hint === undefined ? {} : { hint: draft.hint }),
    evidence: [],
    durationMs: 0,
    reason: draft.reason,
  };
}

function evidenceCheck(scan: EvidenceScan, record: BatchRecord): BatchCheck {
  const candidate = record.candidate ?? null;
  const expected =
    candidate === null
      ? `evidence bound to batch ${record.batchName} (the record has no candidate)`
      : `batch ${record.batchName} / commit ${candidate.commit} / manifest sha256 ${candidate.sha256}`;

  if (!scan.readable) {
    return toCheck({
      id: CHECK_EVIDENCE_BOUND,
      title: TITLE_EVIDENCE,
      status: "blocked",
      detail: `could not list the batch directory ${scan.root}, so no evidence manifest was inspected`,
      reason: "evidence-scan",
      expected: "a readable batch directory",
      actual: "listing the batch directory failed",
      hint: "check that the batch directory still exists and is readable",
    });
  }
  if (scan.scanned === 0) {
    return toCheck({
      id: CHECK_EVIDENCE_BOUND,
      title: TITLE_EVIDENCE,
      status: "skip",
      detail: `no evidence.json under ${scan.root}; nothing to bind yet`,
      reason: "no-evidence",
      expected,
    });
  }
  if (scan.rejected.length === 0) {
    return toCheck({
      id: CHECK_EVIDENCE_BOUND,
      title: TITLE_EVIDENCE,
      status: "pass",
      detail: `${scan.scanned} evidence manifest(s) belong to this batch (${short(candidate?.commit ?? record.startHead)}; manifest ${short(candidate?.sha256 ?? "")})`,
      reason: null,
      expected,
      actual: `${scan.scanned}/${scan.scanned} bound`,
    });
  }
  const names = scan.rejected
    .map((entry) => `${entry.relativePath} (${entry.reason ?? "unknown"})`)
    .join("; ");
  const details = scan.rejected
    .map(
      (entry) =>
        `${entry.relativePath} (${entry.reason ?? "unknown"}): expected ${entry.expected ?? "(unknown)"}, actual ${entry.actual ?? "(unknown)"}`,
    )
    .join("; ");
  return toCheck({
    id: CHECK_EVIDENCE_BOUND,
    title: TITLE_EVIDENCE,
    status: "fail",
    detail: `${scan.rejected.length}/${scan.scanned} evidence manifest(s) do not belong to this batch: ${names}`,
    reason: "evidence-binding",
    expected,
    actual: details,
    hint: "only evidence collected with --batch of this batch and this candidate is counted; re-collect it or move the foreign manifest out of the batch directory",
  });
}

function problemOf(verdict: FreshnessVerdict, code: FreshnessProblemCode): FreshnessProblem | undefined {
  return verdict.problems.find((problem) => problem.code === code);
}

export interface CheckBatchOptions {
  readonly ports: Ports;
  readonly cwd: string;
  readonly workRoot: string;
  /** Raw `--name`; omitted means the newest batch record. */
  readonly name?: string;
  readonly allowStale: boolean;
  readonly dryRun: boolean;
}

export interface CheckBatchOutcome {
  readonly record: BatchRecord;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly batchDir: string;
  readonly batchFile: string;
  readonly identityLine: string;
  readonly baseLine: string | null;
  readonly checks: readonly BatchCheck[];
  readonly freshness: FreshnessVerdict | null;
  readonly evidence: EvidenceScan;
  readonly exitCode: 0 | 1 | 2;
  readonly allowedStale: boolean;
  readonly notes: readonly string[];
}

/**
 * Judge whether the batch still describes the tree, then bind its evidence.
 *
 * A tolerated staleness (explicit `--allow-stale`, or a baseline that was already
 * allowed when the batch opened) is reported as `skip` with the flag named in the
 * detail — never as `pass` and never silently. `--allow-stale` does not excuse an
 * unreadable baseline: an unreadable ref is not an unchanged ref.
 */
export async function checkBatch(options: CheckBatchOptions): Promise<Result<CheckBatchOutcome, BatchFailure>> {
  const { ports, workRoot } = options;
  const loaded = await resolveBatchForStatus(ports.fs, workRoot, options.name);
  if (!loaded.ok) return err(loaded.error);
  const record = loaded.value.record;
  const checkedAt = ports.clock.iso();
  const notes: string[] = [];

  const git = await readGitState({ ports, cwd: options.cwd });
  if (!git.ok) {
    notes.push(
      `could not read git HEAD (${git.error.message}); batch-head-fresh is blocked and the record status was left unchanged`,
    );
  }
  // When HEAD is unreadable the verdict is only used for its baseline problems;
  // the head check is built from the failure below and never claims a pass.
  const currentHead: CommitSha = git.ok ? git.value.commit : record.startHead;

  let baseTipNow: CommitSha | null = null;
  let baseReadError: string | undefined;
  if (record.base !== null && !record.base.allowOutdated) {
    const tip = await readRefTip(ports, options.cwd, record.base.ref);
    if (tip.ok) baseTipNow = tip.value;
    else baseReadError = tip.error.message;
  }

  const verdict = judgeFreshness(
    {
      record,
      currentHead,
      baseTipNow,
      ...(baseReadError === undefined ? {} : { baseReadError }),
    },
    checkedAt,
  );

  const checks: BatchCheck[] = [];

  const headProblem = problemOf(verdict, "head-moved");
  if (!git.ok) {
    checks.push(
      toCheck({
        id: CHECK_HEAD_FRESH,
        title: TITLE_HEAD,
        status: "blocked",
        detail: `git HEAD is unreadable, so the batch start ${short(record.startHead)} cannot be confirmed: ${git.error.message}`,
        reason: "git-unreadable",
        expected: record.startHead,
        actual: "git HEAD unreadable",
        hint: git.error.hint ?? "restore git access to this work tree",
      }),
    );
  } else if (headProblem !== undefined) {
    checks.push(
      toCheck({
        id: CHECK_HEAD_FRESH,
        title: TITLE_HEAD,
        status: options.allowStale ? "skip" : "fail",
        detail: options.allowStale ? `--allow-stale was given: ${headProblem.message}` : headProblem.message,
        reason: "head-moved",
        expected: record.startHead,
        actual: git.value.commit,
        ...(headProblem.hint === undefined ? {} : { hint: headProblem.hint }),
      }),
    );
    if (options.allowStale) {
      notes.push("--allow-stale: the moved HEAD is reported as skip, not fail (the batch record stays stale)");
    }
  } else {
    checks.push(
      toCheck({
        id: CHECK_HEAD_FRESH,
        title: TITLE_HEAD,
        status: "pass",
        detail: `HEAD is still ${short(record.startHead)}`,
        reason: null,
        expected: record.startHead,
        actual: git.value.commit,
      }),
    );
  }

  const base = record.base;
  if (base === null) {
    const noBaseline = problemOf(verdict, "no-baseline");
    checks.push(
      toCheck({
        id: CHECK_BASELINE_FRESH,
        title: TITLE_BASELINE,
        status: "blocked",
        detail: `${noBaseline?.message ?? "batch recorded no baseline ref"}; this is the explicit "no baseline" state, not "no check needed"`,
        reason: "no-baseline",
        expected: "a baseline ref recorded when the batch opened",
        actual: "base: null (explicit none)",
        ...(noBaseline?.hint === undefined ? {} : { hint: noBaseline.hint }),
      }),
    );
  } else if (base.allowOutdated) {
    const outdated = problemOf(verdict, "outdated-base-allowed");
    checks.push(
      toCheck({
        id: CHECK_BASELINE_FRESH,
        title: TITLE_BASELINE,
        status: "skip",
        detail: `${
          outdated?.message ?? `batch was opened with --allow-stale against ${base.ref} ${short(base.tip)}`
        }; the allowance is recorded in batch.json and reported here`,
        reason: "outdated-base-allowed",
        expected: `baseline ${base.ref} at ${base.tip}`,
        actual: "outdated base allowed when the batch opened",
        ...(outdated?.hint === undefined ? {} : { hint: outdated.hint }),
      }),
    );
  } else {
    const unreadable = problemOf(verdict, "baseline-unreadable");
    const advanced = problemOf(verdict, "baseline-advanced");
    if (unreadable !== undefined) {
      checks.push(
        toCheck({
          id: CHECK_BASELINE_FRESH,
          title: TITLE_BASELINE,
          status: "fail",
          detail: unreadable.message,
          reason: "baseline-unreadable",
          expected: base.tip,
          actual: baseReadError ?? "the ref did not resolve to a commit",
          ...(unreadable.hint === undefined ? {} : { hint: unreadable.hint }),
        }),
      );
    } else if (advanced !== undefined) {
      checks.push(
        toCheck({
          id: CHECK_BASELINE_FRESH,
          title: TITLE_BASELINE,
          status: options.allowStale ? "skip" : "fail",
          detail: options.allowStale ? `--allow-stale was given: ${advanced.message}` : advanced.message,
          reason: "baseline-advanced",
          expected: base.tip,
          actual: baseTipNow ?? "unknown",
          ...(advanced.hint === undefined ? {} : { hint: advanced.hint }),
        }),
      );
      if (options.allowStale) {
        notes.push("--allow-stale: the advanced baseline is reported as skip, not fail (the batch record stays stale)");
      }
    } else {
      checks.push(
        toCheck({
          id: CHECK_BASELINE_FRESH,
          title: TITLE_BASELINE,
          status: "pass",
          detail: `baseline ${base.ref} is still at ${short(base.tip)}`,
          reason: null,
          expected: base.tip,
          actual: baseTipNow ?? base.tip,
        }),
      );
    }
  }

  const evidence = await scanBatchEvidence(ports.fs, loaded.value.batchDir, record);
  checks.push(evidenceCheck(evidence, record));

  let finalRecord = record;
  const nextRaw: Record<string, unknown> = {
    ...loaded.value.raw,
    endCheckedAt: checkedAt,
    updatedAt: checkedAt,
  };
  if (git.ok) {
    nextRaw.status = verdict.status;
    nextRaw.endHead = git.value.commit;
  } else {
    notes.push("the batch record status was left untouched because HEAD could not be read");
  }

  if (!options.dryRun) {
    const nextRecord = parseBatchRecord(nextRaw);
    if (!nextRecord.ok) {
      checks.push(
        toCheck({
          id: CHECK_BATCH_RECORD,
          title: TITLE_RECORD,
          status: "fail",
          detail: `the updated batch record would not be readable: ${nextRecord.error.message}`,
          reason: "record-invalid",
          expected: "a batch.json this version can parse",
          actual: "the update was rejected by parseBatchRecord",
          ...(nextRecord.error.hint === undefined ? {} : { hint: nextRecord.error.hint }),
        }),
      );
    } else {
      finalRecord = nextRecord.value;
      const written = await ports.fs.writeText(
        loaded.value.path,
        `${JSON.stringify(nextRaw, null, 2)}\n`,
      );
      if (!written.ok) {
        checks.push(
          toCheck({
            id: CHECK_BATCH_RECORD,
            title: TITLE_RECORD,
            status: "fail",
            detail: `could not write the batch status back to ${loaded.value.path}: ${written.error.message}`,
            reason: "record-write",
            expected: `status ${verdict.status} persisted in batch.json`,
            actual: "the write failed",
            ...(written.error.hint === undefined ? {} : { hint: written.error.hint }),
          }),
        );
      }
    }
  } else {
    notes.push("dry run: batch.json was not updated");
  }

  return ok({
    record: finalRecord,
    raw: nextRaw,
    batchDir: loaded.value.batchDir,
    batchFile: loaded.value.path,
    identityLine: identityLineOf(finalRecord),
    baseLine: baseLineOf(finalRecord),
    checks,
    freshness: verdict,
    evidence,
    exitCode: decideExitCode(checks),
    allowedStale: options.allowStale,
    notes,
  });
}

function baseLineOf(record: BatchRecord): string | null {
  if (record.base === null) return null;
  const line = formatBaseLine({
    ref: record.base.ref,
    tip: record.base.tip,
    expectedVersion: record.base.expectedVersion,
  });
  return line.ok ? line.value : null;
}

function identityLineOf(record: BatchRecord): string {
  if (record.candidate === null || record.candidate === undefined) return "";
  const line = formatIdentityLine({
    batchName: record.batchName,
    commit: record.candidate.commit,
    // The tarball digest, not the manifest file digest; see `openBatch`.
    packageSha256: record.candidate.tgzSha256,
  });
  return line.ok ? line.value : "";
}

/* ------------------------------------------------------- evidence context */

/** The batch context `evidence add` needs to stamp the identity triple. */
export interface BatchEvidenceContext {
  readonly batchName: BatchName;
  readonly batchDir: string;
  readonly workRoot: string;
  readonly candidate: Readonly<Record<string, unknown>>;
}

export interface BatchContextArgs {
  /** Raw `--batch` (preferred) or `--name`. */
  readonly batch?: string;
  readonly name?: string;
  readonly workRoot?: string;
}

export interface BatchContextDeps {
  readonly ports: Pick<Ports, "fs">;
  readonly cwd: string;
}

/**
 * Resolve the batch an evidence command is writing into.
 *
 * `ok(null)` when no batch was named: `evidence add` keeps its own default in that
 * case. A named batch with no record, or with no frozen candidate, is a blocked
 * prerequisite — writing evidence there could never be bound later.
 */
export async function loadBatchContextForEvidence(
  args: BatchContextArgs,
  deps: BatchContextDeps,
): Promise<Result<BatchEvidenceContext | null, BatchFailure>> {
  const raw = args.batch ?? args.name;
  if (raw === undefined) return ok(null);
  const name = parseBatchName(raw);
  if (!name.ok) {
    return err(
      batchFailure("context", "invalid-input", `--batch is not a valid batch name: ${raw}`, {
        hint: "use the name batch open printed; 1-64 characters from A-Z a-z 0-9 . _ -",
        blocked: true,
      }),
    );
  }
  const workRoot = resolveWorkRoot(deps.cwd, args.workRoot);
  const batchDir = batchDirFor(workRoot, name.value);
  const loaded = await loadBatchRecord(deps.ports.fs, batchDir);
  if (!loaded.ok) return err(loaded.error);
  const candidate = loaded.value.record.candidate ?? null;
  if (candidate === null) {
    return err(
      batchFailure(
        "record",
        "prerequisite",
        `batch ${name.value} has no candidate identity, so evidence cannot be bound to it`,
        {
          hint: "freeze a candidate and open the batch with --candidate before collecting evidence",
          blocked: true,
          details: { batchDir },
        },
      ),
    );
  }
  return ok({
    batchName: name.value,
    batchDir,
    workRoot,
    candidate: {
      batchName: name.value,
      commit: candidate.commit,
      packageSha256: candidate.sha256,
      version: candidate.version,
      tgzSha256: candidate.tgzSha256,
    },
  });
}
