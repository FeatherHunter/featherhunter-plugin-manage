/**
 * `dsh-verify concurrent` — launch N isolated instances at once, prove they are
 * isolated, and prove every one of them was reclaimed.
 *
 * The command is the concurrent sibling of `launch`: same three phases, same
 * report/evidence contract, but the unit of success is the *set* rather than one
 * instance. The orchestration lives in `orchestration/concurrent.ts`; this file
 * owns argument validation, the run directory, the report, and the exit code.
 *
 * Exit codes follow the report, with one deliberate exception: invalid input
 * (bad `--count`, `--profiles` that does not match `--count`, an unknown flag)
 * never gets a report — there is nothing to verify yet — and maps to 2 so scripts
 * can tell "you asked for something impossible" from "the run found a problem".
 *
 * Output contract in `--json` mode: exactly one JSON document on stdout; every
 * human line, progress line and verdict goes to stderr. Human mode prints the
 * check lines plus the per-instance comparison table on stdout.
 */
import { EXIT_CODES } from "../../capability-description";
import { parseProfileName, type ProfileName } from "../../contracts/branding";
import type { DshRuntimePaths } from "../../contracts/launch-plan";
import type { Ports } from "../../contracts/ports";
import { formatFailure, type Failure } from "../../contracts/result";
import {
  createRunReport,
  exitCodeOfRun,
  finishRunReport,
  runReportJson,
  verdictLine,
  type RunReport,
  type RunStep,
} from "../../contracts/run-state";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import { createEvidenceStore, evidenceRefs, type EvidenceStore } from "../../evidence/store";
import {
  CONCURRENT_COMMAND,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  buildConcurrentRows,
  cleanupConcurrent,
  concurrentFailure,
  concurrentProfilesLabel,
  describeConcurrentRow,
  executeConcurrent,
  planConcurrentChecks,
  planConcurrentInstances,
  type ConcurrentContext,
  type ConcurrentFailure,
  type ConcurrentRow,
  type ConcurrentTarget,
} from "../../orchestration/concurrent";
import { loadDeclarationContext, profileDirectory, resolveWorkRoot } from "../../orchestration/context";
import { projectInstancePlan } from "../../orchestration/instance";
import {
  renderCheckLines,
  withReportDigest,
  writeRunReport,
  type HumanReportTail,
} from "../../orchestration/report";
import { prepareRunDirectory } from "../../orchestration/run-directory";
import { executePlan } from "../../orchestration/runner";
import { discoverDsh, hostCliPath } from "../../runtime/dsh/discover";
import { joinFsPath } from "../../runtime/paths";
import type { RuntimeFacts } from "../../runtime/types";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected; the CLI wires the real machine. */
export interface ConcurrentCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

/** Flags this command accepts; `flagProblems` rejects everything else. */
const CONCURRENT_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--profile",
  "--declaration",
  "--work-root",
  "--count",
  "--profiles",
  "--keep",
  "--dry-run",
]);

const CONCURRENT_USAGE =
  "usage: dsh-verify concurrent [--count N] [--profiles a,b,c] [--profile name] " +
  "[--declaration path] [--work-root dir] [--keep] [--dry-run] [--json]";

/** `--count`: absent means the default; anything else must be a plain integer. */
function parseCount(raw: string | undefined): { readonly count: number } | { readonly problem: string } {
  if (raw === undefined) return { count: DEFAULT_CONCURRENCY };
  if (!/^[0-9]+$/.test(raw)) {
    return { problem: `--count needs an integer between 1 and ${MAX_CONCURRENCY}, got "${raw}"` };
  }
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CONCURRENCY) {
    return { problem: `--count needs an integer between 1 and ${MAX_CONCURRENCY}, got "${raw}"` };
  }
  return { count };
}

/**
 * `--profiles`: comma separated, one name per instance.
 *
 * A mismatch is invalid input rather than a blocked run: the caller asked for N
 * instances and named M profiles, and guessing which one to repeat would make the
 * report lie about what was tested.
 */
function parseProfiles(
  raw: string | undefined,
  count: number,
  baseProfile: ProfileName,
): { readonly names: readonly ProfileName[] } | { readonly problem: string } {
  if (raw === undefined) {
    return { names: Array.from({ length: count }, () => baseProfile) };
  }
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.length !== count) {
    return {
      problem:
        `--profiles needs exactly ${count} comma separated name(s) to match --count ${count}, ` +
        `got ${entries.length}: "${raw}"`,
    };
  }
  const names: ProfileName[] = [];
  for (const entry of entries) {
    if (entry.length === 0) return { problem: `--profiles has an empty entry: "${raw}"` };
    const parsed = parseProfileName(entry);
    if (!parsed.ok) {
      return {
        problem: `--profiles entry "${entry}" is not a valid profile name: ${formatFailure(parsed.error)}`,
      };
    }
    names.push(parsed.value);
  }
  return { names };
}

/** The launch-side half of the JSON contract: one failure document. */
function failureJson(stage: string, error: Failure): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: CONCURRENT_COMMAND,
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.details === undefined ? {} : { details: error.details }),
      stage,
    },
  })}\n`;
}

/** Report invalid input in whichever mode the caller asked for; no run directory. */
function reject(args: ParsedArgs, deps: ConcurrentCommandDeps, stage: string, message: string): number {
  deps.io.stderr(`dsh-verify ${CONCURRENT_COMMAND}: ${message}\n`);
  if (args.json) deps.io.stdout(failureJson(stage, { code: "invalid-input", message }));
  return EXIT_CODES.blocked;
}

/** Human body of a run: check lines, then the per-instance four-field table. */
function renderConcurrentHuman(
  report: RunReport,
  rows: readonly ConcurrentRow[],
  tail: HumanReportTail,
): string {
  const lines: string[] = [];
  for (const check of report.checks) lines.push(...renderCheckLines(check));
  lines.push(`instances (${rows.length}):`);
  for (const row of rows) lines.push(`  ${describeConcurrentRow(row)}`);
  lines.push(`report: ${tail.reportPath}`);
  lines.push(`report-sha256: ${tail.reportSha256}`);
  lines.push(`evidence: ${tail.evidenceDir} (${tail.evidenceCount} item(s))`);
  return lines.join("\n");
}

/** Human body of `--dry-run`: the plans, without touching the disk or a process. */
function renderDryRunHuman(
  names: readonly ProfileName[],
  projections: readonly ReturnType<typeof projectInstancePlan>[],
): string {
  const lines = [
    "concurrent plan (dry run) — nothing was written and no process was started",
    `instances: ${projections.length}`,
    `profiles: ${names.join(", ")}`,
  ];
  projections.forEach((projection, offset) => {
    lines.push(`instance ${offset + 1}: id ${projection.instanceId} profile ${projection.profile}`);
    lines.push(`  dir: ${projection.dir}`);
    lines.push(`  home: ${projection.home}`);
    lines.push(`  start-cwd: ${projection.workdir}`);
    lines.push(
      `  port: ${projection.port === 0 ? "0 (ephemeral, assigned by the host)" : String(projection.port)}`,
    );
    lines.push(`  plugin-log: ${projection.logFiles.pluginLogDir ?? "(not declared)"}`);
    lines.push(`  argv: ${projection.argv.join(" ")}`);
  });
  return lines.join("\n");
}

interface EmitReportOptions {
  readonly args: ParsedArgs;
  readonly deps: ConcurrentCommandDeps;
  readonly report: RunReport;
  readonly rows: readonly ConcurrentRow[];
  readonly runDir: string;
  readonly evidence: EvidenceStore;
  readonly note?: (message: string) => void;
}

/**
 * Write the report, then print it.
 *
 * Writing first is not cosmetic: stdout can fail, and the record on disk is what
 * the Lead and the evidence review act on. The exit code always comes from the
 * finished report.
 */
async function finishAndEmit(options: EmitReportOptions): Promise<number> {
  const { args, deps, report, rows } = options;
  const { fs } = deps.ports;
  const written = await writeRunReport({ fs, runDir: options.runDir, report });
  if (!written.ok) {
    deps.io.stderr(
      `dsh-verify ${CONCURRENT_COMMAND}: could not write the run report: ${formatFailure(written.error)}\n`,
    );
    return EXIT_CODES.blocked;
  }
  const finalReport = withReportDigest(report, written.value);
  const tail: HumanReportTail = {
    reportPath: written.value.reportPath,
    reportSha256: written.value.reportSha256,
    evidenceDir: options.evidence.root,
    evidenceCount: options.evidence.items().length,
  };
  const human = renderConcurrentHuman(finalReport, rows, tail);
  if (args.json) {
    deps.io.stdout(`${runReportJson(finalReport)}\n`);
    deps.io.stderr(`${human}\n`);
    deps.io.stderr(`${verdictLine(finalReport)}\n`);
  } else {
    deps.io.stdout(`${human}\n`);
  }
  const code = exitCodeOfRun(finalReport);
  options.note?.(`exit ${code}`);
  return code;
}

interface BlockedOptions {
  readonly args: ParsedArgs;
  readonly deps: ConcurrentCommandDeps;
  readonly stage: ConcurrentFailure["stage"];
  readonly error: Failure;
  readonly workRoot: string;
  readonly startedAt: string;
  readonly count: number;
  readonly profiles: readonly ProfileName[];
  readonly dshHome: string | null;
}

/**
 * Emit a blocked run: the environment is missing a prerequisite, so no instance
 * was launched. A blocked check is never a fail — the command returns 2 and the
 * report says exactly which prerequisite was missing.
 */
async function emitBlocked(options: BlockedOptions): Promise<number> {
  const { args, deps, error } = options;
  const { ports, io } = deps;
  const { clock, fs } = ports;
  io.stderr(`dsh-verify ${CONCURRENT_COMMAND}: ${formatFailure(error)}\n`);
  if (args.dryRun) {
    if (args.json) io.stdout(failureJson(options.stage, error));
    return EXIT_CODES.blocked;
  }
  const prepared = await prepareRunDirectory({
    fs,
    workRoot: options.workRoot,
    command: CONCURRENT_COMMAND,
    startedAt: options.startedAt,
  });
  if (!prepared.ok) {
    io.stderr(
      `dsh-verify ${CONCURRENT_COMMAND}: could not create the run directory under ${options.workRoot}: ${formatFailure(prepared.error)}\n`,
    );
    return EXIT_CODES.blocked;
  }
  const evidence = createEvidenceStore({ fs, root: prepared.value.evidenceDir, clock });
  const recorded = await evidence.recordJson(
    "concurrent-blocked",
    {
      stage: options.stage,
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
      details: error.details ?? null,
      workRoot: options.workRoot,
      dshHome: options.dshHome,
    },
    { note: "why the concurrent run could not plan its instances" },
  );
  if (!recorded.ok) {
    io.stderr(
      `dsh-verify ${CONCURRENT_COMMAND}: could not record the blocked evidence: ${formatFailure(recorded.error)}\n`,
    );
  }
  const context: ConcurrentContext = {
    count: options.count,
    rows: [],
    failure: concurrentFailure(options.stage, error),
    workRoot: options.workRoot,
    dshHome: options.dshHome ?? "",
    ports,
    evidenceRefs: evidenceRefs(evidence.items()),
  };
  const outcome = await executePlan(planConcurrentChecks(), context, { ports, clock });
  const report = finishRunReport(
    createRunReport({
      command: CONCURRENT_COMMAND,
      profile:
        options.profiles.length === 0
          ? (args.profile ?? "(declaration not loaded)")
          : concurrentProfilesLabel(options.profiles),
      startedAt: options.startedAt,
      notes: [`work root: ${options.workRoot}`],
    }),
    {
      checks: outcome.results,
      steps: [],
      finishedAt: clock.iso(),
      artifacts: { report: joinFsPath(prepared.value.runDir, "run.json"), evidence: prepared.value.evidenceDir },
    },
  );
  return finishAndEmit({
    args,
    deps,
    report,
    rows: [],
    runDir: prepared.value.runDir,
    evidence,
  });
}

/** The plan → launch → cleanup → report steps, in the order the report lists them. */
function buildSteps(input: {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly plannedIds: readonly string[];
  readonly readyCount: number;
  readonly failedCount: number;
  readonly cleanup: { readonly stopped: number; readonly residualPids: readonly number[] };
}): readonly RunStep[] {
  return [
    {
      id: "plan",
      title: `plan ${input.plannedIds.length} isolated instance(s)`,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      state: "done",
      detail: `instance ids: ${input.plannedIds.join(", ")}`,
    },
    {
      id: "launch",
      title: `launch ${input.plannedIds.length} instance(s) concurrently`,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      state: input.failedCount === 0 ? "done" : "failed",
      detail: `${input.readyCount} ready, ${input.failedCount} failed`,
    },
    {
      id: "cleanup",
      title: "stop every launched instance and verify its pid is gone",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      state: input.cleanup.residualPids.length === 0 ? "done" : "failed",
      detail: `stopped ${input.cleanup.stopped} instance(s), ${input.cleanup.residualPids.length} residual process(es)`,
    },
  ];
}

/** Run one `concurrent` invocation and return its exit code. */
export async function runConcurrentCommand(
  args: ParsedArgs,
  deps: ConcurrentCommandDeps,
): Promise<number> {
  const { ports, io } = deps;
  const { clock, fs } = ports;

  const problems = flagProblems(args, CONCURRENT_FLAGS);
  if (problems.length > 0) {
    return reject(args, deps, "usage", `${problems.join("; ")}\n${CONCURRENT_USAGE}`);
  }

  const parsedCount = parseCount(args.count);
  if ("problem" in parsedCount) return reject(args, deps, "usage", parsedCount.problem);
  const count = parsedCount.count;

  const cwd = ports.env.cwd();
  const startedAt = clock.iso();
  const workRoot = resolveWorkRoot(cwd, args.workRoot);
  const loaded = await loadDeclarationContext({
    ports,
    cwd,
    nodeVersion: deps.runtime.nodeVersion,
    workRoot,
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
    ...(args.profile === undefined ? {} : { profileOverride: args.profile }),
    ...(deps.loadDeclaration === undefined ? {} : { loadDeclaration: deps.loadDeclaration }),
  });
  if (!loaded.ok) {
    return emitBlocked({
      args,
      deps,
      stage: loaded.error.stage,
      error: loaded.error.failure,
      workRoot,
      startedAt,
      count,
      profiles: [],
      dshHome: null,
    });
  }
  const context = loaded.value;
  const dshHome = context.dshHome;

  const parsedProfiles = parseProfiles(args.profiles, count, context.profileName);
  if ("problem" in parsedProfiles) return reject(args, deps, "profiles", parsedProfiles.problem);
  const names = parsedProfiles.names;

  const discovered = await discoverDsh({ fs, env: ports.env });
  if (!discovered.ok) {
    return emitBlocked({
      args,
      deps,
      stage: "runtime",
      error: discovered.error,
      workRoot,
      startedAt,
      count,
      profiles: names,
      dshHome,
    });
  }
  const runtime: DshRuntimePaths = { exe: discovered.value.exe, cliJs: hostCliPath(discovered.value) };
  const targets: readonly ConcurrentTarget[] = names.map((profileName) => ({
    profileName,
    profileDir: profileDirectory(dshHome, profileName),
  }));

  const planned = await planConcurrentInstances({
    ports,
    runtime,
    dshHome,
    profile: context.profile,
    workRoot,
    targets,
    startedAtMs: clock.nowMs(),
    keep: args.keep,
  });
  if (!planned.ok) {
    return emitBlocked({
      args,
      deps,
      stage: "plan",
      error: planned.error,
      workRoot,
      startedAt,
      count,
      profiles: names,
      dshHome,
    });
  }
  const plans = planned.value;

  if (args.dryRun) {
    const projections = plans.map((plan) => projectInstancePlan(plan));
    if (args.json) {
      io.stdout(
        `${JSON.stringify({
          schemaVersion: 1,
          command: CONCURRENT_COMMAND,
          ok: true,
          dryRun: true,
          count: plans.length,
          instances: projections,
        })}\n`,
      );
    } else {
      io.stdout(`${renderDryRunHuman(names, projections)}\n`);
    }
    return EXIT_CODES.ok;
  }

  const prepared = await prepareRunDirectory({ fs, workRoot, command: CONCURRENT_COMMAND, startedAt });
  if (!prepared.ok) {
    io.stderr(
      `dsh-verify ${CONCURRENT_COMMAND}: could not create the run directory under ${workRoot}: ${formatFailure(prepared.error)}\n`,
    );
    return EXIT_CODES.blocked;
  }
  const { runDir, evidenceDir } = prepared.value;
  const evidence = createEvidenceStore({ fs, root: evidenceDir, clock });
  const note = (message: string): void => {
    io.stderr(`dsh-verify ${CONCURRENT_COMMAND}: ${message}\n`);
  };

  const environment = await evidence.recordJson(
    "environment",
    {
      platform: ports.env.platform(),
      nodeVersion: deps.runtime.nodeVersion,
      cwd,
      workRoot,
      dshHome,
      count,
      profiles: names,
      declaration: {
        path: context.declaration.path,
        kind: context.declaration.kind,
        exportName: context.declaration.exportName,
        requiredNode: context.declaration.requiredNode,
      },
    },
    { note: "the environment this concurrent run observed" },
  );
  if (!environment.ok) {
    io.stderr(
      `dsh-verify ${CONCURRENT_COMMAND}: could not record the environment evidence: ${formatFailure(environment.error)}\n`,
    );
  }

  note(`launching ${count} instance(s) for profile(s) ${concurrentProfilesLabel(names)} under ${workRoot}`);
  const executed = await executeConcurrent({ ports, runtime, plans, note });
  note("cleaning up every launched instance");
  const cleanup = await cleanupConcurrent({ ports, executed, note });
  if (cleanup.residualPids.length > 0) {
    io.stderr(
      `dsh-verify ${CONCURRENT_COMMAND}: warning: ${cleanup.residualPids.length} instance process(es) survived the stop request: ${cleanup.residualPids.join(", ")}\n`,
    );
  }
  const rows = buildConcurrentRows({ plans, executed, cleanup });

  const recorded = await evidence.recordJson(
    "instances",
    {
      count,
      profiles: names,
      rows: rows.map((row) => ({
        index: row.index,
        instanceId: row.instanceId,
        profile: row.profile,
        dir: row.dir,
        home: row.home,
        workdir: row.workdir,
        pluginLogDir: row.pluginLogDir,
        pid: row.pid,
        port: row.port,
        tokenPresent: row.tokenPresent,
        readiness: row.readiness,
        failure:
          row.failure === null
            ? null
            : { code: row.failure.code, message: row.failure.message, hint: row.failure.hint ?? null },
        cleanup: row.cleanup,
      })),
      residualPids: cleanup.residualPids,
    },
    { note: "the per-instance four-field comparison this report is based on" },
  );
  const artifactPath = recorded.ok ? joinFsPath(evidenceDir, recorded.value.path) : undefined;

  const checkContext: ConcurrentContext = {
    count,
    rows,
    failure: null,
    workRoot,
    dshHome,
    ports,
    evidenceRefs: evidenceRefs(evidence.items()),
  };
  const processed = await executePlan(planConcurrentChecks(), checkContext, { ports, clock, note });

  const readyCount = rows.filter((row) => row.readiness === "ready").length;
  const failedCount = rows.filter((row) => row.readiness === "failed").length;
  const finishedAt = clock.iso();
  const steps = buildSteps({
    startedAt,
    finishedAt,
    plannedIds: plans.map((plan) => plan.instanceId),
    readyCount,
    failedCount,
    cleanup: { stopped: cleanup.rows.length, residualPids: cleanup.residualPids },
  });
  const report = finishRunReport(
    createRunReport({
      command: CONCURRENT_COMMAND,
      profile: concurrentProfilesLabel(names),
      startedAt,
      notes: [`work root: ${workRoot}`, `instances: ${count} (${concurrentProfilesLabel(names)})`],
    }),
    {
      checks: processed.results,
      steps,
      finishedAt,
      artifacts: {
        report: joinFsPath(runDir, "run.json"),
        evidence: evidenceDir,
        ...(artifactPath === undefined ? {} : { instances: artifactPath }),
      },
      notes: [
        `dsh home: ${dshHome}`,
        `ready: ${readyCount}/${count}; failed: ${failedCount}`,
        actualRowNotes(rows),
      ]
        .flat()
        .filter((line): line is string => line.length > 0),
    },
  );
  return finishAndEmit({ args, deps, report, rows, runDir, evidence, note });
}

/** The per-instance four-field comparison, as report notes. */
function actualRowNotes(rows: readonly ConcurrentRow[]): readonly string[] {
  return rows.map((row) => describeConcurrentRow(row));
}
