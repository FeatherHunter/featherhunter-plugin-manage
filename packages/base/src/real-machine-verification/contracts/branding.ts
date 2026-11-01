/**
 * Branded primitives.
 *
 * A `CommitSha` is a `string` that has already been checked against
 * `COMMIT_SHA_RE`. Branding means a raw string can never drift into a field the
 * rest of the capability assumes is a hash, and every value still carries the
 * rule that produced it. Parse first, then the type is proof.
 */
import { err, failure, ok, type Result } from "./result";

declare const brand: unique symbol;

/** A value of `TValue` that has passed the named validation `TTag`. */
export type Brand<TValue, TTag extends string> = TValue & { readonly [brand]: TTag };

/** 40 lowercase hexadecimal characters, as produced by `git rev-parse`. */
export type CommitSha = Brand<string, "CommitSha">;
/** 64 lowercase hexadecimal characters, as produced by `sha256sum`. */
export type Sha256Hex = Brand<string, "Sha256Hex">;
/** A batch directory name: safe as a single path segment, never `.` or `..`. */
export type BatchName = Brand<string, "BatchName">;
/** A stable check id: lowercase kebab-case, referenced by gates and comments. */
export type CheckId = Brand<string, "CheckId">;
/** A DSH profile name (the directory under `<home>/profiles/`). */
export type ProfileName = Brand<string, "ProfileName">;
/** A relative path inside an evidence directory, always `/`-separated. */
export type EvidencePath = Brand<string, "EvidencePath">;

export const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
/** Same rule as the batch tooling: at least one alphanumeric, no separators. */
export const BATCH_NAME_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]{1,64}$/;
export const CHECK_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
export const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Render a value for an error message without assuming it is printable. */
function quote(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Parse a git commit sha, or explain exactly what was expected. */
export function parseCommitSha(value: unknown): Result<CommitSha> {
  if (typeof value !== "string" || !COMMIT_SHA_RE.test(value)) {
    return err(
      failure(
        "invalid-input",
        `not a 40-character lowercase commit sha: ${quote(value)}`,
        "pass the output of `git rev-parse HEAD` without shortening it",
      ),
    );
  }
  return ok(value as CommitSha);
}

/** Parse a sha256 digest. */
export function parseSha256Hex(value: unknown): Result<Sha256Hex> {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    return err(
      failure(
        "invalid-input",
        `not a 64-character lowercase sha256: ${quote(value)}`,
        "pass the digest produced by sha256sum / the tool's own manifest",
      ),
    );
  }
  return ok(value as Sha256Hex);
}

/** Parse a batch name that is safe as one directory segment. */
export function parseBatchName(value: unknown): Result<BatchName> {
  if (typeof value !== "string" || !BATCH_NAME_RE.test(value)) {
    return err(
      failure(
        "invalid-input",
        `not a usable batch name: ${quote(value)}`,
        "use letters, digits, dot, dash or underscore, and include at least one letter or digit",
      ),
    );
  }
  if (value === "." || value === "..") {
    return err(
      failure("invalid-input", `batch name ${quote(value)} would escape the batches directory`),
    );
  }
  return ok(value as BatchName);
}

/** Parse a check id. */
export function parseCheckId(value: unknown): Result<CheckId> {
  if (typeof value !== "string" || !CHECK_ID_RE.test(value)) {
    return err(
      failure(
        "invalid-input",
        `not a usable check id: ${quote(value)}`,
        "use lowercase kebab-case, e.g. isolation-home or model-credential",
      ),
    );
  }
  return ok(value as CheckId);
}

/** Parse a profile name. The value is a directory name, not a fixed vocabulary. */
export function parseProfileName(value: unknown): Result<ProfileName> {
  if (typeof value !== "string" || !PROFILE_NAME_RE.test(value)) {
    return err(
      failure(
        "invalid-input",
        `not a usable profile name: ${quote(value)}`,
        "profile names are directory names under <home>/profiles/, e.g. web or desktop",
      ),
    );
  }
  return ok(value as ProfileName);
}

/** Narrow an already-validated value; used when a caller owns the proof. */
export function asEvidencePath(value: string): EvidencePath {
  return value as EvidencePath;
}
