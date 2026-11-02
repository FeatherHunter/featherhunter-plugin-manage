/**
 * Check contract: one falsifiable claim about the running system.
 *
 * Two rules make checks trustworthy, and both live here rather than in the CLI:
 *
 * - `expected` and `actual` are separate fields. A check that only reports "failed"
 *   forces the reader to re-derive what was being compared.
 * - `blocked` is not `fail`. A missing browser, a missing `glab` binary or a
 *   headless-only machine proves nothing about the product, so a hard `fail` would
 *   be a false red — and false reds are how a gate stops being read.
 */
import type { CheckId } from "./branding";
import type { BlockedReason, EvidenceItemRef } from "./evidence-contract";

/** Outcome of one check. */
export type CheckStatus = "pass" | "fail" | "skip" | "blocked";

/** One falsifiable claim plus the evidence that supports it. */
export interface CheckResult {
  readonly id: CheckId;
  /** Human sentence naming the claim, e.g. "the isolated home owns its profile". */
  readonly title: string;
  /** `true` when a failure must block the run; `false` for advisory checks. */
  readonly hard: boolean;
  readonly status: CheckStatus;
  /** One sentence describing the observation. */
  readonly detail: string;
  /** What the rule required. Separate from `actual` on purpose. */
  readonly expected?: string;
  /** What was observed instead. */
  readonly actual?: string;
  /** What the reader should do next. */
  readonly hint?: string;
  /**
   * Why a `blocked` check could not observe the product: the missing adapter,
   * the missing prerequisite, or the unsupported platform.
   *
   * Present on every blocked result — the runner fills a `prerequisite-missing`
   * default, and the browser adapter paths say `adapter-missing` explicitly —
   * so a report reader never has to parse the sentence to learn the cause.
   */
  readonly blockedReason?: BlockedReason;
  readonly evidence: readonly EvidenceItemRef[];
  readonly durationMs: number;
  /**
   * Where the check came from: the tool's own plan or a scenario body.
   * Optional so every pre-scenario construction stays valid; the scenario runner
   * sets it explicitly and the report can then keep the two apart.
   */
  readonly source?: "builtin" | "custom";
}

/** Aggregated counters for a report or exit-code decision. */
export interface CheckTally {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly blocked: number;
  /** Subset of `failed` where `hard` was true. */
  readonly hardFailed: number;
}

/** Count statuses without hiding the hard subset. */
export function tallyChecks(checks: readonly CheckResult[]): CheckTally {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let blocked = 0;
  let hardFailed = 0;
  for (const check of checks) {
    switch (check.status) {
      case "pass":
        passed += 1;
        break;
      case "fail":
        failed += 1;
        if (check.hard) hardFailed += 1;
        break;
      case "skip":
        skipped += 1;
        break;
      case "blocked":
        blocked += 1;
        break;
    }
  }
  return { total: checks.length, passed, failed, skipped, blocked, hardFailed };
}

/** Which exit code a set of checks deserves. `0` pass, `1` hard failure, `2` blocked. */
export function decideExitCode(checks: readonly CheckResult[]): 0 | 1 | 2 {
  const tally = tallyChecks(checks);
  if (tally.hardFailed > 0) return 1;
  if (tally.blocked > 0) return 2;
  return 0;
}

/** One line for stderr when a run is about to exit non-zero. */
export function describeFailures(checks: readonly CheckResult[]): string | null {
  const hard = checks.filter((check) => check.status === "fail" && check.hard);
  if (hard.length > 0) {
    const names = hard.map((check) => `${check.id} (${check.title})`).join(", ");
    return `hard checks failed (${hard.length}): ${names}`;
  }
  const blocked = checks.filter((check) => check.status === "blocked");
  if (blocked.length > 0) {
    const names = blocked.map((check) => `${check.id} (${check.title})`).join(", ");
    return `checks blocked (${blocked.length}): ${names}`;
  }
  return null;
}
