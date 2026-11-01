/**
 * Candidate rules: what "the build under verification" means, and when it is
 * disqualified.
 *
 * A candidate is a frozen description of one build: commit, version, the npm
 * tarball, and the digest of every file inside it. The batch that verifies it
 * records that description, and every later step re-derives it from disk. The
 * point is not bookkeeping — it is that a report saying "version 1.9.0 passed"
 * is unfalsifiable, while a report naming a commit and a package digest can be
 * checked by someone who was not there.
 *
 * Everything here takes *facts*, never a port: the caller reads git and the disk,
 * these functions decide. That is what makes the rules testable and what keeps a
 * verification machine's local state out of the verdict.
 */
import type { CommitSha, Sha256Hex } from "./branding";
import { parseCommitSha, parseSha256Hex } from "./branding";
import { err, ok, type Result } from "./result";
import type { VerificationBase } from "./identity";

/** The manifest schema this package understands. A different number is rejected loudly. */
export const CANDIDATE_SCHEMA_VERSION = 2;

/** One file inside the published tarball, with the digest measured at freeze time. */
export interface CandidatePackageFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256Hex;
}

/** The frozen build description written to `candidate.json`. */
export interface CandidateManifest {
  readonly schemaVersion: typeof CANDIDATE_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly tool: string;
  readonly version: string;
  /**
   * `release` only when the working tree was clean; a dirty build is `development`
   * and must never be published by accident.
   */
  readonly validity: "release" | "development";
  /** True only when HEAD and the dirty set were unchanged across the whole build. */
  readonly sourceStable: boolean;
  readonly git: {
    readonly commit: CommitSha;
    readonly branch: string;
    readonly dirty: boolean;
  };
  readonly package: {
    readonly tgzPath: string;
    readonly tgzBytes: number;
    readonly tgzSha256: Sha256Hex;
    readonly filename: string;
    readonly npmShasum?: string;
    readonly npmIntegrity?: string;
    readonly files: readonly CandidatePackageFile[];
    readonly fileCount: number;
    /** Digest over `files` (path + sha256), independent of the tarball packaging. */
    readonly fileDigest: Sha256Hex;
    /** Digest over the canonical manifest, used to notice unreproducible rebuilds. */
    readonly manifestDigest: Sha256Hex;
    /** Commit compiled into the client bundle; must equal `git.commit` when present. */
    readonly buildCommit?: CommitSha | null;
  };
}

/** The identity a batch stores: enough to recognize the candidate without the manifest. */
export interface CandidateIdentity {
  /** Path to `candidate.json`. */
  readonly path: string;
  /** sha256 of the manifest file itself, so a rewritten manifest is detectable. */
  readonly sha256: Sha256Hex;
  readonly commit: CommitSha;
  readonly version: string;
  readonly validity: "release" | "development";
  readonly tgzPath: string;
  readonly tgzSha256: Sha256Hex;
  readonly fileDigest: Sha256Hex;
  readonly manifestDigest: Sha256Hex;
}

/** Why a candidate is unusable. Codes are stable; messages are for humans. */
export type CandidateProblemCode =
  | "schema-version"
  | "invalid-shape"
  | "not-in-batch-dir"
  | "older-than-batch"
  | "head-mismatch"
  | "build-commit-mismatch"
  | "source-unstable"
  | "invalid-validity"
  | "tgz-missing"
  | "tgz-hash-mismatch"
  | "file-digest-mismatch"
  | "file-list-mismatch"
  | "commit-not-contains-base"
  | "version-mismatch";

export interface CandidateProblem {
  readonly code: CandidateProblemCode;
  readonly message: string;
  readonly hint?: string;
}

export interface CandidateVerdict {
  readonly ok: boolean;
  readonly identity: CandidateIdentity;
  readonly problems: readonly CandidateProblem[];
}

/* ------------------------------------------------------------------ parsing */

function invalid(message: string, hint?: string): Result<never> {
  return err({ code: "invalid-input", message, ...(hint === undefined ? {} : { hint }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSha(value: unknown, field: string): Result<Sha256Hex> {
  const parsed = parseSha256Hex(value);
  if (!parsed.ok) {
    return invalid(`${field} must be a 64-character lowercase hex digest, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

function readCommit(value: unknown, field: string): Result<CommitSha> {
  const parsed = parseCommitSha(value);
  if (!parsed.ok) {
    return invalid(`${field} must be a 40-character lowercase hex commit, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

/** Validate a `candidate.json` read from disk. Never trusts a field it does not name. */
export function parseCandidateManifest(value: unknown): Result<CandidateManifest> {
  if (!isRecord(value)) return invalid("candidate manifest must be a JSON object");
  if (value.schemaVersion !== CANDIDATE_SCHEMA_VERSION) {
    return invalid(
      `candidate manifest schemaVersion ${JSON.stringify(value.schemaVersion)} is not ${CANDIDATE_SCHEMA_VERSION}`,
      "re-freeze the candidate with this version of the tool instead of reusing an old file",
    );
  }
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) {
    return invalid("candidate manifest generatedAt must be an ISO timestamp");
  }
  if (typeof value.version !== "string" || value.version.length === 0) {
    return invalid("candidate manifest version must be a non-empty string");
  }
  if (value.validity !== "release" && value.validity !== "development") {
    return invalid(`candidate manifest validity ${JSON.stringify(value.validity)} must be "release" or "development"`);
  }
  if (typeof value.sourceStable !== "boolean") {
    return invalid("candidate manifest sourceStable must be a boolean");
  }

  if (!isRecord(value.git)) return invalid("candidate manifest git must be an object");
  const commit = readCommit(value.git.commit, "git.commit");
  if (!commit.ok) return commit;
  if (typeof value.git.branch !== "string") return invalid("candidate manifest git.branch must be a string");
  if (typeof value.git.dirty !== "boolean") return invalid("candidate manifest git.dirty must be a boolean");

  if (!isRecord(value.package)) return invalid("candidate manifest package must be an object");
  const pkg = value.package;
  if (typeof pkg.tgzPath !== "string" || pkg.tgzPath.length === 0) return invalid("package.tgzPath must be a non-empty string");
  if (typeof pkg.filename !== "string" || !pkg.filename.endsWith(".tgz")) {
    return invalid(`package.filename ${JSON.stringify(pkg.filename)} must end with .tgz`);
  }
  if (!Number.isInteger(pkg.tgzBytes) || (pkg.tgzBytes as number) <= 0) {
    return invalid("package.tgzBytes must be a positive integer");
  }
  const tgzSha = readSha(pkg.tgzSha256, "package.tgzSha256");
  if (!tgzSha.ok) return tgzSha;
  const fileDigest = readSha(pkg.fileDigest, "package.fileDigest");
  if (!fileDigest.ok) return fileDigest;
  const manifestDigest = readSha(pkg.manifestDigest, "package.manifestDigest");
  if (!manifestDigest.ok) return manifestDigest;

  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    return invalid("package.files must be a non-empty array", "an empty file list proves nothing about the build");
  }
  const files: CandidatePackageFile[] = [];
  for (const [index, entry] of pkg.files.entries()) {
    if (!isRecord(entry)) return invalid(`package.files[${index}] must be an object`);
    if (typeof entry.path !== "string" || entry.path.length === 0 || entry.path.includes("\\")) {
      return invalid(`package.files[${index}].path must be a non-empty /-separated path`);
    }
    if (!Number.isInteger(entry.bytes) || (entry.bytes as number) < 0) {
      return invalid(`package.files[${index}].bytes must be a non-negative integer`);
    }
    const sha = readSha(entry.sha256, `package.files[${index}].sha256`);
    if (!sha.ok) return sha;
    files.push({ path: entry.path, bytes: entry.bytes as number, sha256: sha.value });
  }
  if (Number.isInteger(pkg.fileCount) && pkg.fileCount !== files.length) {
    return invalid(`package.fileCount ${String(pkg.fileCount)} does not match package.files length ${files.length}`);
  }

  let buildCommit: CommitSha | null = null;
  if (pkg.buildCommit !== undefined && pkg.buildCommit !== null) {
    const parsed = readCommit(pkg.buildCommit, "package.buildCommit");
    if (!parsed.ok) return parsed;
    buildCommit = parsed.value;
  }

  const manifest: CandidateManifest = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    tool: typeof value.tool === "string" ? value.tool : "unknown",
    version: value.version,
    validity: value.validity,
    sourceStable: value.sourceStable,
    git: { commit: commit.value, branch: value.git.branch, dirty: value.git.dirty },
    package: {
      tgzPath: pkg.tgzPath,
      tgzBytes: pkg.tgzBytes as number,
      tgzSha256: tgzSha.value,
      filename: pkg.filename,
      files,
      fileCount: files.length,
      fileDigest: fileDigest.value,
      manifestDigest: manifestDigest.value,
      buildCommit,
      ...(typeof pkg.npmShasum === "string" ? { npmShasum: pkg.npmShasum } : {}),
      ...(typeof pkg.npmIntegrity === "string" ? { npmIntegrity: pkg.npmIntegrity } : {}),
    },
  };
  return ok(manifest);
}

/** The batch-facing identity of a parsed manifest. */
export function candidateIdentityOf(
  manifest: CandidateManifest,
  manifestPath: string,
  manifestSha256: Sha256Hex,
): CandidateIdentity {
  return {
    path: manifestPath,
    sha256: manifestSha256,
    commit: manifest.git.commit,
    version: manifest.version,
    validity: manifest.validity,
    tgzPath: manifest.package.tgzPath,
    tgzSha256: manifest.package.tgzSha256,
    fileDigest: manifest.package.fileDigest,
    manifestDigest: manifest.package.manifestDigest,
  };
}

/* ------------------------------------------------------------------ judging */

/**
 * Everything the rules may look at. The caller measures these; `null` means
 * "could not determine", which is treated as a problem rather than as a pass.
 */
export interface CandidateFacts {
  readonly manifest: CandidateManifest;
  readonly identity: CandidateIdentity;
  readonly manifestPath: string;
  readonly batchDir: string;
  readonly generatedAtMs: number;
  readonly batchStartedAtMs: number;
  readonly currentHead: CommitSha;
  /** Baseline the batch was opened against; `null` means the batch recorded none. */
  readonly base: VerificationBase | null;
  /** True when `commit` is an ancestor of (or equal to) the baseline tip. */
  readonly commitContainsBase: boolean | null;
  /** Version currently declared by the baseline ref, when readable. */
  readonly expectedVersion: string | null;
  readonly tgzOnDisk: { readonly exists: boolean; readonly sha256: Sha256Hex | null };
  /** Digest recomputed from the manifest's own `files` list. */
  readonly recomputedFileDigest: Sha256Hex | null;
}

function problem(code: CandidateProblemCode, message: string, hint?: string): CandidateProblem {
  return { code, message, ...(hint === undefined ? {} : { hint }) };
}

/**
 * Decide whether the candidate may represent the batch. Order matters: earlier
 * problems explain later ones, so a reader gets the root cause first.
 */
export function judgeCandidate(facts: CandidateFacts): CandidateVerdict {
  const problems: CandidateProblem[] = [];
  const { manifest, identity } = facts;

  const insideBatch = isPathInside(facts.manifestPath, facts.batchDir);
  if (!insideBatch) {
    problems.push(
      problem(
        "not-in-batch-dir",
        `candidate ${facts.manifestPath} is not inside the batch directory ${facts.batchDir}`,
        "copying a candidate from the previous batch makes this batch's identity ambiguous",
      ),
    );
  }
  if (facts.generatedAtMs < facts.batchStartedAtMs) {
    problems.push(
      problem(
        "older-than-batch",
        "candidate was generated before this batch was opened",
        "re-freeze so the build is known to come from the code under verification",
      ),
    );
  }
  if (manifest.git.commit !== facts.currentHead) {
    problems.push(
      problem(
        "head-mismatch",
        `candidate commit ${manifest.git.commit} is not the current HEAD ${facts.currentHead}`,
        "check out the commit under verification, or freeze again",
      ),
    );
  }
  if (manifest.package.buildCommit !== null && manifest.package.buildCommit !== manifest.git.commit) {
    problems.push(
      problem(
        "build-commit-mismatch",
        `built client declares commit ${manifest.package.buildCommit}, source commit is ${manifest.git.commit}`,
        "rebuild with a forced rebuild; a cached artifact from an earlier commit is not this candidate",
      ),
    );
  }
  if (!manifest.sourceStable) {
    problems.push(
      problem(
        "source-unstable",
        "HEAD or the dirty set changed while the package was being built",
        "freeze again without editing the tree",
      ),
    );
  }
  if (facts.base !== null) {
    if (facts.commitContainsBase === null) {
      problems.push(
        problem(
          "commit-not-contains-base",
          "could not determine whether the candidate descends from the baseline",
          "fetch the baseline ref locally first",
        ),
      );
    } else if (!facts.commitContainsBase) {
      problems.push(
        problem(
          "commit-not-contains-base",
          `candidate commit ${manifest.git.commit} does not contain baseline ${facts.base.ref} (${facts.base.tip})`,
          "rebase or merge the baseline, then freeze again; an outdated base silently verifies old code",
        ),
      );
    }
    if (facts.expectedVersion !== null && manifest.version !== facts.expectedVersion) {
      problems.push(
        problem(
          "version-mismatch",
          `candidate version ${manifest.version} does not match baseline version ${facts.expectedVersion}`,
          "bump the version on the branch under verification, not inside the candidate",
        ),
      );
    }
  }
  if (!facts.tgzOnDisk.exists) {
    problems.push(
      problem("tgz-missing", `tarball for the candidate is missing: ${manifest.package.tgzPath}`, "freeze again"),
    );
  } else if (facts.tgzOnDisk.sha256 !== manifest.package.tgzSha256) {
    problems.push(
      problem(
        "tgz-hash-mismatch",
        `tarball sha256 ${String(facts.tgzOnDisk.sha256)} does not match the manifest ${manifest.package.tgzSha256}`,
        "the tarball was replaced after freezing; re-freeze",
      ),
    );
  }
  if (facts.recomputedFileDigest !== null && facts.recomputedFileDigest !== manifest.package.fileDigest) {
    problems.push(
      problem(
        "file-digest-mismatch",
        `digest over package.files is ${facts.recomputedFileDigest}, manifest says ${manifest.package.fileDigest}`,
        "the file list was edited after freezing; re-freeze",
      ),
    );
  }

  return { ok: problems.length === 0, identity, problems: Object.freeze(problems) };
}

/** True when `child` is `parent` or below it. Case-insensitive on Windows-style paths. */
export function isPathInside(child: string, parent: string): boolean {
  const normalize = (value: string): string => {
    const trimmed = value.replace(/[\\/]+$/, "");
    return /^[A-Za-z]:/.test(trimmed) || trimmed.startsWith("\\") ? trimmed.toLowerCase().replace(/\//g, "\\") : trimmed;
  };
  const a = normalize(child);
  const b = normalize(parent);
  if (a === b) return true;
  const separator = b.includes("\\") ? "\\" : "/";
  return a.startsWith(`${b}${separator}`);
}

/** One paragraph for stderr or a ticket comment. */
export function describeCandidateVerdict(verdict: CandidateVerdict): string {
  if (verdict.ok) {
    return `candidate ok: ${verdict.identity.version} @ ${verdict.identity.commit} (tgz ${verdict.identity.tgzSha256.slice(0, 12)}…)`;
  }
  const lines = [`candidate rejected with ${verdict.problems.length} problem(s):`];
  for (const item of verdict.problems) {
    lines.push(`- [${item.code}] ${item.message}${item.hint === undefined ? "" : ` — ${item.hint}`}`);
  }
  return lines.join("\n");
}
