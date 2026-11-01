/**
 * `concurrent` orchestration: plan N isolated instances, launch them together,
 * reap every one of them, and expose the per-instance facts a check can compare.
 *
 * The command's claim is not "two launches happened"; it is "two launches could
 * not have interfered". So the planner gives every instance a distinct id (a
 * distinct `startedAtMs`), the executor fans out with `Promise.allSettled` so one
 * failure cannot cancel the others, and the cleanup walk stops every instance
 * that did start — including when a sibling failed — then re-checks liveness
 * instead of trusting the kill request.
 *
 * "Failed launch" and "failed cleanup" are deliberately different facts:
 * `executeInstance` reaps a process it could not make ready, so a failed row needs
 * no cleanup; a cleanup row exists only for an instance that reached readiness.
 * That split is what lets `teardown-clean` pass on a run where one instance never
 * started.
 */
import type { ProfileName } from "../contracts/branding";
import type { EvidenceItemRef } from "../contracts/evidence-contract";
import type { DshRuntimePaths } from "../contracts/launch-plan";
import type { FsPort, Ports } from "../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../contracts/result";
import type { VerificationProfile } from "../contracts/verification-profile";
import { loadInstance, stopRecord, type InstanceRecord } from "../runtime/dsh/launch";
import { createInstancesDistinctCheck } from "./checks/instances-distinct";
import { createTeardownCleanCheck } from "./checks/teardown-clean";
import {
  executeInstance,
  instanceIdFor,
  planInstance,
  type ExecutedInstance,
  type InstanceFailure,
  type InstancePlan,
} from "./instance";
import type { CheckPlan } from "./types";

/** The command name, shared by the orchestrator, the CLI and the report. */
export const CONCURRENT_COMMAND = "concurrent";

/** How many instances `concurrent` launches when `--count` is not given. */
export const DEFAULT_CONCURRENCY = 2;

/**
 * Upper bound on `--count`.
 *
 * This is a guard rail, not a machine limit: every instance is a full DSH host
 * with its own home, and a report that requests more than this is far more likely
 * to be a typo than an intention.
 */
export const MAX_CONCURRENCY = 32;

/** One requested instance: which profile and where its profile directory lives. */
export interface ConcurrentTarget {
  readonly profileName: ProfileName;
  readonly profileDir: string;
}

/** Readiness of one instance as the report states it. */
export type ConcurrentReadiness = "ready" | "failed" | "not-started";

/** What the cleanup walk observed for one launched instance. */
export interface ConcurrentCleanup {
  /** The instance is stopped *and* its pid was observed dead afterwards. */
  readonly verified: boolean;
  /** `stopRecord` returned ok (it killed the tree, or found it already gone). */
  readonly stopped: boolean;
  /** The process was already dead before the kill request. */
  readonly alreadyGone: boolean;
  /** `isAlive` still reported true after `stopRecord` returned. */
  readonly aliveAfter: boolean;
  /** `stopRecord` error message when it did not return ok. */
  readonly error: string | null;
}

/** One row of the per-instance comparison table the report carries. */
export interface ConcurrentRow {
  /** 1-based instance number, as printed in the report. */
  readonly index: number;
  readonly instanceId: string;
  readonly profile: ProfileName;
  readonly dir: string;
  readonly home: string;
  readonly workdir: string;
  readonly pluginLogDir: string | null;
  readonly pid: number | null;
  readonly port: number | null;
  readonly tokenPresent: boolean;
  readonly readiness: ConcurrentReadiness;
  readonly failure: Failure | null;
  readonly cleanup: ConcurrentCleanup | null;
}

/** A planning failure, tagged with the instance that could not be planned. */
export interface ConcurrentPlanFailure extends Failure {
  readonly instanceIndex: number;
  readonly instanceId: string;
  readonly profileName: ProfileName;
}

/** A run-level failure that happened before any instance could be launched. */
export interface ConcurrentFailure {
  readonly stage: "declaration" | "profile" | "runtime" | "plan";
  readonly message: string;
  readonly hint: string | null;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Everything the checks need to compare the instances of one run. */
export interface ConcurrentContext {
  readonly count: number;
  readonly rows: readonly ConcurrentRow[];
  /** Non-null when the run stopped before launching; checks then report blocked/skip. */
  readonly failure: ConcurrentFailure | null;
  readonly workRoot: string;
  readonly dshHome: string;
  readonly ports: Ports;
  readonly evidenceRefs?: readonly EvidenceItemRef[];
}

export interface PlanConcurrentInstancesOptions {
  readonly ports: Ports;
  readonly runtime: DshRuntimePaths;
  readonly dshHome: string;
  readonly profile: VerificationProfile;
  readonly workRoot: string;
  readonly targets: readonly ConcurrentTarget[];
  /** Base timestamp; instance i gets `startedAtMs + i` so the ids cannot collide. */
  readonly startedAtMs: number;
  readonly keep?: boolean;
}

/**
 * Plan every instance in request order.
 *
 * A failure returns the first instance that could not be planned, with the
 * instance number and id in the message: a blocked report has to say *which*
 * instance could not be isolated, not just that "planning failed".
 */
export async function planConcurrentInstances(
  options: PlanConcurrentInstancesOptions,
): Promise<Result<readonly InstancePlan[], ConcurrentPlanFailure>> {
  const plans: InstancePlan[] = [];
  for (let offset = 0; offset < options.targets.length; offset += 1) {
    const target = options.targets[offset];
    const startedAtMs = options.startedAtMs + offset;
    const planned = await planInstance({
      ports: options.ports,
      runtime: options.runtime,
      dshHome: options.dshHome,
      profileName: target.profileName,
      profile: options.profile,
      profileDir: target.profileDir,
      workRoot: options.workRoot,
      keep: options.keep ?? false,
      startedAtMs,
    });
    if (!planned.ok) {
      const error = planned.error;
      return err({
        code: error.code,
        message: `instance ${offset + 1} (profile ${target.profileName}): ${error.message}`,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
        ...(error.details === undefined ? {} : { details: error.details }),
        instanceIndex: offset + 1,
        instanceId: instanceIdFor(target.profileName, options.workRoot, startedAtMs),
        profileName: target.profileName,
      });
    }
    plans.push(planned.value);
  }
  return ok(plans);
}

/** One instance's execution outcome, paired with its plan. */
export interface ConcurrentExecution {
  readonly index: number;
  readonly plan: InstancePlan;
  readonly result: Result<ExecutedInstance, InstanceFailure>;
}

export interface ExecuteConcurrentOptions {
  readonly ports: Ports;
  readonly runtime: DshRuntimePaths;
  readonly plans: readonly InstancePlan[];
  readonly note?: (message: string) => void;
  readonly readyTimeoutMs?: number;
}

/** Describe a thrown value without leaking a stack into the report. */
function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Execute every plan concurrently.
 *
 * `Promise.allSettled` is the point: a rejection (or a throwing fake) is turned
 * into a `not-ready` failure for that instance only, so the other instances still
 * launch, still report, and still get cleaned up. Failures are never dropped:
 * every plan yields exactly one execution row.
 */
export async function executeConcurrent(
  options: ExecuteConcurrentOptions,
): Promise<readonly ConcurrentExecution[]> {
  const note = options.note ?? ((): void => {});
  const tasks = options.plans.map(async (plan, offset) => {
    const index = offset + 1;
    note(`instance ${index}/${options.plans.length}: launching ${plan.instanceId} (profile ${plan.profileName})`);
    const result = await executeInstance({
      ports: options.ports,
      plan,
      runtime: options.runtime,
      note,
      ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }),
    });
    note(`instance ${index}/${options.plans.length}: ${result.ok ? "ready" : "failed"}`);
    return { index, plan, result };
  });
  const settled = await Promise.allSettled(tasks);
  return settled.map((entry, offset) => {
    const plan = options.plans[offset];
    const index = offset + 1;
    if (entry.status === "fulfilled") return entry.value;
    return {
      index,
      plan,
      result: err({
        code: "internal",
        message: `executeInstance threw: ${describeThrown(entry.reason)}`,
        stage: "not-ready",
      }) satisfies Result<ExecutedInstance, InstanceFailure>,
    };
  });
}

/** One instance the cleanup walk actually stopped. */
export interface ConcurrentCleanupRow {
  readonly index: number;
  readonly instanceId: string;
  readonly pid: number;
  readonly cleanup: ConcurrentCleanup;
}

export interface CleanupConcurrentOutcome {
  readonly rows: readonly ConcurrentCleanupRow[];
  /** Pids that were still alive after the stop attempt; the report names them. */
  readonly residualPids: readonly number[];
}

export interface CleanupConcurrentOptions {
  readonly ports: Ports;
  readonly executed: readonly ConcurrentExecution[];
  readonly note?: (message: string) => void;
}

/** Prefer the record on disk (it is the durable handle), fall back to memory. */
async function instanceRecordFor(
  fs: FsPort,
  fallback: InstanceRecord,
  directory: string,
): Promise<InstanceRecord> {
  const loaded = await loadInstance(fs, directory);
  if (loaded.ok && loaded.value.pid === fallback.pid) return loaded.value;
  return fallback;
}

/**
 * Stop every instance that started, and *verify* each process is gone.
 *
 * A failed launch is skipped on purpose: `executeInstance` already reaped it. The
 * liveness re-check after `stopRecord` is what makes this evidence rather than a
 * claim — `stopRecord` can time out, and a survivor would hold a port and poison
 * the next run.
 */
export async function cleanupConcurrent(
  options: CleanupConcurrentOptions,
): Promise<CleanupConcurrentOutcome> {
  const note = options.note ?? ((): void => {});
  const rows: ConcurrentCleanupRow[] = [];
  const residualPids: number[] = [];
  for (const item of options.executed) {
    if (!item.result.ok) continue;
    const record = await instanceRecordFor(options.ports.fs, item.result.value.record, item.plan.layout.dir);
    note(`instance ${item.index}/${options.executed.length}: stopping pid ${record.pid}`);
    const stopped = await stopRecord(options.ports, record);
    const aliveAfter = options.ports.process.isAlive(record.pid);
    const cleanup: ConcurrentCleanup = stopped.ok
      ? {
          verified: !aliveAfter,
          stopped: true,
          alreadyGone: stopped.value.alreadyGone,
          aliveAfter,
          error: null,
        }
      : {
          verified: false,
          stopped: false,
          alreadyGone: false,
          aliveAfter,
          error: stopped.error.message,
        };
    rows.push({ index: item.index, instanceId: item.plan.instanceId, pid: record.pid, cleanup });
    if (!cleanup.verified) residualPids.push(record.pid);
  }
  return { rows, residualPids };
}

export interface BuildConcurrentRowsOptions {
  readonly plans: readonly InstancePlan[];
  readonly executed: readonly ConcurrentExecution[];
  readonly cleanup: CleanupConcurrentOutcome;
}

/** Join plans, executions and cleanup observations into the report rows. */
export function buildConcurrentRows(
  options: BuildConcurrentRowsOptions,
): readonly ConcurrentRow[] {
  return options.plans.map((plan, offset) => {
    const index = offset + 1;
    const execution = options.executed.find((entry) => entry.index === index);
    const cleaned = options.cleanup.rows.find((entry) => entry.index === index);
    const base = {
      index,
      instanceId: plan.instanceId,
      profile: plan.profileName,
      dir: plan.layout.dir,
      home: plan.layout.home,
      workdir: plan.layout.workdir,
      pluginLogDir: plan.launch.logFiles.pluginLogDir,
    };
    if (execution !== undefined && execution.result.ok) {
      const record = execution.result.value.record;
      return {
        ...base,
        pid: record.pid,
        port: record.port,
        tokenPresent: record.tokenUrl.length > 0,
        readiness: "ready" as const,
        failure: null,
        cleanup: cleaned === undefined ? null : cleaned.cleanup,
      };
    }
    const failureReason: Failure =
      execution === undefined || execution.result.ok
        ? failure("internal", `instance ${index} was not executed`)
        : execution.result.error;
    return {
      ...base,
      pid: null,
      port: null,
      tokenPresent: false,
      readiness: execution === undefined ? ("not-started" as const) : ("failed" as const),
      failure: failureReason,
      cleanup: null,
    };
  });
}

/** Turn a run-level failure into the value the checks read. */
export function concurrentFailure(
  stage: ConcurrentFailure["stage"],
  error: Failure,
): ConcurrentFailure {
  return {
    stage,
    message: error.message,
    hint: error.hint ?? null,
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}

/** The checks a concurrent run executes, in report order. */
export function planConcurrentChecks(): CheckPlan<ConcurrentContext> {
  return {
    command: CONCURRENT_COMMAND,
    checks: [createInstancesDistinctCheck(), createTeardownCleanCheck()],
  };
}

/** One human line naming the four isolation fields and the readiness of one instance. */
export function describeConcurrentRow(row: ConcurrentRow): string {
  const port = row.port === null ? "(none)" : String(row.port);
  const token = row.tokenPresent ? "present" : "missing";
  const pluginLog = row.pluginLogDir === null ? "(not declared)" : row.pluginLogDir;
  const base =
    `#${row.index} ${row.instanceId} profile ${row.profile} port ${port} token ${token} ` +
    `home ${row.home} start-cwd ${row.workdir} plugin-log ${pluginLog}`;
  return row.failure === null ? base : `${base} — not ready: ${row.failure.message}`;
}

/** The report's single `profile` value when several profiles ran, e.g. `web,alpha`. */
export function concurrentProfilesLabel(profiles: readonly ProfileName[]): string {
  return [...new Set(profiles)].join(",");
}
