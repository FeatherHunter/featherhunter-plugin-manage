/**
 * `dsh-verify single-instance` — the L1 gate: one isolated instance, the declared
 * checks, evidence on disk, one report.
 *
 * This command is composition, not new mechanics. Planning and execution come
 * from `planInstance`/`executeInstance`; the checks come from the check modules;
 * the report and its sha256 come from `report.ts`. What lives here is the order
 * and the CLI contract:
 *
 *   flags → declaration context → plan → (dry run stops here)
 *   → run directory + evidence store → executeInstance
 *   → instance checks (reachable, logs-readable, instance-pages)
 *   → teardown (stop + re-check liveness, or leave it running under `--keep`)
 *   → teardown-clean → run.json → human/JSON output → exit code
 *
 * The dry run calls the same `planInstance` value the real run executes. It is
 * the one path with a hard zero-write guarantee: no run directory, no evidence,
 * no spawn.
 *
 * Exit codes follow the shared check contract: `0` every hard check passed (a
 * skip is allowed), `1` a hard check failed, `2` a prerequisite or adapter is
 * missing (`blocked`). `--json` puts exactly one report document on stdout;
 * every progress and warning line goes to stderr.
 */
import { EXIT_CODES } from "../../capability-description";
import type { EvidenceItemRef } from "../../contracts/evidence-contract";
import type { DshRuntimePaths } from "../../contracts/launch-plan";
import type { Ports } from "../../contracts/ports";
import type { RunReport, RunStep } from "../../contracts/run-state";
import {
  createRunReport,
  exitCodeOfRun,
  finishRunReport,
  runReportJson,
  verdictLine,
} from "../../contracts/run-state";
import { formatFailure, type Failure } from "../../contracts/result";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import type { EvidenceStore } from "../../evidence/store";
import { createEvidenceStore, evidenceRefs } from "../../evidence/store";
import {
  createLogsReadableCheck,
  type SingleInstanceCheckContext,
} from "../../orchestration/checks/logs-readable";
import { recordEvidence } from "../../orchestration/checks/shared";
import { createTeardownCleanCheck } from "../../orchestration/checks/teardown-clean";
import {
  cleanupConcurrent,
  type ConcurrentCleanup,
  type ConcurrentContext,
  type ConcurrentRow,
} from "../../orchestration/concurrent";
import { loadDeclarationContext } from "../../orchestration/context";
import {
  executeInstance,
  planInstance,
  projectInstancePlan,
  READINESS_CRITERION,
  type InstanceFailure,
  type InstancePlan,
  type PlanProjection,
} from "../../orchestration/instance";
import { createPageCheckModule, type PageCheckInstance } from "../../orchestration/page-check";
import {
  renderCheckLines,
  withReportDigest,
  writeRunReport,
  type HumanReportTail,
} from "../../orchestration/report";
import { prepareRunDirectory } from "../../orchestration/run-directory";
import { executePlan } from "../../orchestration/runner";
import {
  blocked,
  checkId,
  failed,
  passed,
  skipped,
  type CheckModule,
  type CheckOutcome,
} from "../../orchestration/types";
import { discoverDsh, hostCliPath } from "../../runtime/dsh/discover";
import { tailOf, type InstanceReadiness, type InstanceRecord } from "../../runtime/dsh/launch";
import type { RuntimeFacts } from "../../runtime/types";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected; the CLI wires the real machine. */
export interface SingleInstanceCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

/** The command name, used in reports, JSON documents and error prefixes. */
export const SINGLE_INSTANCE_COMMAND = "single-instance";

/** The usage line, repeated in flag errors so a caller never has to read `describe`. */
export const SINGLE_INSTANCE_USAGE =
  "dsh-verify single-instance [--profile <p>] [--declaration <file>] [--work-root <dir>] [--keep] [--dry-run] [--json]";

/** Flags this command implements; anything else recognized is a usage error. */
const SINGLE_INSTANCE_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--profile",
  "--declaration",
  "--work-root",
  "--keep",
  "--dry-run",
]);

/* --------------------------------------------------------------- observations */

/** What the launch step proved, in the shape the checks read. */
type LaunchObservation =
  | {
      readonly outcome: "ready";
      readonly record: InstanceRecord;
      readonly readiness: InstanceReadiness;
      readonly evidence: readonly EvidenceItemRef[];
    }
  | {
      readonly outcome: "failed";
      readonly failure: InstanceFailure;
      readonly stdoutTail: string;
      readonly stderrTail: string;
      readonly evidence: readonly EvidenceItemRef[];
    };

/** The minimal context `instance-reachable` reads; the full context extends it. */
interface LaunchContext {
  readonly launch: LaunchObservation;
}

/** The full context the instance checks share. `cleanup` is null until teardown. */
interface SingleInstanceContext extends SingleInstanceCheckContext {
  readonly launch: Extract<LaunchObservation, { readonly outcome: "ready" }>;
  readonly page: PageCheckInstance;
  readonly cleanup: ConcurrentCleanup | null;
  readonly keep: boolean;
  readonly workRoot: string;
  readonly dshHome: string;
  readonly cwd: string;
}

/* --------------------------------------------------------------------- checks */

/**
 * The readiness check.
 *
 * `executeInstance` already decided readiness; this check turns that decision
 * into the report's vocabulary. A launch that never got a chance to run (missing
 * prerequisite) is `blocked`; a host that started and then died or stayed
 * unready is a hard `fail` carrying the captured log tails, because the product
 * really was observed failing.
 */
function createInstanceReachableCheck(): CheckModule<LaunchContext> {
  return {
    id: checkId("instance-reachable"),
    title: "the instance answers on its token URL with every enabled plugin active",
    hard: true,
    requires: [],
    onMissing: "skip",
    run(context: LaunchContext): CheckOutcome {
      const launch = context.launch;
      if (launch.outcome === "ready") {
        const { record, readiness } = launch;
        return passed(
          `instance ${record.instanceId ?? "(no id)"} is ready: pid ${record.pid}, port ${record.port}, ` +
            `connect HTTP ${readiness.connectStatus}, ` +
            `${readiness.inventory.activeCount}/${readiness.inventory.enabledCount} enabled plugin entries active`,
          launch.evidence,
        );
      }
      const failure = launch.failure;
      if (failure.stage === "prerequisite") {
        return blocked(
          `the instance could not be started: ${failure.message}`,
          failure.hint ?? "fix the missing prerequisite and rerun single-instance",
          launch.evidence,
        );
      }
      const actual =
        `${failure.message} (stage: ${failure.stage})` +
        `\nstderr tail: ${launch.stderrTail.length === 0 ? "(empty)" : launch.stderrTail}` +
        `\nstdout tail: ${launch.stdoutTail.length === 0 ? "(empty)" : launch.stdoutTail}`;
      return failed(
        "the instance did not reach readiness",
        READINESS_CRITERION,
        actual,
        failure.hint ?? "read the instance logs for the first error; the tails above are the end of each log",
        launch.evidence,
      );
    },
  };
}

/**
 * `instance-pages`, bound to this command's context.
 *
 * The adapter is deliberately left unset so page-check keeps its precedence:
 * `ports.browser` (tests, callers) first, then the profile's declared module.
 * No adapter means `blocked` with the page-check hint, never a false failure.
 */
function createSingleInstancePagesCheck(): CheckModule<SingleInstanceContext> {
  const delegate = createPageCheckModule();
  return {
    id: delegate.id,
    title: delegate.title,
    hard: delegate.hard,
    requires: [],
    onMissing: "blocked",
    ...(delegate.missingHint === undefined ? {} : { missingHint: delegate.missingHint }),
    run: (context: SingleInstanceContext): CheckOutcome | Promise<CheckOutcome> =>
      delegate.run({
        ports: context.ports,
        instance: context.page,
        profile: context.profile,
        evidence: context.evidence,
        note: context.note,
        headless: true,
        repoRoot: context.cwd,
      }),
  };
}

/**
 * `teardown-clean`, bound to one instance.
 *
 * The stop already happened (or `--keep` replaced it); this wrapper only builds
 * the one-row context the concurrent check expects and delegates. Keeping the
 * delegate means the "is the pid really gone" semantics stay in one file.
 */
function createSingleInstanceTeardownCheck(): CheckModule<SingleInstanceContext> {
  const delegate = createTeardownCleanCheck();
  return {
    id: delegate.id,
    title: delegate.title,
    hard: delegate.hard,
    requires: [],
    onMissing: "skip",
    run(context: SingleInstanceContext): CheckOutcome | Promise<CheckOutcome> {
      const record = context.instance;
      const instanceId = record.instanceId ?? String(record.pid);
      if (context.keep) {
        return skipped(
          `--keep was requested: instance ${instanceId} (pid ${record.pid}) is still running`,
          `stop it with: dsh-verify stop --id ${instanceId} --work-root ${context.workRoot}`,
        );
      }
      if (context.cleanup === null) {
        return failed(
          "the teardown could not be observed",
          "every launched instance is stopped and its pid is gone",
          `pid ${record.pid} has no cleanup observation`,
          `stop it with: dsh-verify stop --id ${instanceId} --work-root ${context.workRoot}`,
        );
      }
      const row: ConcurrentRow = {
        index: 1,
        instanceId,
        profile: record.profile as ConcurrentRow["profile"],
        dir: record.dir ?? record.startCwd,
        home: record.home,
        workdir: record.startCwd,
        pluginLogDir: record.pluginLogDir,
        pid: record.pid,
        port: record.port,
        tokenPresent: record.tokenUrl.length > 0,
        readiness: "ready",
        failure: null,
        cleanup: context.cleanup,
      };
      const concurrent: ConcurrentContext = {
        count: 1,
        rows: [row],
        failure: null,
        workRoot: context.workRoot,
        dshHome: context.dshHome,
        ports: context.ports,
        evidenceRefs: evidenceRefs(context.evidence.items()),
      };
      return delegate.run(concurrent);
    },
  };
}

/* --------------------------------------------------------------------- output */

/** One human line for the model provenance; never a secret. */
function renderModel(model: InstancePlan["model"]): string {
  if (model === null) return "none (profile.model is false)";
  const credential = model.credentialAvailable
    ? `credential ${model.credentialSource}`
    : `credential missing (${model.apiKeyEnv} was not found)`;
  return `${model.provider}/${model.model} — ${credential}`;
}

/** Human body of `--dry-run`: the same plan the real run would execute. */
function renderDryRunHuman(plan: InstancePlan, projection: PlanProjection): string {
  const lines: string[] = [];
  lines.push("single-instance plan (dry run) — nothing was written and no process was started");
  lines.push(`instance id: ${plan.instanceId}`);
  lines.push(`profile: ${plan.profileName}`);
  lines.push(`instance dir: ${plan.layout.dir}`);
  lines.push(`home: ${plan.layout.home}`);
  lines.push(`userprofile: ${plan.layout.userprofile}`);
  lines.push(`workdir: ${plan.layout.workdir}`);
  lines.push(`argv: ${projection.argv.join(" ")}`);
  lines.push(`injected env: ${projection.envNames.length === 0 ? "(none)" : projection.envNames.join(", ")}`);
  lines.push(
    `secret env (names only): ${projection.secretEnvNames.length === 0 ? "(none)" : projection.secretEnvNames.join(", ")}`,
  );
  lines.push(`stdout log: ${projection.logFiles.stdout}`);
  lines.push(`stderr log: ${projection.logFiles.stderr}`);
  lines.push(`plugin log dir: ${projection.logFiles.pluginLogDir ?? "(not declared)"}`);
  lines.push(`profile copy: ${projection.profileCopy.sourceProfileDir} -> ${projection.profileCopy.targetProfileDir}`);
  lines.push(`port: ${projection.port === 0 ? "0 (ephemeral, assigned by the host)" : String(projection.port)}`);
  lines.push(`model: ${renderModel(projection.model)}`);
  lines.push(`keep: ${projection.keep ? "true (the instance would be left running)" : "false (the instance would be stopped after the checks)"}`);
  lines.push("notes:");
  for (const line of projection.notes) lines.push(`  - ${line}`);
  return `${lines.join("\n")}\n`;
}

/** The human report: check lines, the instance handle, then the evidence tail. */
function renderHuman(
  report: RunReport,
  record: InstanceRecord | null,
  keep: boolean,
  workRoot: string,
  tail: HumanReportTail,
): string {
  const lines: string[] = [];
  for (const check of report.checks) lines.push(...renderCheckLines(check));
  if (record !== null) {
    lines.push(
      `instance: ${record.instanceId ?? "(no id)"} pid ${record.pid} port ${record.port}`,
    );
    lines.push(`home: ${record.home}`);
    lines.push(`workdir: ${record.startCwd}`);
    if (keep) {
      lines.push(
        `kept: the instance is still running; stop it with dsh-verify stop --id ${record.instanceId ?? record.pid} --work-root ${workRoot}`,
      );
    }
  }
  lines.push(`report: ${tail.reportPath}`);
  lines.push(`report-sha256: ${tail.reportSha256}`);
  lines.push(`evidence: ${tail.evidenceDir} (${tail.evidenceCount} item(s))`);
  return lines.join("\n");
}

/** The launch-side half of the JSON contract: one failure document. */
function failureJson(stage: string, error: Failure): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: SINGLE_INSTANCE_COMMAND,
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

/** Report a usage/prerequisite problem in whichever mode the caller asked for. */
function reject(args: ParsedArgs, io: CliIo, stage: string, message: string): number {
  io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: ${message}\n`);
  if (args.json) io.stdout(failureJson(stage, { code: "invalid-input", message }));
  return EXIT_CODES.blocked;
}

/* ---------------------------------------------------------------------- steps */

interface StepsInput {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly launchState: "done" | "failed";
  readonly launchDetail: string;
  readonly checkCount: number;
  readonly cleanupState: "done" | "skipped";
  readonly cleanupDetail: string;
}

/** The four phases a reader expects to see, in execution order. */
function buildSteps(input: StepsInput): readonly RunStep[] {
  return [
    {
      id: "plan",
      title: "resolve the declaration and plan one isolated instance",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      state: "done",
      detail: "one isolated instance planned; the same plan is what the launch step executed",
    },
    {
      id: "launch",
      title: "start the host and wait for readiness",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      state: input.launchState,
      detail: input.launchDetail,
    },
    {
      id: "checks",
      title: "run the instance checks",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      state: "done",
      detail: `${input.checkCount} check(s)`,
    },
    {
      id: "cleanup",
      title: "stop the instance and confirm its pid is gone",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      state: input.cleanupState,
      detail: input.cleanupDetail,
    },
  ];
}

/* ---------------------------------------------------------------- completion */

interface FinishInput {
  readonly args: ParsedArgs;
  readonly deps: SingleInstanceCommandDeps;
  readonly report: RunReport;
  readonly runDir: string;
  readonly evidence: EvidenceStore;
  readonly record: InstanceRecord | null;
  readonly keep: boolean;
  readonly workRoot: string;
}

/**
 * Write the report, then print it.
 *
 * The report lands before stdout so a caller that reads stdout and opens
 * `run.json` never races the writer. With `--json` stdout carries exactly one
 * document and everything a human would read goes to stderr.
 */
async function finishAndEmit(input: FinishInput): Promise<number> {
  const { args, deps, io } = { args: input.args, deps: input.deps, io: input.deps.io };
  const written = await writeRunReport({ fs: deps.ports.fs, runDir: input.runDir, report: input.report });
  if (!written.ok) {
    io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: could not write the report: ${formatFailure(written.error)}\n`);
    if (args.json) io.stdout(failureJson("report", written.error));
    return EXIT_CODES.blocked;
  }
  const report = withReportDigest(input.report, written.value);
  const tail: HumanReportTail = {
    reportPath: written.value.reportPath,
    reportSha256: written.value.reportSha256,
    evidenceDir: input.evidence.root,
    evidenceCount: input.evidence.items().length,
  };
  const human = renderHuman(report, input.record, input.keep, input.workRoot, tail);
  if (args.json) {
    io.stdout(`${runReportJson(report)}\n`);
    io.stderr(`${human}\n`);
    io.stderr(`${verdictLine(report)}\n`);
  } else {
    io.stdout(`${human}\n`);
  }
  return exitCodeOfRun(report);
}

/** Evidence for one instance's readiness, with the token left out on purpose. */
async function recordInstance(
  evidence: EvidenceStore,
  record: InstanceRecord,
  readiness: InstanceReadiness,
  warn: (message: string) => void,
): Promise<readonly EvidenceItemRef[]> {
  return recordEvidence(
    evidence,
    "single-instance-instance",
    {
      instanceId: record.instanceId ?? null,
      pid: record.pid,
      port: record.port,
      profile: record.profile,
      home: record.home,
      userprofile: record.userprofile,
      workdir: record.startCwd,
      readyMs: record.readyMs,
      connectStatus: readiness.connectStatus,
      inventory: readiness.inventory,
      pluginLogDir: record.pluginLogDir,
    },
    "instance readiness as reported by the host; the token URL is deliberately not recorded",
    warn,
  );
}

/**
 * Run one `single-instance` invocation and return its exit code.
 *
 * Everything below the CLI contract already exists; the flow here is the order in
 * which those pieces are called and the mapping from their Results to the
 * pass/fail/skip/blocked vocabulary.
 */
export async function runSingleInstanceCommand(
  args: ParsedArgs,
  deps: SingleInstanceCommandDeps,
): Promise<number> {
  const { ports, io } = deps;

  const problems = flagProblems(args, SINGLE_INSTANCE_FLAGS);
  if (problems.length > 0) {
    return reject(args, io, "usage", `${problems.join("; ")}\n${SINGLE_INSTANCE_USAGE}`);
  }

  const startedAt = ports.clock.iso();
  const cwd = ports.env.cwd();
  const context = await loadDeclarationContext({
    ports,
    cwd,
    nodeVersion: deps.runtime.nodeVersion,
    ...(args.workRoot === undefined ? {} : { workRoot: args.workRoot }),
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
    ...(args.profile === undefined ? {} : { profileOverride: args.profile }),
    ...(deps.loadDeclaration === undefined ? {} : { loadDeclaration: deps.loadDeclaration }),
  });
  if (!context.ok) {
    const stage = context.error.stage;
    const failure = context.error.failure;
    io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: ${formatFailure(failure)}\n`);
    if (args.json) io.stdout(failureJson(stage, failure));
    return EXIT_CODES.blocked;
  }

  const runtime = await discoverDsh({ fs: ports.fs, env: ports.env });
  if (!runtime.ok) {
    io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: ${formatFailure(runtime.error)}\n`);
    if (args.json) io.stdout(failureJson("runtime", runtime.error));
    return EXIT_CODES.blocked;
  }

  const runtimePaths: DshRuntimePaths = { exe: runtime.value.exe, cliJs: hostCliPath(runtime.value) };

  const planned = await planInstance({
    ports,
    runtime: runtimePaths,
    dshHome: context.value.dshHome,
    profileName: context.value.profileName,
    profile: context.value.profile,
    profileDir: context.value.profileDir,
    workRoot: context.value.workRoot,
    port: 0,
    keep: args.keep,
    startedAtMs: ports.clock.nowMs(),
  });
  if (!planned.ok) {
    const failure: InstanceFailure = planned.error;
    io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: ${formatFailure(failure)}\n`);
    if (args.json) io.stdout(failureJson(failure.stage, failure));
    return failure.stage === "prerequisite" ? EXIT_CODES.blocked : EXIT_CODES.hardFailure;
  }
  const plan = planned.value;
  const projection = projectInstancePlan(plan);

  if (args.dryRun) {
    if (args.json) {
      io.stdout(
        `${JSON.stringify({
          schemaVersion: 1,
          command: SINGLE_INSTANCE_COMMAND,
          ok: true,
          dryRun: true,
          plan: projection,
        })}\n`,
      );
    } else {
      io.stdout(renderDryRunHuman(plan, projection));
    }
    if (plan.modelNote !== null) io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: warning: ${plan.modelNote}\n`);
    return EXIT_CODES.ok;
  }

  if (plan.modelNote !== null) io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: warning: ${plan.modelNote}\n`);
  const note = (message: string): void => {
    io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: ${message}\n`);
  };
  const warn = (message: string): void => {
    io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: warning: ${message}\n`);
  };

  const prepared = await prepareRunDirectory({
    fs: ports.fs,
    workRoot: context.value.workRoot,
    command: SINGLE_INSTANCE_COMMAND,
    startedAt,
  });
  if (!prepared.ok) {
    io.stderr(`dsh-verify ${SINGLE_INSTANCE_COMMAND}: could not prepare a run directory: ${formatFailure(prepared.error)}\n`);
    if (args.json) io.stdout(failureJson("run-directory", prepared.error));
    return EXIT_CODES.blocked;
  }
  const runDir = prepared.value.runDir;
  const evidence = createEvidenceStore({ fs: ports.fs, root: prepared.value.evidenceDir, clock: ports.clock });

  const executed = await executeInstance({ ports, plan, runtime: runtimePaths, note });

  if (!executed.ok) {
    const failure = executed.error;
    const stdoutTail = await tailOf(ports.fs, plan.layout.stdoutLog);
    const stderrTail = await tailOf(ports.fs, plan.layout.stderrLog);
    const refs = await recordEvidence(
      evidence,
      "single-instance-launch",
      {
        stage: failure.stage,
        code: failure.code,
        message: failure.message,
        hint: failure.hint ?? null,
        stdoutTail,
        stderrTail,
        instanceDir: plan.layout.dir,
      },
      "launch failure with the tail of each instance log",
      warn,
    );
    const launch: LaunchObservation = { outcome: "failed", failure, stdoutTail, stderrTail, evidence: refs };
    const reachable = createInstanceReachableCheck();
    const outcome = await executePlan<LaunchContext>(
      { command: SINGLE_INSTANCE_COMMAND, checks: [reachable] },
      { launch },
      { ports, clock: ports.clock, note },
    );
    const results = outcome.results;
    const finishedAt = ports.clock.iso();
    const report = createRunReport({
      command: SINGLE_INSTANCE_COMMAND,
      profile: plan.profileName,
      startedAt,
      notes: [`work root: ${context.value.workRoot}`, `instance dir: ${plan.layout.dir}`],
    });
    const finished = finishRunReport(report, {
      checks: results,
      steps: buildSteps({
        startedAt,
        finishedAt,
        launchState: "failed",
        launchDetail: `launch failed: ${failure.message}`,
        checkCount: results.length,
        cleanupState: "done",
        cleanupDetail: "executeInstance reaped the failed launch; no process was left behind",
      }),
      finishedAt,
      artifacts: { evidence: evidence.root },
      notes: [`stopped: true (executeInstance reaped the failed launch)`],
    });
    return finishAndEmit({
      args,
      deps,
      report: finished,
      runDir,
      evidence,
      record: null,
      keep: args.keep,
      workRoot: context.value.workRoot,
    });
  }

  const { record, readiness } = executed.value;
  const readinessRefs = await recordInstance(evidence, record, readiness, warn);

  const reachable = createInstanceReachableCheck();
  const logsReadable = createLogsReadableCheck();
  const pageCheck = createSingleInstancePagesCheck();
  const contextBase: SingleInstanceContext = {
    ports,
    profile: context.value.profile,
    instance: record,
    evidence,
    note,
    launch: { outcome: "ready", record, readiness, evidence: readinessRefs },
    page: { url: record.tokenUrl, origin: record.originUrl, tokenUrl: record.tokenUrl },
    cleanup: null,
    keep: args.keep,
    workRoot: context.value.workRoot,
    dshHome: context.value.dshHome,
    cwd,
  };

  const preTeardownOutcome = await executePlan<SingleInstanceContext>(
    {
      command: SINGLE_INSTANCE_COMMAND,
      checks: [
        { ...reachable, run: (ctx: SingleInstanceContext) => reachable.run(ctx) },
        { ...logsReadable, run: (ctx: SingleInstanceContext) => logsReadable.run(ctx) },
        pageCheck,
      ],
    },
    contextBase,
    { ports, clock: ports.clock, note },
  );

  let cleanup: ConcurrentCleanup | null = null;
  let cleanupDetail = "the cleanup step was skipped";
  if (args.keep) {
    cleanupDetail = `instance ${record.instanceId ?? record.pid} (pid ${record.pid}) is still running (--keep)`;
  } else {
    const reclaimed = await cleanupConcurrent({
      ports,
      executed: [{ index: 1, plan, result: { ok: true, value: executed.value } }],
      note,
    });
    cleanup = reclaimed.rows[0]?.cleanup ?? null;
    cleanupDetail =
      cleanup === null
        ? "no cleanup observation was recorded"
        : cleanup.verified
          ? `pid ${record.pid} is gone; stopped.json was written`
          : `pid ${record.pid} could not be reclaimed: ${cleanup.error ?? "still alive"}`;
  }

  const teardown = createSingleInstanceTeardownCheck();
  const teardownResult = await executePlan<SingleInstanceContext>(
    { command: SINGLE_INSTANCE_COMMAND, checks: [teardown] },
    { ...contextBase, cleanup },
    { ports, clock: ports.clock, note },
  );
  const results = [...preTeardownOutcome.results, ...teardownResult.results];
  const finishedAt = ports.clock.iso();
  const stopNote = args.keep
    ? `stopped: false (--keep: instance ${record.instanceId ?? record.pid}, pid ${record.pid}, is still running)`
    : cleanup === null
      ? "stopped: unknown (no cleanup observation)"
      : `stopped: ${cleanup.stopped ? "true" : "false"} (pid ${record.pid}; stopped.json was written)`;

  const report = createRunReport({
    command: SINGLE_INSTANCE_COMMAND,
    profile: plan.profileName,
    startedAt,
    notes: [
      `work root: ${context.value.workRoot}`,
      `instance dir: ${plan.layout.dir}`,
      `plugin log dir: ${record.pluginLogDir ?? "(not declared)"}`,
    ],
  });
  const finished = finishRunReport(report, {
    checks: results,
    steps: buildSteps({
      startedAt,
      finishedAt,
      launchState: "done",
      launchDetail: `instance ${plan.instanceId} ready in ${record.readyMs}ms on port ${record.port}`,
      checkCount: results.length,
      cleanupState: args.keep ? "skipped" : "done",
      cleanupDetail,
    }),
    finishedAt,
    ...(projection.model === null ? {} : { model: projection.model }),
    artifacts: { evidence: evidence.root, instance: plan.layout.instancePath },
    notes: [stopNote],
  });
  return finishAndEmit({
    args,
    deps,
    report: finished,
    runDir,
    evidence,
    record,
    keep: args.keep,
    workRoot: context.value.workRoot,
  });
}
