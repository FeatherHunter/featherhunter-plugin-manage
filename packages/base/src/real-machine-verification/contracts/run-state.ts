/**
 * Run report: the single object a command prints, writes to disk and quotes in a
 * ticket comment.
 *
 * The report is the contract between the tool and its readers, so it deliberately
 * carries *facts* rather than prose: each check keeps expected/actual, each step
 * keeps its start and end, and the exit code is derived from the checks instead
 * of being set by hand. Three readers depend on that:
 *
 * - a human reading `self-check` output at a glance;
 * - a CI job switching on the exit code (0 pass, 1 hard failure, 2 blocked);
 * - another machine re-verifying the claim from the evidence files alone.
 */
import type { CheckResult } from "./check";
import { decideExitCode, describeFailures, tallyChecks } from "./check";

/** Coarse state of a whole run. `blocked` means "could not observe", not "observed bad". */
export type RunState = "planned" | "running" | "passed" | "failed" | "blocked" | "aborted";

/** One step of an L1 command (launch, open page, collect evidence…). */
export interface RunStep {
  readonly id: string;
  readonly title: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly state: "done" | "failed" | "skipped";
  readonly detail?: string;
}

/** What the run concluded about the model. Never contains a secret value. */
export interface RunModelReport {
  readonly provider: string;
  readonly model: string;
  readonly apiKeyEnv: string;
  readonly credentialSource: "batch-home-store" | "real-home-store" | "process-env" | "missing";
  readonly credentialAvailable: boolean;
  readonly profileConfigured: boolean;
  readonly file?: string;
}

/** What the run concluded about the batch it belongs to. */
export interface RunBatchReport {
  readonly name: string;
  readonly dir: string;
  readonly status: "active" | "stale" | "unknown";
  readonly identityLine?: string;
  readonly baseLine?: string;
}

/** The complete result of one command invocation. */
export interface RunReport {
  readonly schemaVersion: 1;
  readonly capability: "real-machine-verification";
  readonly command: string;
  readonly profile: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly state: RunState;
  readonly exitCode: 0 | 1 | 2;
  readonly checks: readonly CheckResult[];
  readonly steps: readonly RunStep[];
  readonly evidence?: { readonly manifestPath: string; readonly itemCount: number };
  readonly batch?: RunBatchReport;
  readonly model?: RunModelReport;
  /** Free-form pointers a reader can open, e.g. `{ report: "…/report.json" }`. */
  readonly artifacts?: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
}

export interface RunReportInit {
  readonly command: string;
  readonly profile: string;
  readonly startedAt: string;
  readonly notes?: readonly string[];
}

/** A run starts as `running` with no checks; every other field is filled at the end. */
export function createRunReport(init: RunReportInit): RunReport {
  return {
    schemaVersion: 1,
    capability: "real-machine-verification",
    command: init.command,
    profile: init.profile,
    startedAt: init.startedAt,
    finishedAt: init.startedAt,
    state: "running",
    exitCode: 0,
    checks: [],
    steps: [],
    notes: [...(init.notes ?? [])],
  };
}

/** Derive the state from the checks: hard failure wins over blocked. */
export function stateFromChecks(checks: readonly CheckResult[]): { state: RunState; exitCode: 0 | 1 | 2 } {
  const exitCode = decideExitCode(checks);
  if (exitCode === 1) return { state: "failed", exitCode };
  if (exitCode === 2) return { state: "blocked", exitCode };
  return { state: "passed", exitCode };
}

export interface FinishRunInput {
  readonly checks: readonly CheckResult[];
  readonly steps: readonly RunStep[];
  readonly finishedAt: string;
  readonly evidence?: { readonly manifestPath: string; readonly itemCount: number };
  readonly batch?: RunBatchReport;
  readonly model?: RunModelReport;
  readonly artifacts?: Readonly<Record<string, string>>;
  readonly notes?: readonly string[];
  /** Set only when the run was cut short (Ctrl-C, prerequisite abort). */
  readonly overrideState?: "aborted";
}

/** Close an open report. The exit code is always derived from `checks`. */
export function finishRunReport(report: RunReport, input: FinishRunInput): RunReport {
  const derived = stateFromChecks(input.checks);
  return {
    ...report,
    finishedAt: input.finishedAt,
    state: input.overrideState ?? derived.state,
    exitCode: input.overrideState === "aborted" ? 1 : derived.exitCode,
    checks: [...input.checks],
    steps: [...input.steps],
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(input.batch === undefined ? {} : { batch: input.batch }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.artifacts === undefined ? {} : { artifacts: input.artifacts }),
    notes: [...report.notes, ...(input.notes ?? [])],
  };
}

/** The process exit code for a report. */
export function exitCodeOfRun(report: RunReport): 0 | 1 | 2 {
  return report.exitCode;
}

/** One-line verdict, safe for stderr. */
export function verdictLine(report: RunReport): string {
  const tally = tallyChecks(report.checks);
  const counts =
    `${tally.passed} pass, ${tally.failed} fail, ${tally.skipped} skip, ${tally.blocked} blocked`;
  const failure = describeFailures(report.checks);
  return failure === null ? `${report.state} (${counts})` : `${report.state} (${counts}) — ${failure}`;
}

/** Human-readable report: verdict, counts, then one line per non-passing check. */
export function renderRunSummary(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`real-machine-verification · ${report.command} · profile ${report.profile}`);
  lines.push(`state: ${verdictLine(report)} · exit ${report.exitCode}`);

  if (report.batch) {
    lines.push(`batch: ${report.batch.name} (${report.batch.status})`);
    if (report.batch.identityLine) lines.push(report.batch.identityLine);
    if (report.batch.baseLine) lines.push(report.batch.baseLine);
  }
  if (report.model) {
    const credential = report.model.credentialAvailable
      ? `credential from ${report.model.credentialSource}`
      : "credential missing";
    lines.push(
      `model: ${report.model.provider}/${report.model.model} · ${credential} · profile ${report.model.profileConfigured ? "configured" : "not configured"}`,
    );
  }

  for (const check of report.checks) {
    const mark = check.status === "pass" ? "ok  " : check.status === "skip" ? "skip" : check.status === "blocked" ? "blok" : "FAIL";
    lines.push(`  ${mark} ${check.id}  ${check.detail}`);
    if (check.status !== "pass" && check.expected !== undefined && check.actual !== undefined) {
      lines.push(`       expected: ${check.expected}`);
      lines.push(`       actual:   ${check.actual}`);
    }
    if (check.status !== "pass" && check.hint !== undefined) lines.push(`       hint: ${check.hint}`);
  }

  if (report.evidence) {
    lines.push(`evidence: ${report.evidence.itemCount} item(s) → ${report.evidence.manifestPath}`);
  }
  for (const [name, path] of Object.entries(report.artifacts ?? {})) {
    lines.push(`${name}: ${path}`);
  }
  for (const note of report.notes) lines.push(`note: ${note}`);
  return lines.join("\n");
}

/** JSON form, stable enough for another machine to parse. */
export function runReportJson(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}
