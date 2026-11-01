/**
 * Instance lifecycle: spawn, wait for the readiness line, verify, record, stop.
 *
 * Four decisions are worth stating because each one replaces a guess the old
 * tooling made:
 *
 * 1. **Readiness comes from the host's own line.** The runtime waits for
 *    `http://127.0.0.1:<port>/?token=<43 chars>` in the captured stdout. A
 *    listening port is not ready, and a log line is not ready: both appear before
 *    the session API answers.
 * 2. **The process is detached.** The instance must survive the command that
 *    started it, otherwise `launch` followed by separate commands is impossible.
 *    `instance.json` is the handle those commands use.
 * 3. **Stopping kills the tree.** Electron spawns children; killing the parent
 *    PID alone leaves a host process holding the port and the DSH home.
 * 4. **No record until the instance is proven usable.** `startInstance` only
 *    starts and observes; the orchestrator runs the HTTP readiness criteria and
 *    then calls `writeInstanceRecord`. A half-ready instance never gets an
 *    `instance.json` that a later command could mistake for a handle.
 */
import { joinFsPath } from "../paths";
import type { DshRuntimePaths, LaunchPlan, ReadyUrl } from "../../contracts/launch-plan";
import { originOf, parseReadyUrl } from "../../contracts/launch-plan";
import type { ClockPort, FsPort, KillOutcome, Ports, ProcessPort, SpawnedProcess } from "../../contracts/ports";
import { err, ok, type Result } from "../../contracts/result";

/** Where a model credential was resolved from; never the credential itself. */
export type InstanceCredentialSource = "batch-home-store" | "real-home-store" | "process-env" | "missing";

/** The model an instance was configured with. Contains names and sources only. */
export interface InstanceModelRecord {
  readonly provider: string;
  readonly model: string;
  /** The credential reference name, e.g. `MINIMAX_CN_API_KEY`. */
  readonly apiKeyEnv: string;
  readonly credentialSource: InstanceCredentialSource;
  readonly credentialAvailable: boolean;
  /** Whether the profile declared a model at all. */
  readonly profileConfigured: boolean;
}

/** One enabled entry whose fiber was not `active` when the instance was checked. */
export interface ReadinessOffender {
  readonly entryId: string;
  readonly fiberPhase: string | null;
}

/** Evidence that the two readiness criteria passed, captured at launch time. */
export interface InstanceReadiness {
  /** The host printed its token URL. */
  readonly stdoutLine: true;
  /** HTTP status of the connect handshake (302 on the real host). */
  readonly connectStatus: number;
  readonly inventory: {
    readonly entryCount: number;
    readonly enabledCount: number;
    readonly activeCount: number;
    readonly offenders: readonly ReadinessOffender[];
  };
  readonly checkedAt: string;
  readonly elapsedMs: number;
}

/** The on-disk handle. Every later command reads this instead of remembering a PID. */
export interface InstanceRecord {
  readonly schemaVersion: 1;
  /** Deterministic 16-hex instance id: sha256(canonicalJson({profile, workRoot, startedAtMs})). */
  readonly instanceId?: string;
  /** The instance directory holding home/, userprofile/, workdir/ and the records. */
  readonly dir?: string;
  readonly pid: number;
  readonly port: number;
  readonly tokenUrl: string;
  readonly originUrl: string;
  readonly profile: string;
  readonly home: string;
  readonly userprofile: string;
  readonly startCwd: string;
  readonly startedAt: string;
  /** Milliseconds from spawn to the readiness line. */
  readonly readyMs: number;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly pluginLogDir: string | null;
  readonly exe: string;
  readonly cliJs: string;
  readonly envNames: readonly string[];
  readonly secretEnvNames: readonly string[];
  /** Model reported by the planner; never contains the secret itself. */
  readonly model: InstanceModelRecord | null;
  readonly readiness?: InstanceReadiness;
  /** `--keep` requested; informational, the instance is detached either way. */
  readonly keep?: boolean;
  readonly planPath?: string;
}

export interface StartInstanceOptions {
  readonly ports: Ports;
  readonly plan: LaunchPlan;
  readonly runtime: DshRuntimePaths;
  /** Stable, scriptable progress lines; warnings go to stderr. */
  readonly note?: (message: string) => void;
  readonly readyTimeoutMs?: number;
}

/** What `startInstance` observed before any readiness verdict was written. */
export interface StartedInstance {
  readonly pid: number;
  readonly startedAtMs: number;
  readonly startedAt: string;
  readonly ready: ReadyUrl;
  readonly readyMs: number;
}

export interface BuildInstanceRecordOptions {
  readonly started: StartedInstance;
  readonly plan: LaunchPlan;
  readonly runtime: DshRuntimePaths;
  readonly model: InstanceModelRecord | null;
  readonly readiness: InstanceReadiness;
  readonly instanceId: string;
  readonly dir: string;
  readonly keep: boolean;
  readonly planPath: string;
}

export const INSTANCE_FILE = "instance.json";
export const STOPPED_FILE = "stopped.json";
export const DEFAULT_READY_TIMEOUT_MS = 120_000;
const POLL_MS = 150;
const REAP_TIMEOUT_MS = 10_000;

export function instanceFilePath(startCwd: string): string {
  return joinFsPath(startCwd, INSTANCE_FILE);
}

/** Prefer the explicit instance directory; fall back to the start directory. */
export function instanceDirectory(record: Pick<InstanceRecord, "dir" | "startCwd">): string {
  return record.dir ?? record.startCwd;
}

interface WaitedReadiness {
  readonly ready: ReadyUrl;
  readonly readyMs: number;
}

/** Tail of a captured file, for the "it died before printing anything" message. */
export async function tailOf(fs: FsPort, file: string, bytes = 2000): Promise<string> {
  const read = await fs.readText(file);
  if (!read.ok) return "";
  const text = read.value;
  return text.length <= bytes ? text.trim() : text.slice(text.length - bytes).trim();
}

/**
 * Poll the captured stdout for the readiness line.
 *
 * The process being dead is checked first: waiting for a URL from a process that
 * already exited wastes the whole timeout and hides the real error (a missing
 * profile, a locked home) behind a generic "timed out". The failure carries the
 * captured tails so the caller can print the actual first error.
 */
export async function waitForReady(
  options: {
    readonly fs: FsPort;
    readonly clock: ClockPort;
    readonly process: ProcessPort;
    readonly stdoutPath: string;
    readonly stderrPath: string;
    readonly pid: number;
    readonly readyTimeoutMs?: number;
  },
  startedAtMs = options.clock.nowMs(),
): Promise<Result<WaitedReadiness>> {
  const timeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const deadline = startedAtMs + timeoutMs;
  let lastStdout = "";
  while (options.clock.nowMs() <= deadline) {
    if (!options.process.isAlive(options.pid)) {
      const stderrTail = await tailOf(options.fs, options.stderrPath);
      const stdoutTail = await tailOf(options.fs, options.stdoutPath);
      return err({
        code: "prerequisite",
        message: "the DSH instance exited before printing its access URL",
        hint: [stderrTail, stdoutTail].filter((text) => text.length > 0).join("\n").slice(0, 2000) || "no output was captured",
        details: { stdoutPath: options.stdoutPath, stderrPath: options.stderrPath },
      });
    }
    const read = await options.fs.readText(options.stdoutPath);
    if (read.ok) {
      lastStdout = read.value;
      for (const line of lastStdout.split(/\r?\n/)) {
        const ready = parseReadyUrl(line);
        if (ready !== null) return ok({ ready, readyMs: options.clock.nowMs() - startedAtMs });
      }
    }
    await options.clock.sleep(POLL_MS);
  }
  return err({
    code: "timeout",
    message: `the DSH instance did not print its access URL within ${timeoutMs}ms`,
    hint: `stdout tail: ${lastStdout.slice(-500) || "(empty)"}; full output: ${options.stdoutPath}`,
    details: { stdoutPath: options.stdoutPath, stderrPath: options.stderrPath },
  });
}

/**
 * Kill a PID tree and poll until the PID is gone. Used on every failure path
 * after a spawn, so a failed launch never leaves a host process behind.
 */
export async function reapProcess(
  options: {
    readonly fs: FsPort;
    readonly clock: ClockPort;
    readonly process: ProcessPort;
    readonly pid: number;
    readonly timeoutMs?: number;
  },
): Promise<Result<KillOutcome>> {
  const timeoutMs = options.timeoutMs ?? REAP_TIMEOUT_MS;
  if (!options.process.isAlive(options.pid)) return ok({ killed: false, alreadyGone: true });
  const killed = await options.process.killTree(options.pid, { timeoutMs });
  if (!killed.ok) return killed;
  const deadline = options.clock.nowMs() + timeoutMs;
  while (options.clock.nowMs() <= deadline) {
    if (!options.process.isAlive(options.pid)) return killed;
    await options.clock.sleep(POLL_MS);
  }
  return err({
    code: "timeout",
    message: `pid ${options.pid} is still alive ${timeoutMs}ms after the kill request`,
    hint: "a child process may be holding the port; close it from the task manager",
  });
}

/**
 * Start one instance: prepare the log files, spawn detached, wait for the token
 * URL. The caller has already materialized the isolated home and decided the plan
 * (`planLaunch`); this function only performs the effects in the host's order.
 */
export async function startInstance(options: StartInstanceOptions): Promise<Result<StartedInstance>> {
  const { ports, plan } = options;
  const { fs, process: processPort, clock } = ports;
  const note = options.note ?? ((): void => {});

  const stdoutInit = await fs.writeText(plan.logFiles.stdout, "");
  if (!stdoutInit.ok) return stdoutInit;
  const stderrInit = await fs.writeText(plan.logFiles.stderr, "");
  if (!stderrInit.ok) return stderrInit;

  const startedAtMs = clock.nowMs();
  note(`starting ${plan.argv[0] ?? "(no executable)"} in ${plan.cwd}`);
  const spawned: Result<SpawnedProcess> = await processPort.spawnDetached({
    argv: plan.argv,
    cwd: plan.cwd,
    env: plan.env,
    stdoutPath: plan.logFiles.stdout,
    stderrPath: plan.logFiles.stderr,
    detached: true,
    windowsHide: true,
  });
  if (!spawned.ok) return spawned;

  const ready = await waitForReady(
    {
      fs,
      clock,
      process: processPort,
      stdoutPath: plan.logFiles.stdout,
      stderrPath: plan.logFiles.stderr,
      pid: spawned.value.pid,
      ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }),
    },
    startedAtMs,
  );
  if (!ready.ok) {
    // Do not leave a half-started host behind when readiness fails.
    await reapProcess({ fs, clock, process: processPort, pid: spawned.value.pid });
    return ready;
  }

  return ok({
    pid: spawned.value.pid,
    startedAtMs,
    startedAt: clock.iso(startedAtMs),
    ready: ready.value.ready,
    readyMs: ready.value.readyMs,
  });
}

/** Assemble the `instance.json` value. Pure: no I/O, no secrets. */
export function buildInstanceRecord(options: BuildInstanceRecordOptions): InstanceRecord {
  const { plan, started } = options;
  return {
    schemaVersion: 1,
    instanceId: options.instanceId,
    dir: options.dir,
    pid: started.pid,
    port: started.ready.port,
    tokenUrl: started.ready.url,
    originUrl: originOf(started.ready),
    profile: plan.profile,
    home: plan.home,
    userprofile: plan.userprofile,
    startCwd: plan.cwd,
    startedAt: started.startedAt,
    readyMs: started.readyMs,
    stdoutPath: plan.logFiles.stdout,
    stderrPath: plan.logFiles.stderr,
    pluginLogDir: plan.logFiles.pluginLogDir,
    exe: options.runtime.exe,
    cliJs: options.runtime.cliJs,
    envNames: plan.envNames,
    secretEnvNames: plan.secretEnvNames,
    model: options.model,
    readiness: options.readiness,
    keep: options.keep,
    planPath: options.planPath,
  };
}

/** Write `instance.json` into the instance directory (the launch handle). */
export async function writeInstanceRecord(fs: FsPort, record: InstanceRecord): Promise<Result<void>> {
  return fs.writeJson(instanceFilePath(instanceDirectory(record)), record);
}

/** Path of the stop record for this instance. */
export function stoppedFilePath(record: Pick<InstanceRecord, "dir" | "startCwd">): string {
  return joinFsPath(instanceDirectory(record), STOPPED_FILE);
}

/** Kill a recorded instance and verify it is gone; always leaves `stopped.json`. */
export async function stopRecord(ports: Ports, record: InstanceRecord, timeoutMs = 15_000): Promise<Result<KillOutcome>> {
  const { process: processPort, clock, fs } = ports;
  const stoppedFile = stoppedFilePath(record);
  if (!processPort.isAlive(record.pid)) {
    // Already gone is a successful outcome; record it so the next reader knows.
    await fs.writeJson(stoppedFile, { pid: record.pid, stoppedAt: clock.iso(), alreadyGone: true });
    return ok({ killed: false, alreadyGone: true });
  }
  const killed = await processPort.killTree(record.pid, { timeoutMs });
  if (!killed.ok) return killed;
  const deadline = clock.nowMs() + timeoutMs;
  while (clock.nowMs() <= deadline) {
    if (!processPort.isAlive(record.pid)) {
      await fs.writeJson(stoppedFile, {
        pid: record.pid,
        stoppedAt: clock.iso(),
        alreadyGone: killed.value.alreadyGone,
      });
      return killed;
    }
    await clock.sleep(POLL_MS);
  }
  return err({
    code: "timeout",
    message: `instance pid ${record.pid} is still alive ${timeoutMs}ms after the kill request`,
    hint: "a child process may be holding the port; close it from the task manager and remove the instance directory",
    details: { pid: record.pid, instanceId: record.instanceId ?? null },
  });
}

/** Read `instance.json` from an instance directory or from the file itself. */
export async function loadInstance(fs: FsPort, target: string): Promise<Result<InstanceRecord>> {
  const file = target.endsWith(".json") ? target : instanceFilePath(target);
  const raw = await fs.readJson(file);
  if (!raw.ok) {
    return err({
      code: "not-found",
      message: `no instance record at ${file}`,
      hint: "launch an instance first, or pass the directory that launch printed",
    });
  }
  const value = raw.value;
  if (typeof value !== "object" || value === null) {
    return err({ code: "io", message: `instance record is not a JSON object: ${file}` });
  }
  const record = value as Record<string, unknown>;
  const pid = record["pid"];
  const port = record["port"];
  const tokenUrl = record["tokenUrl"];
  if (typeof pid !== "number" || typeof port !== "number" || typeof tokenUrl !== "string") {
    return err({ code: "io", message: `instance record is incomplete: ${file}`, hint: "delete the directory and launch again" });
  }
  return ok(value as unknown as InstanceRecord);
}

/** Stop an instance addressed by its directory or record file. */
export async function stopInstance(ports: Ports, target: string): Promise<Result<KillOutcome>> {
  const record = await loadInstance(ports.fs, target);
  if (!record.ok) return record;
  return stopRecord(ports, record.value);
}
