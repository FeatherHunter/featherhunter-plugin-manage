/**
 * `dsh-verify cleanup` — account for work-root artifacts, and delete only when
 * explicitly confirmed.
 *
 * The default is a report. That is not politeness: a cleanup command that guesses
 * is a cleanup command that eventually deletes the wrong tree, so the dry run is
 * the product and `--yes` is the opt-in. The report names every entry, its
 * category, its last-modified time, the decision and the reason, in both human
 * and JSON form; unknown entries are reported and never deleted.
 *
 * `--dry-run` is accepted as well and wins over `--yes`: passing both is a
 * request for the safe behavior, not an ambiguity to resolve destructively.
 * `--include-pkg` gates the one category that is report-only by default
 * (candidate packages).
 */
import { EXIT_CODES } from "../../capability-description";
import type { Ports } from "../../contracts/ports";
import { formatFailure } from "../../contracts/result";
import { resolveWorkRoot } from "../../orchestration/context";
import {
  executeCleanup,
  guardCleanupRoot,
  planCleanup,
  type CleanupExecution,
  type CleanupPlan,
  type CleanupPlanEntry,
  type CleanupRetention,
} from "../../orchestration/cleanup";
import { scanWorkRoot } from "../../runtime/dsh/cleanup-scan";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected. */
export interface CleanupCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
}

export const CLEANUP_USAGE =
  "dsh-verify cleanup [--yes] [--keep-batches <n>] [--keep-homes <n>] [--include-pkg] [--json] [--dry-run]";

/** Flags this command implements; anything else recognized is a usage error. */
const CLEANUP_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--work-root",
  "--yes",
  "--keep-batches",
  "--keep-homes",
  "--include-pkg",
  "--dry-run",
]);

const DEFAULT_KEEP_BATCHES = 2;
const DEFAULT_KEEP_HOMES = 0;

/** The empty execution used by a dry run. */
const NOTHING_EXECUTED: CleanupExecution = { removed: [], failed: [], freedBytes: 0 };

interface CleanupJsonInput {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly workRoot: string;
  readonly exists: boolean;
  readonly retention: CleanupRetention;
  readonly plan: CleanupPlan | null;
  readonly execution: CleanupExecution | null;
  readonly problems: readonly string[];
  readonly error?: string;
}

function jsonEntry(entry: CleanupPlanEntry): Record<string, unknown> {
  return {
    path: entry.path,
    relativePath: entry.relativePath,
    category: entry.category,
    kind: entry.kind,
    archived: entry.archived,
    mtime: entry.mtime,
    bytes: entry.bytes,
    files: entry.files,
    directories: entry.directories,
    rank: entry.rank,
    action: entry.action,
    reason: entry.reason,
    unsafe: entry.unsafe,
  };
}

/** Render the single JSON document `--json` promises (exactly one per run). */
function renderJson(input: CleanupJsonInput): string {
  const summary = input.plan?.summary ?? { entries: 0, keep: 0, delete: 0, report: 0, unsafe: 0 };
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "cleanup",
    ok: input.ok,
    dryRun: input.dryRun,
    workRoot: input.workRoot,
    exists: input.exists,
    retention: {
      batches: input.retention.batches,
      homes: input.retention.homes,
      temp: 0,
      includePkg: input.retention.includePkg,
    },
    entries: input.plan?.entries.map(jsonEntry) ?? [],
    summary: {
      entries: summary.entries,
      keep: summary.keep,
      delete: summary.delete,
      report: summary.report,
      unsafe: summary.unsafe,
      deleted: input.execution?.removed.length ?? 0,
      freedBytes: input.execution?.freedBytes ?? 0,
    },
    failures: input.execution?.failed ?? [],
    problems: input.problems,
    ...(input.error === undefined ? {} : { error: input.error }),
  })}\n`;
}

function renderEntry(entry: CleanupPlanEntry): string {
  const mtime = entry.mtime ?? "unknown mtime";
  return `${entry.action.padEnd(6)} ${entry.category.padEnd(9)} ${entry.relativePath} — ${entry.reason} (${entry.bytes} bytes, ${entry.files} file(s), ${entry.directories} dir(s), ${mtime})\n`;
}

function renderHuman(
  plan: CleanupPlan,
  execution: CleanupExecution,
  dryRun: boolean,
  exists: boolean,
): string {
  if (!exists) return `cleanup: work root ${plan.workRoot} does not exist; nothing to clean\n`;
  if (plan.entries.length === 0) return `cleanup: no entries under ${plan.workRoot}\n`;

  const lines = plan.entries.map(renderEntry);
  if (dryRun) {
    lines.push(
      `cleanup: ${plan.summary.entries} entries; ${plan.summary.delete} would be deleted, ${plan.summary.keep} kept, ` +
        `${plan.summary.report} report-only; dry run — nothing was deleted (pass --yes to delete)\n`,
    );
  } else {
    lines.push(
      `cleanup: ${plan.summary.entries} entries; deleted ${execution.removed.length} of ${plan.summary.delete}, ` +
        `freed ${execution.freedBytes} bytes; ${plan.summary.keep} kept, ${plan.summary.report} report-only\n`,
    );
  }
  return lines.join("");
}

/** Parse a `--keep-*` value; a non-integer is a usage problem, never a default. */
function parseCount(
  raw: string | undefined,
  fallback: number,
  flag: string,
  problems: string[],
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    problems.push(`${flag} expects a non-negative integer, got "${raw}"`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    problems.push(`${flag} is too large: ${raw}`);
    return fallback;
  }
  return value;
}

/** Run one `cleanup` invocation and return its exit code. */
export async function runCleanupCommand(args: ParsedArgs, deps: CleanupCommandDeps): Promise<number> {
  const { ports, io } = deps;
  const dryRun = args.dryRun || !args.yes;

  const problems: string[] = [...flagProblems(args, CLEANUP_FLAGS)];
  const retention: CleanupRetention = {
    batches: parseCount(args.keepBatches, DEFAULT_KEEP_BATCHES, "--keep-batches", problems),
    homes: parseCount(args.keepHomes, DEFAULT_KEEP_HOMES, "--keep-homes", problems),
    includePkg: args.includePkg,
  };
  const workRoot = resolveWorkRoot(ports.env.cwd(), args.workRoot);

  if (problems.length > 0) {
    const error = problems.join("; ");
    io.stderr(`dsh-verify cleanup: ${error}\n${CLEANUP_USAGE}\n`);
    if (args.json) {
      io.stdout(
        renderJson({
          ok: false,
          dryRun,
          workRoot,
          exists: false,
          retention,
          plan: null,
          execution: null,
          problems: [],
          error,
        }),
      );
    }
    return EXIT_CODES.blocked;
  }

  if (args.dryRun && args.yes) {
    io.stderr("dsh-verify cleanup: --dry-run overrides --yes; nothing will be deleted\n");
  }

  const guard = await guardCleanupRoot(ports.fs, workRoot, {
    homeDir: ports.env.homeDir(),
    cwd: ports.env.cwd(),
    tmpDir: ports.env.tmpDir(),
  });
  if (!guard.ok) {
    const error = formatFailure(guard.error);
    io.stderr(`dsh-verify cleanup: ${error}\n`);
    if (args.json) {
      io.stdout(
        renderJson({
          ok: false,
          dryRun,
          workRoot,
          exists: false,
          retention,
          plan: null,
          execution: null,
          problems: [],
          error,
        }),
      );
    }
    return EXIT_CODES.blocked;
  }

  const scan = await scanWorkRoot(ports.fs, workRoot);
  const plan = planCleanup(scan, retention, ports.clock);
  for (const problem of plan.problems) io.stderr(`dsh-verify cleanup: ${problem}\n`);

  const execution = dryRun
    ? NOTHING_EXECUTED
    : await executeCleanup(plan, ports, [ports.env.homeDir(), ports.env.cwd(), ports.env.tmpDir()]);
  for (const failure of execution.failed) {
    io.stderr(`dsh-verify cleanup: failed to delete ${failure.relativePath}: ${failure.error}\n`);
  }

  const ok = plan.problems.length === 0 && execution.failed.length === 0;
  if (args.json) {
    io.stdout(
      renderJson({
        ok,
        dryRun,
        workRoot,
        exists: scan.exists,
        retention,
        plan,
        execution,
        problems: plan.problems,
      }),
    );
  } else {
    io.stdout(renderHuman(plan, execution, dryRun, scan.exists));
  }
  return ok ? EXIT_CODES.ok : EXIT_CODES.hardFailure;
}
