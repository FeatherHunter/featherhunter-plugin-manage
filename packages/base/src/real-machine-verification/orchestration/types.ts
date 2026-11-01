/**
 * Planning types: a check is a falsifiable claim plus the capabilities it needs.
 *
 * The three-stage shape (plan → execute → report) exists so a later ticket can
 * add checks without touching the runner, and can run the same plan against a
 * fake machine in a test. Two rules are encoded in the types themselves:
 *
 * - a `fail` outcome must carry `expected`, `actual` and `hint` — the builder
 *   signatures do not accept a bare failure, because a report that only says
 *   "failed" makes the reader re-derive the comparison;
 * - a missing optional capability is `blocked` or `skip`, never `fail`. The plan
 *   says which status applies (`onMissing`), so a machine without a browser can
 *   still produce a green self-check instead of a false red.
 */
import type { CheckId } from "../contracts/branding";
import { parseCheckId } from "../contracts/branding";
import type { CheckResult, CheckStatus } from "../contracts/check";
import type { EvidenceItemRef } from "../contracts/evidence-contract";
import { formatFailure, unwrapOrThrow } from "../contracts/result";

/** Narrow a hard-coded id at module load, so a typo fails loudly in tests. */
export function checkId(value: string): CheckId {
  return unwrapOrThrow(parseCheckId(value), formatFailure);
}

/**
 * An effect a check needs but the machine may not have.
 *
 * Kept as strings rather than port keys so a future adapter (a browser driver, a
 * screen probe) slots in without changing the plan shape.
 */
export type OptionalCapability =
  | "browser"
  | "screen"
  | "command"
  | "process"
  | "http"
  | "read-file-slice";

/**
 * What a check observed.
 *
 * `blocked` and `skip` are observations about the *machine*, not the product:
 * the runner produces them from the plan, and a check may also produce them when
 * a prerequisite turns out to be absent at run time.
 */
export interface CheckOutcome {
  readonly status: CheckStatus;
  readonly detail: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
  readonly evidence?: readonly EvidenceItemRef[];
}

/** The claim held. */
export function passed(detail: string, evidence?: readonly EvidenceItemRef[]): CheckOutcome {
  return { status: "pass", detail, ...(evidence === undefined ? {} : { evidence }) };
}

/** The claim was falsified. All three comparison fields are required. */
export function failed(
  detail: string,
  expected: string,
  actual: string,
  hint: string,
  evidence?: readonly EvidenceItemRef[],
): CheckOutcome {
  return { status: "fail", detail, expected, actual, hint, ...(evidence === undefined ? {} : { evidence }) };
}

/** The check did not apply, and that is not a problem (e.g. feature not requested). */
export function skipped(detail: string, hint?: string, evidence?: readonly EvidenceItemRef[]): CheckOutcome {
  return { status: "skip", detail, ...(hint === undefined ? {} : { hint }), ...(evidence === undefined ? {} : { evidence }) };
}

/**
 * The check could not observe the product (missing prerequisite or adapter).
 *
 * `blocked` is the honest answer here: the run proved nothing about the plugin,
 * so a green report would be a lie and a failure would be a false alarm.
 */
export function blocked(detail: string, hint: string, evidence?: readonly EvidenceItemRef[]): CheckOutcome {
  return { status: "blocked", detail, hint, ...(evidence === undefined ? {} : { evidence }) };
}

/**
 * One planned check.
 *
 * `requires` is checked by the runner *before* `run` is called: a plan can name a
 * capability it does not expect to find, and the status says what that means.
 */
export interface CheckModule<TContext> {
  readonly id: CheckId;
  readonly title: string;
  readonly hard: boolean;
  readonly requires: readonly OptionalCapability[];
  readonly onMissing: "blocked" | "skip";
  /** What to tell the reader when a required capability is absent. */
  readonly missingHint?: string;
  readonly run: (context: TContext) => Promise<CheckOutcome> | CheckOutcome;
}

/** An ordered list of checks for one command. */
export interface CheckPlan<TContext> {
  readonly command: string;
  readonly checks: readonly CheckModule<TContext>[];
}

/** Convert an outcome into the contract type, filling the fields a fail must have. */
export function toCheckResult<TContext>(
  check: CheckModule<TContext>,
  outcome: CheckOutcome,
  durationMs: number,
): CheckResult {
  const normalized = normalizeOutcome(outcome);
  return {
    id: check.id,
    title: check.title,
    hard: check.hard,
    status: normalized.status,
    detail: normalized.detail,
    ...(normalized.expected === undefined ? {} : { expected: normalized.expected }),
    ...(normalized.actual === undefined ? {} : { actual: normalized.actual }),
    ...(normalized.hint === undefined ? {} : { hint: normalized.hint }),
    evidence: normalized.evidence ?? [],
    durationMs,
  };
}

/**
 * Guarantee the report contract regardless of how an outcome was built.
 *
 * Custom checks come from plugin code, so a `fail` produced by hand could omit
 * the comparison; the runner repairs it instead of trusting the caller.
 */
export function normalizeOutcome(outcome: CheckOutcome): CheckOutcome {
  if (outcome.status === "fail") {
    return {
      ...outcome,
      expected: outcome.expected ?? "the check's claim holds",
      actual: outcome.actual ?? outcome.detail,
      hint: outcome.hint ?? "read the evidence referenced by this report",
    };
  }
  if (outcome.status === "blocked") {
    return { ...outcome, hint: outcome.hint ?? "install or enable the missing prerequisite, then rerun" };
  }
  return outcome;
}
