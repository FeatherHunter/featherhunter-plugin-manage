/**
 * The `Result` type used on every boundary of this capability.
 *
 * Machine verification fails for reasons that are *not* exceptions: a candidate
 * file was tampered with, an adapter is missing, a timeout elapsed. Throwing
 * turns all of those into one indistinguishable stack trace, so every layer
 * returns `Result` and only the CLI converts a failure into a process exit code.
 */

/** Why an operation could not produce a value. Stable strings, safe to switch on. */
export type FailureCode =
  | "invalid-input"
  | "prerequisite"
  | "identity-mismatch"
  | "not-found"
  | "io"
  | "timeout"
  | "conflict"
  | "unsupported"
  | "internal";

/** A machine-readable failure. `hint` is the sentence a human needs to act on. */
export interface Failure {
  readonly code: FailureCode;
  /** What went wrong, in one sentence. */
  readonly message: string;
  /** What to do about it. Optional only when the message already says it. */
  readonly hint?: string;
  /** Structured context for `--json` consumers (never contains secret values). */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Success or failure, always explicit. */
export type Result<TValue, TFailure = Failure> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TFailure };

/** Wrap a success. */
export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

/** Wrap a failure. */
export function err<TFailure>(error: TFailure): Result<never, TFailure> {
  return { ok: false, error };
}

/** Build a `Failure` without repeating the object shape at every call site. */
export function failure(
  code: FailureCode,
  message: string,
  hint?: string,
  details?: Readonly<Record<string, unknown>>,
): Failure {
  return {
    code,
    message,
    ...(hint === undefined ? {} : { hint }),
    ...(details === undefined ? {} : { details }),
  };
}

/** Type guard for the success branch. */
export function isOk<TValue, TFailure>(
  result: Result<TValue, TFailure>,
): result is { readonly ok: true; readonly value: TValue } {
  return result.ok;
}

/** Type guard for the failure branch. */
export function isErr<TValue, TFailure>(
  result: Result<TValue, TFailure>,
): result is { readonly ok: false; readonly error: TFailure } {
  return !result.ok;
}

/** Map the success value, leaving a failure untouched. */
export function mapOk<TValue, TNext, TFailure>(
  result: Result<TValue, TFailure>,
  map: (value: TValue) => TNext,
): Result<TNext, TFailure> {
  return result.ok ? ok(map(result.value)) : result;
}

/** Map the failure, leaving a success untouched. */
export function mapErr<TValue, TFailure, TNextFailure>(
  result: Result<TValue, TFailure>,
  map: (error: TFailure) => TNextFailure,
): Result<TValue, TNextFailure> {
  return result.ok ? result : err(map(result.error));
}

/** Unwrap for call sites (CLI, tests) where a failure really is fatal. */
export function unwrapOrThrow<TValue, TFailure>(
  result: Result<TValue, TFailure>,
  describeFailure: (error: TFailure) => string,
): TValue {
  if (result.ok) return result.value;
  throw new Error(describeFailure(result.error));
}

/** Render a failure as one line for stderr. */
export function formatFailure(error: Failure): string {
  const hint = error.hint === undefined ? "" : ` — ${error.hint}`;
  return `[${error.code}] ${error.message}${hint}`;
}
