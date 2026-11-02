/**
 * `dsh-verify batch open|status` — name one candidate, quote its identity, and
 * later say whether that identity still holds.
 *
 * This layer owns only the CLI contract: flags, context resolution, the two
 * output modes and the exit codes. Opening, freshness judgement and evidence
 * binding live in `orchestration/batch.ts`.
 *
 * Exit codes: `0` the batch is fresh and every evidence manifest is bound (or
 * nothing was collected yet); `1` the batch is stale or some evidence belongs to
 * another candidate; `2` a prerequisite is missing (no batch record, no
 * candidate, an unreadable declaration) or the invocation is invalid.
 */
import { EXIT_CODES } from "../../capability-description";
import type { Ports } from "../../contracts/ports";
import { formatFailure, type Failure } from "../../contracts/result";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import {
  BATCH_RECORD_FILENAME,
  checkBatch,
  openBatch,
  type BatchCheck,
  type BatchStage,
  type CheckBatchOutcome,
  type OpenBatchOutcome,
} from "../../orchestration/batch";
import { loadDeclarationContext, resolveWorkRoot } from "../../orchestration/context";
import { resolveAgainst } from "../../runtime/paths";
import type { ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected. */
export interface BatchCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  /** Only the node version matters here; the loader enforces `requiredNode`. */
  readonly runtime?: { readonly nodeVersion: string };
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

export const BATCH_USAGE =
  "dsh-verify batch open|status [--name <n>] [--base-ref <r>] [--candidate <dir>] [--allow-stale] [--json]";

/** `--batch` is the evidence command's flag; it is not accepted here. */
const BATCH_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--name",
  "--base-ref",
  "--candidate",
  "--allow-stale",
  "--dry-run",
  "--work-root",
  "--profile",
  "--declaration",
]);

type BatchAction = "open" | "status";

function errorJson(action: string | null, stage: BatchStage | "usage" | "declaration" | "profile", failure: Failure): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "batch",
    action,
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      ...(failure.hint === undefined ? {} : { hint: failure.hint }),
      ...(failure.details === undefined ? {} : { details: failure.details }),
      stage,
    },
  })}\n`;
}

function usageFailure(message: string): Failure {
  return {
    code: "invalid-input",
    message,
    hint: BATCH_USAGE,
  };
}

/** Human check line: a failure always carries expected, actual and (when there is one) hint. */
function renderCheck(check: BatchCheck): string {
  if (check.status === "fail") {
    const expected = check.expected === undefined ? "(not recorded)" : check.expected;
    const actual = check.actual === undefined ? "(not recorded)" : check.actual;
    const hint = check.hint === undefined ? "" : `; hint: ${check.hint}`;
    return `fail ${check.id} ${check.detail}; expected: ${expected}; actual: ${actual}${hint}`;
  }
  return `${check.status === "pass" ? "ok" : check.status === "skip" ? "skip" : "blocked"} ${check.id} ${check.detail}`;
}

/** The two wire-format lines, verbatim; the no-baseline note is not a base line. */
function renderIdentityLines(outcome: { readonly identityLine: string; readonly baseLine: string | null }): string {
  const lines: string[] = [];
  lines.push(
    outcome.identityLine.length > 0
      ? outcome.identityLine
      : "（本批次尚未冻结候选，因此还没有身份行；freeze 到批次目录后 batch open --candidate 才会生成）",
  );
  lines.push(
    outcome.baseLine ?? "- 验证基线：无（本批次未记录基线，新鲜度判为 blocked，不是「不需要检查」）",
  );
  return `${lines.join("\n")}\n`;
}

function openJson(outcome: OpenBatchOutcome): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "batch",
    action: "open",
    ok: true,
    exitCode: EXIT_CODES.ok,
    batch: {
      name: outcome.record.batchName,
      dir: outcome.batchDir,
      file: outcome.batchFile,
      createdAt: outcome.createdAt,
      reused: outcome.reused,
      dryRun: outcome.dryRun,
    },
    profile: outcome.raw.profile ?? null,
    profileName: outcome.raw.profileName ?? null,
    phase: outcome.phase,
    candidate:
      outcome.candidate === null
        ? null
        : {
            path: outcome.candidate.path,
            manifest: outcome.candidatePath,
            commit: outcome.candidate.commit,
            version: outcome.candidate.version,
            manifestSha256: outcome.candidate.sha256,
            tgzSha256: outcome.candidate.tgzSha256,
          },
    candidateProblems: outcome.candidateProblems,
    base: outcome.raw.base ?? null,
    identityLine: outcome.identityLine,
    baseLine: outcome.baseLine,
    allowStale: outcome.allowStale,
    record: outcome.raw,
    notes: outcome.notes,
  })}\n`;
}

function statusJson(outcome: CheckBatchOutcome): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "batch",
    action: "status",
    ok: outcome.exitCode === EXIT_CODES.ok,
    exitCode: outcome.exitCode,
    batch: {
      name: outcome.record.batchName,
      dir: outcome.batchDir,
      file: outcome.batchFile,
      createdAt: outcome.record.createdAt,
      status: outcome.record.status,
    },
    record: outcome.raw,
    identityLine: outcome.identityLine,
    baseLine: outcome.baseLine,
    freshness:
      outcome.freshness === null
        ? null
        : {
            status: outcome.freshness.status,
            message: outcome.freshness.message,
            problems: outcome.freshness.problems,
            endHead: outcome.freshness.endHead,
            endCheckedAt: outcome.freshness.endCheckedAt,
          },
    allowedStale: outcome.allowedStale,
    evidence: {
      root: outcome.evidence.root,
      readable: outcome.evidence.readable,
      scanned: outcome.evidence.scanned,
      bound: outcome.evidence.bound,
      rejected: outcome.evidence.rejected,
    },
    checks: outcome.checks.map((check) => ({
      id: check.id,
      title: check.title,
      hard: check.hard,
      status: check.status,
      detail: check.detail,
      ...(check.expected === undefined ? {} : { expected: check.expected }),
      ...(check.actual === undefined ? {} : { actual: check.actual }),
      ...(check.hint === undefined ? {} : { hint: check.hint }),
      ...(check.blockedReason === undefined ? {} : { blockedReason: check.blockedReason }),
      reason: check.reason,
    })),
    notes: outcome.notes,
  })}\n`;
}

type ValidationOutcome =
  | { readonly ok: true; readonly action: BatchAction }
  | { readonly ok: false; readonly action: BatchAction | null; readonly message: string };

/** Flags that are meaningful for each subcommand; anything else is a usage error. */
const ACTION_FLAGS: Readonly<Record<BatchAction, ReadonlySet<string>>> = {
  open: BATCH_FLAGS,
  status: new Set(["--json", "--name", "--allow-stale", "--dry-run", "--work-root"]),
};

/**
 * Validate the invocation shape for `batch`.
 *
 * `flagProblems` cannot be reused here because `parseArgs` keeps the command
 * itself in `positional[0]`, so `batch open` legitimately has two positionals
 * (command + subcommand) — exactly the reason `evidence` validates its own
 * invocation. Everything else follows the same policy: unknown options,
 * structural problems, a flag that belongs to another subcommand, and a stray
 * positional are all usage errors (exit 2).
 */
function validateInvocation(args: ParsedArgs): ValidationOutcome {
  if (args.command !== "batch") {
    return {
      ok: false,
      action: null,
      message: `batch command was dispatched wrongly (received ${args.command ?? "no command"})`,
    };
  }
  const problems: string[] = [];
  if (args.unknown.length > 0) problems.push(`unknown option(s): ${args.unknown.join(", ")}`);
  for (const problem of args.problems) problems.push(problem);
  const raw = args.positional[1];
  const action: BatchAction | null = raw === "open" || raw === "status" ? raw : null;
  if (action === null) {
    return {
      ok: false,
      action: null,
      message:
        raw === undefined
          ? "missing subcommand (open|status)"
          : `unknown subcommand "${raw}" (expected open|status)`,
    };
  }
  if (args.positional.length > 2) {
    problems.push(`unexpected argument(s): ${args.positional.slice(2).join(" ")}`);
  }
  const allowed = ACTION_FLAGS[action];
  const notAllowed = [...new Set(args.given)].filter((flag) => !allowed.has(flag)).sort();
  if (notAllowed.length > 0) {
    problems.push(`option(s) not valid for batch ${action}: ${notAllowed.join(", ")}`);
  }
  if (problems.length > 0) return { ok: false, action, message: problems.join("; ") };
  return { ok: true, action };
}

async function runOpen(
  action: BatchAction,
  args: ParsedArgs,
  deps: BatchCommandDeps,
): Promise<number> {
  const { ports, io } = deps;
  const cwd = ports.env.cwd();
  const context = await loadDeclarationContext({
    ports,
    cwd,
    nodeVersion: deps.runtime?.nodeVersion ?? "0.0.0-unknown",
    ...(args.workRoot === undefined ? {} : { workRoot: args.workRoot }),
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
    ...(args.profile === undefined ? {} : { profileOverride: args.profile }),
    ...(deps.loadDeclaration === undefined ? {} : { loadDeclaration: deps.loadDeclaration }),
  });
  if (!context.ok) {
    io.stderr(`dsh-verify batch open: ${formatFailure(context.error.failure)}\n`);
    if (args.json) io.stdout(errorJson(action, context.error.stage, context.error.failure));
    return EXIT_CODES.blocked;
  }
  const declaration = context.value.declaration;
  const profile = context.value.profile;
  const candidateArg =
    args.candidate === undefined ? undefined : resolveAgainst(cwd, args.candidate);

  const opened = await openBatch({
    ports,
    cwd,
    workRoot: context.value.workRoot,
    ...(args.name === undefined ? {} : { name: args.name }),
    ...(args.baseRef === undefined ? {} : { baseRef: args.baseRef }),
    ...(candidateArg === undefined ? {} : { candidate: candidateArg }),
    allowStale: args.allowStale,
    dryRun: args.dryRun,
    profile,
    profileName: context.value.profileName,
    declaration,
  });
  if (!opened.ok) {
    io.stderr(`dsh-verify batch open: ${formatFailure(opened.error)}\n`);
    if (args.json) io.stdout(errorJson(action, opened.error.stage, opened.error));
    return opened.error.blocked ? EXIT_CODES.blocked : EXIT_CODES.hardFailure;
  }
  const outcome = opened.value;
  for (const note of outcome.notes) io.stderr(`note: ${note}\n`);
  if (args.json) {
    io.stdout(openJson(outcome));
    return EXIT_CODES.ok;
  }
  const verb =
    outcome.phase === "prepared"
      ? outcome.reused
        ? `批次 ${outcome.record.batchName} 已经准备好，等待候选（未改写 ${BATCH_RECORD_FILENAME}）`
        : args.dryRun
          ? `批次 ${outcome.record.batchName} dry-run 准备（未写 ${BATCH_RECORD_FILENAME}）`
          : `批次 ${outcome.record.batchName} 已准备到 ${outcome.batchFile}`
      : outcome.reused
        ? `批次 ${outcome.record.batchName} 已存在且身份一致（未改写 ${BATCH_RECORD_FILENAME}）`
        : args.dryRun
          ? `批次 ${outcome.record.batchName} dry-run 封存（未写 ${BATCH_RECORD_FILENAME}）`
          : `批次 ${outcome.record.batchName} 已封存候选并记录到 ${outcome.batchFile}`;
  io.stdout(`ok batch-open ${verb}\n`);
  io.stdout(renderIdentityLines(outcome));
  return EXIT_CODES.ok;
}

async function runStatus(
  action: BatchAction,
  args: ParsedArgs,
  deps: BatchCommandDeps,
): Promise<number> {
  const { ports, io } = deps;
  const cwd = ports.env.cwd();
  // Status deliberately does not load the declaration: a batch that was opened
  // once must stay judgeable even if the profile module currently fails to load.
  const workRoot = resolveWorkRoot(cwd, args.workRoot);

  const checked = await checkBatch({
    ports,
    cwd,
    workRoot,
    ...(args.name === undefined ? {} : { name: args.name }),
    allowStale: args.allowStale,
    dryRun: args.dryRun,
  });
  if (!checked.ok) {
    io.stderr(`dsh-verify batch status: ${formatFailure(checked.error)}\n`);
    if (args.json) io.stdout(errorJson(action, checked.error.stage, checked.error));
    return EXIT_CODES.blocked;
  }
  const outcome = checked.value;
  for (const note of outcome.notes) io.stderr(`note: ${note}\n`);
  if (args.json) {
    io.stdout(statusJson(outcome));
    return outcome.exitCode;
  }
  io.stdout(renderIdentityLines(outcome));
  for (const check of outcome.checks) io.stdout(`${renderCheck(check)}\n`);
  return outcome.exitCode;
}

/**
 * Run one `batch` invocation. The caller (main.ts) is responsible for routing
 * only `batch` here; the subcommand is the single positional argument.
 */
export async function runBatchCommand(args: ParsedArgs, deps: BatchCommandDeps): Promise<number> {
  const validation = validateInvocation(args);
  if (!validation.ok) {
    const failure = usageFailure(validation.message);
    deps.io.stderr(`dsh-verify batch: ${failure.message}\n${BATCH_USAGE}\n`);
    if (args.json) deps.io.stdout(errorJson(validation.action, "usage", failure));
    return EXIT_CODES.blocked;
  }
  return validation.action === "open"
    ? runOpen(validation.action, args, deps)
    : runStatus(validation.action, args, deps);
}

/* Re-exported so main.ts can wire the evidence dispatch without reaching into
   the orchestration module directly. */
export { loadBatchContextForEvidence } from "../../orchestration/batch";
export type { BatchEvidenceContext } from "../../orchestration/batch";
