/**
 * Instance lifecycle: spawn, wait for the readiness line, record, stop.
 *
 * Three decisions are worth stating because each one replaces a guess the old
 * tooling made:
 *
 * 1. **Readiness comes from the host's own line.** The runtime waits for
 *    `http://127.0.0.1:<port>/?token=<43 chars>` in the captured stdout. A
 *    listening port is not ready, and a log line is not ready: both appear before
 *    the session API answers.
 * 2. **The process is detached.** The instance must survive the command that
 *    started it, otherwise `launch` followed by separate commands is impossible.
 *    `instance.json` in the start directory is the handle those commands use.
 * 3. **Stopping kills the tree.** Electron spawns children; killing the parent
 *    PID alone leaves a host process holding the port and the DSH home.
 */
import { joinFsPath } from "../paths";
import type { DshRuntimePaths, LaunchPlan, ReadyUrl } from "../../contracts/launch-plan";
import { originOf, parseReadyUrl } from "../../contracts/launch-plan";
import type { ClockPort, FsPort, KillOutcome, Ports, ProcessPort, SpawnedProcess } from "../../contracts/ports";
import { err, ok, type Result } from "../../contracts/result";

/** The on-disk handle. Every later command reads this instead of remembering a PID. */
export interface InstanceRecord {
  readonly schemaVersion: 1;
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
  readonly model: {
    readonly provider: string;
    readonly model: string;
    readonly apiKeyEnv: string;
    readonly source: string;
  } | null;
}

export interface LaunchInstanceOptions {
  readonly ports: Ports;
  readonly plan: LaunchPlan;
  /** The executable pair the plan was built for, recorded for later `stop`/reports. */
  readonly runtime: DshRuntimePaths;
  /** Model actually configured for this instance; never contains the secret. */
  readonly model?: {
    readonly provider: string;
    readonly model: string;
    readonly apiKeyEnv: string;
    readonly source: string;
  } | null;
  /** Stable, scriptable success line; the runtime reports progress here. */
  readonly note?: (message: string) => void;
  readonly readyTimeoutMs?: number;
}

export interface InstanceHandle {
  readonly record: InstanceRecord;
  isAlive(): boolean;
  stop(): Promise<Result<KillOutcome>>;
}

export const INSTANCE_FILE = "instance.json";
export const STOPPED_FILE = "stopped.json";
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const POLL_MS = 150;

export function instanceFilePath(startCwd: string): string {
  return joinFsPath(startCwd, INSTANCE_FILE);
}

interface WaitedReadiness {
  readonly ready: ReadyUrl;
  readonly readyMs: number;
}

/** Tail of a captured file, for the "it died before printing anything" message. */
async function tailOf(fs: FsPort, file: string, bytes = 2000): Promise<string> {
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
 * profile, a locked home) behind a generic "timed out".
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
  const deadline = startedAtMs + (options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
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
    message: `the DSH instance did not print its access URL within ${options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS}ms`,
    hint: `stdout tail: ${lastStdout.slice(-500) || "(empty)"}; full output: ${options.stdoutPath}`,
    details: { stdoutPath: options.stdoutPath, stderrPath: options.stderrPath },
  });
}

/**
 * Start one isolated instance and return its handle.
 *
 * The caller has already decided the plan (`planLaunch`) and validated the home;
 * this function only performs the effects in the order the host expects.
 */
export async function launchInstance(options: LaunchInstanceOptions): Promise<Result<InstanceHandle>> {
  const { ports, plan } = options;
  const { fs, process: processPort, clock } = ports;
  const note = options.note ?? ((): void => {});

  for (const directory of [plan.home, plan.userprofile, plan.cwd]) {
    const made = await fs.makeDir(directory);
    if (!made.ok) return made;
  }
  const stdoutInit = await fs.writeText(plan.logFiles.stdout, "");
  if (!stdoutInit.ok) return stdoutInit;
  const stderrInit = await fs.writeText(plan.logFiles.stderr, "");
  if (!stderrInit.ok) return stderrInit;

  const startedAtMs = clock.nowMs();
  note(`starting ${plan.argv.join(" ")} in ${plan.cwd}`);
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
    await processPort.killTree(spawned.value.pid, { timeoutMs: 10_000 });
    return ready;
  }

  const record: InstanceRecord = {
    schemaVersion: 1,
    pid: spawned.value.pid,
    port: ready.value.ready.port,
    tokenUrl: ready.value.ready.url,
    originUrl: originOf(ready.value.ready),
    profile: plan.profile,
    home: plan.home,
    userprofile: plan.userprofile,
    startCwd: plan.cwd,
    startedAt: clock.iso(startedAtMs),
    readyMs: ready.value.readyMs,
    stdoutPath: plan.logFiles.stdout,
    stderrPath: plan.logFiles.stderr,
    pluginLogDir: plan.logFiles.pluginLogDir,
    exe: options.runtime.exe,
    cliJs: options.runtime.cliJs,
    envNames: plan.envNames,
    secretEnvNames: plan.secretEnvNames,
    model: options.model ?? null,
  };
  const written = await fs.writeJson(instanceFilePath(plan.cwd), record);
  if (!written.ok) return written;
  note(`instance ready on port ${record.port} after ${record.readyMs}ms (pid ${record.pid})`);

  return ok({
    record,
    isAlive: () => processPort.isAlive(record.pid),
    stop: () => stopRecord(ports, record),
  });
}

/** Kill a recorded instance and verify it is gone. */
export async function stopRecord(ports: Ports, record: InstanceRecord, timeoutMs = 15_000): Promise<Result<KillOutcome>> {
  const { process: processPort, clock, fs } = ports;
  if (!processPort.isAlive(record.pid)) return ok({ killed: false, alreadyGone: true });
  const killed = await processPort.killTree(record.pid, { timeoutMs });
  if (!killed.ok) return killed;
  const deadline = clock.nowMs() + timeoutMs;
  while (clock.nowMs() <= deadline) {
    if (!processPort.isAlive(record.pid)) {
      await fs.writeJson(joinFsPath(record.startCwd, STOPPED_FILE), {
        pid: record.pid,
        stoppedAt: clock.iso(),
        alreadyGone: killed.value.alreadyGone,
      });
      return killed;
    }
    await clock.sleep(150);
  }
  return err({
    code: "timeout",
    message: `instance pid ${record.pid} is still alive ${timeoutMs}ms after the kill request`,
    hint: "a child process may be holding the port; close it from the task manager and remove the instance directory",
  });
}

/** Read `instance.json` from a start directory or from the file itself. */
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
  const pid = record.pid;
  const port = record.port;
  const tokenUrl = record.tokenUrl;
  if (typeof pid !== "number" || typeof port !== "number" || typeof tokenUrl !== "string") {
    return err({ code: "io", message: `instance record is incomplete: ${file}`, hint: "delete the directory and launch again" });
  }
  return ok(value as unknown as InstanceRecord);
}

/** Stop an instance addressed by its start directory or record file. */
export async function stopInstance(ports: Ports, target: string): Promise<Result<KillOutcome>> {
  const record = await loadInstance(ports.fs, target);
  if (!record.ok) return record;
  return stopRecord(ports, record.value);
}
