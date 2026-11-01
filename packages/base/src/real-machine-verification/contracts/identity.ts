/**
 * Identity: the values that make a run reproducible and reviewable on another machine.
 *
 * Three pure functions live here and nowhere else, because every report, every
 * archive and every release check has to agree on their exact bytes:
 *
 * - `canonicalJson` — key-sorted JSON, so a digest does not depend on field order.
 * - `digestOfFiles` — the file-set digest, used to compare a candidate package
 *   against the package a release actually publishes (`sha256 + two spaces + path`,
 *   one line per file, sorted by path, no trailing newline). This is a wire format:
 *   changing it invalidates every digest ever recorded, so it is written down here
 *   rather than re-implemented per repo.
 * - `formatIdentityLine` / `parseIdentityLine` — the one-line claim pasted into a
 *   batch comment and re-parsed by the release check on another machine.
 */
import { createHash } from "node:crypto";

import {
  COMMIT_SHA_RE,
  SHA256_RE,
  parseBatchName,
  parseCommitSha,
  parseSha256Hex,
  type BatchName,
  type CommitSha,
  type Sha256Hex,
} from "./branding";
import { err, failure, ok, type Result } from "./result";

/** Version watermark for every persisted structure this capability writes. */
export const SCHEMA_VERSION = 1;

/** Lowercase hex sha256 of a UTF-8 string. */
export function sha256Text(text: string): Sha256Hex {
  return sha256Hex(createHash("sha256").update(text, "utf8").digest("hex"));
}

/** Lowercase hex sha256 of raw bytes. */
export function sha256Bytes(bytes: Uint8Array): Sha256Hex {
  return sha256Hex(createHash("sha256").update(bytes).digest("hex"));
}

/**
 * Trusted conversion for a digest we just computed ourselves (the hash of any
 * byte string is by construction 64 lowercase hex characters).
 */
function sha256Hex(digest: string): Sha256Hex {
  if (!SHA256_RE.test(digest)) {
    throw new Error(`internal: crypto returned a non-sha256 digest ${JSON.stringify(digest)}`);
  }
  return digest as Sha256Hex;
}

/** Recursively sort object keys; arrays keep their order. */
function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => sortKeys(entry));
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
  return sorted;
}

/**
 * JSON with object keys sorted at every depth, so two equivalent values always
 * produce the same bytes. `undefined` members are dropped (as `JSON.stringify`
 * does), `Date` is not supported, and numbers must be finite.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** One file in a digestible file set. `size` is informational; the digest uses path+sha256. */
export interface FileDigestEntry {
  /** `/`-separated relative path, as recorded in the package manifest. */
  readonly path: string;
  readonly size?: number;
  readonly sha256: string;
}

/**
 * The file-set digest (wire format, shared with the release integrity check).
 *
 * Algorithm, exactly: filter out entries whose `sha256` is not 64 hex characters,
 * sort by `path` using UTF-16 code-unit comparison (`Array.prototype.sort` default),
 * render one line per file as `<sha256><space><space><path>`, join with `\n`, and
 * sha256 the resulting UTF-8 text. No trailing newline, no normalize, no size.
 *
 * Returns a `Result` rather than throwing: a manifest with a bad digest is data
 * from the outside world, and the caller needs the reason, not a stack trace.
 */
export function digestOfFiles(entries: readonly FileDigestEntry[]): Result<Sha256Hex> {
  const invalidDigests: string[] = [];
  const invalidPaths: string[] = [];
  for (const entry of entries) {
    if (!SHA256_RE.test(entry.sha256)) invalidDigests.push(`${entry.path}: ${entry.sha256}`);
    if (entry.path.includes("\\")) invalidPaths.push(entry.path);
  }
  if (invalidPaths.length > 0) {
    return err(
      failure(
        "invalid-input",
        `file digest paths must use "/" separators: ${invalidPaths.slice(0, 3).join(", ")}`,
        "normalize paths before hashing; a Windows path digest does not match a Linux one",
      ),
    );
  }
  if (invalidDigests.length > 0) {
    return err(
      failure(
        "invalid-input",
        `file digest entries with a malformed sha256: ${invalidDigests.slice(0, 3).join(", ")}`,
      ),
    );
  }
  const lines = [...entries]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((entry) => `${entry.sha256}  ${entry.path}`);
  return ok(sha256Text(lines.join("\n")));
}

/** The values a batch comment must carry so a release check can re-verify it. */
export interface IdentityBinding {
  readonly batchName: BatchName;
  readonly commit: CommitSha;
  readonly packageSha256: Sha256Hex;
}

/** The literal prefix of the identity line. Changing it breaks every stored comment. */
export const IDENTITY_LINE_PREFIX = "- 验证身份：";
const IDENTITY_LINE_RE =
  /^- 验证身份：批次 (\S+)；候选提交 ([0-9a-f]{40})；候选包 sha256 ([0-9a-f]{64})$/;

/** Render the identity line. Rejects values that cannot round-trip through `parseIdentityLine`. */
export function formatIdentityLine(binding: IdentityBinding): Result<string> {
  const name = parseBatchName(binding.batchName);
  if (!name.ok) return name;
  const commit = parseCommitSha(binding.commit);
  if (!commit.ok) return commit;
  const sha = parseSha256Hex(binding.packageSha256);
  if (!sha.ok) return sha;
  return ok(
    `${IDENTITY_LINE_PREFIX}批次 ${name.value}；候选提交 ${commit.value}；候选包 sha256 ${sha.value}`,
  );
}

/** Parse the identity line; strict on purpose, a near-miss means a near-miss batch. */
export function parseIdentityLine(line: string): Result<IdentityBinding> {
  const match = IDENTITY_LINE_RE.exec(line.trim());
  if (match === null) {
    return err(
      failure(
        "identity-mismatch",
        "line is not an identity line",
        `expected "${IDENTITY_LINE_PREFIX}批次 <batch>；候选提交 <40 hex>；候选包 sha256 <64 hex>"`,
        { line },
      ),
    );
  }
  const [, rawName, rawCommit, rawSha] = match;
  if (rawName === undefined || rawCommit === undefined || rawSha === undefined) {
    return err(failure("identity-mismatch", "identity line matched but captured nothing"));
  }
  const name = parseBatchName(rawName);
  if (!name.ok) return name;
  if (!COMMIT_SHA_RE.test(rawCommit)) {
    return err(failure("identity-mismatch", `candidate commit is not a full sha: ${rawCommit}`));
  }
  const sha = parseSha256Hex(rawSha);
  if (!sha.ok) return sha;
  return ok({ batchName: name.value, commit: rawCommit as CommitSha, packageSha256: sha.value });
}

/** The local base a batch was opened against. */
export interface VerificationBase {
  readonly ref: string;
  readonly tip: CommitSha;
  readonly expectedVersion: string;
}

/** The literal prefix of the base line. */
export const BASE_LINE_PREFIX = "- 验证基线：";
const BASE_LINE_RE = /^- 验证基线：本地 (\S+) ([0-9a-f]{40})；目标版本 (\S+)$/;

/** Render the base line (`- 验证基线：本地 main <tip>；目标版本 1.2.3`). */
export function formatBaseLine(base: VerificationBase): Result<string> {
  if (base.ref.length === 0 || /\s/.test(base.ref)) {
    return err(failure("invalid-input", `base ref must be non-empty and space-free: ${base.ref}`));
  }
  if (base.expectedVersion.length === 0 || /\s/.test(base.expectedVersion)) {
    return err(
      failure("invalid-input", `expected version must be non-empty and space-free: ${base.expectedVersion}`),
    );
  }
  const tip = parseCommitSha(base.tip);
  if (!tip.ok) return tip;
  return ok(`${BASE_LINE_PREFIX}本地 ${base.ref} ${tip.value}；目标版本 ${base.expectedVersion}`);
}

/** Parse the base line. */
export function parseBaseLine(line: string): Result<VerificationBase> {
  const match = BASE_LINE_RE.exec(line.trim());
  const [, rawRef, rawTip, rawVersion] = match ?? [];
  if (rawRef === undefined || rawTip === undefined || rawVersion === undefined) {
    return err(
      failure(
        "identity-mismatch",
        "line is not a verification-base line",
        `expected "${BASE_LINE_PREFIX}本地 <ref> <40 hex>；目标版本 <version>"`,
        { line },
      ),
    );
  }
  return ok({ ref: rawRef, tip: rawTip as CommitSha, expectedVersion: rawVersion });
}
