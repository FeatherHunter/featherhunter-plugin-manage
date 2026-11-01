/**
 * `dsh-verify stop` — kill one recorded instance, or every instance in a work root.
 *
 * The command reads the *record*, never shell history or a remembered pid: an
 * instance is whatever `instance.json` says it is. Stopping is idempotent by
 * design — a pid that is already gone is a success, and `stopped.json` records
 * that fact so a later reader can tell "we stopped it" from "it was never here".
 *
 * `--all` keeps going after a failure. A stubborn pid (one the kill did not
 * remove) is reported by pid and makes the command exit `1`, but the remaining
 * instances are still stopped: cleanup is not a transaction, and leaving the rest
 * running because one is broken is the worse outcome.
 */
import { EXIT_CODES } from "../../capability-description";
import { isAbsolutePath } from "../../contracts/launch-plan";
import type { Ports } from "../../contracts/ports";
import { formatFailure } from "../../contracts/result";
import { resolveWorkRoot } from "../../orchestration/context";
import {
  instanceDirectory,
  loadInstance,
  stopRecord,
  type InstanceRecord,
} from "../../runtime/dsh/launch";
import { joinFsPath, resolveAgainst } from "../../runtime/paths";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected. */
export interface StopCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
}

/** The usage line, repeated in every no-target error. */
export const STOP_USAGE = "dsh-verify stop [--id <id>] [--dir <d>] [--all] [--json]";

/** Flags this command implements; anything else recognized is a usage error. */
const STOP_FLAGS: ReadonlySet<string> = new Set(["--json", "--work-root", "--id", "--dir", "--all"]);

/** One target handed to `stopRecord`, with the id the caller used (if any). */
interface StopTarget {
  readonly dir: string;
  readonly id?: string;
}

/** The JSON-safe result of stopping one target. */
interface StopResult {
  readonly id?: string;
  readonly dir: string;
  readonly pid?: number;
  readonly killed?: boolean;
  readonly alreadyGone?: boolean;
  readonly aliveAfter?: boolean;
  readonly error?: string;
}

function failureJson(results: readonly StopResult[], ok: boolean): string {
  return `${JSON.stringify({ schemaVersion: 1, command: "stop", ok, results })}\n`;
}

/** Resolve `--all` into the instance directories that actually hold a record. */
async function enumerateInstances(ports: Ports, workRoot: string): Promise<readonly StopTarget[]> {
  const instancesRoot = joinFsPath(workRoot, "instances");
  const listed = await ports.fs.list(instancesRoot);
  if (!listed.ok) return [];
  const targets: StopTarget[] = [];
  for (const entry of listed.value) {
    if (entry.kind !== "directory") continue;
    const dir = joinFsPath(instancesRoot, entry.name);
    if (await ports.fs.exists(joinFsPath(dir, "instance.json"))) targets.push({ dir, id: entry.name });
  }
  return targets;
}

/** Resolve the three target flags into work to do, or into a usage problem. */
async function resolveTargets(
  args: ParsedArgs,
  ports: Ports,
  workRoot: string,
): Promise<{ readonly targets: readonly StopTarget[]; readonly enumerateEmpty: boolean } | { readonly problem: string }> {
  if (args.all && (args.id !== undefined || args.dir !== undefined)) {
    return { problem: "--all cannot be combined with --id or --dir" };
  }
  if (args.id !== undefined && args.dir !== undefined) {
    return { problem: "--id and --dir address different instances; pass one of them" };
  }
  if (args.all) {
    const targets = await enumerateInstances(ports, workRoot);
    return { targets, enumerateEmpty: targets.length === 0 };
  }
  if (args.id !== undefined) {
    return { targets: [{ dir: joinFsPath(workRoot, "instances", args.id), id: args.id }], enumerateEmpty: false };
  }
  if (args.dir !== undefined) {
    const absolute = isAbsolutePath(args.dir) ? args.dir : resolveAgainst(ports.env.cwd(), args.dir);
    return { targets: [{ dir: absolute }], enumerateEmpty: false };
  }
  return { problem: `nothing to stop; pass --id, --dir or --all\n${STOP_USAGE}` };
}

/** Stop one target and turn the outcome into a report row. */
async function stopTarget(ports: Ports, target: StopTarget): Promise<StopResult> {
  const loaded = await loadInstance(ports.fs, target.dir);
  if (!loaded.ok) {
    return { ...(target.id === undefined ? {} : { id: target.id }), dir: target.dir, error: formatFailure(loaded.error) };
  }
  const record: InstanceRecord = loaded.value;
  const stopped = await stopRecord(ports, record);
  if (!stopped.ok) {
    return {
      ...(record.instanceId === undefined && target.id === undefined ? {} : { id: record.instanceId ?? target.id }),
      dir: instanceDirectory(record),
      pid: record.pid,
      killed: false,
      alreadyGone: false,
      aliveAfter: ports.process.isAlive(record.pid),
      error: formatFailure(stopped.error),
    };
  }
  return {
    ...(record.instanceId === undefined && target.id === undefined ? {} : { id: record.instanceId ?? target.id }),
    dir: instanceDirectory(record),
    pid: record.pid,
    killed: stopped.value.killed,
    alreadyGone: stopped.value.alreadyGone,
    aliveAfter: ports.process.isAlive(record.pid),
  };
}

function renderResult(result: StopResult): string {
  const label = result.id ?? result.dir;
  if (result.error !== undefined) return `failed ${label}: ${result.error}`;
  if (result.alreadyGone === true) return `already gone ${label} (pid ${result.pid ?? "?"})`;
  return `stopped ${label} (pid ${result.pid ?? "?"})`;
}

/** Run one `stop` invocation and return its exit code. */
export async function runStopCommand(args: ParsedArgs, deps: StopCommandDeps): Promise<number> {
  const { ports, io } = deps;

  const problems = flagProblems(args, STOP_FLAGS);
  if (problems.length > 0) {
    io.stderr(`dsh-verify stop: ${problems.join("; ")}\n`);
    if (args.json) io.stdout(failureJson([], false));
    return EXIT_CODES.blocked;
  }

  const workRoot = resolveWorkRoot(ports.env.cwd(), args.workRoot);
  const resolved = await resolveTargets(args, ports, workRoot);
  if ("problem" in resolved) {
    io.stderr(`dsh-verify stop: ${resolved.problem}\n`);
    if (args.json) io.stdout(failureJson([], false));
    return EXIT_CODES.blocked;
  }

  const results: StopResult[] = [];
  for (const target of resolved.targets) {
    const result = await stopTarget(ports, target);
    results.push(result);
    io.stderr(`dsh-verify stop: ${renderResult(result)}\n`);
  }

  const ok = results.every((result) => result.error === undefined && result.aliveAfter === false);
  if (args.json) {
    io.stdout(failureJson(results, ok));
  } else if (results.length === 0) {
    io.stdout(`no instances found under ${joinFsPath(workRoot, "instances")}\n`);
  } else {
    const stopped = results.filter((result) => result.error === undefined).length;
    io.stdout(`stopped ${stopped}/${results.length} instance(s) under ${workRoot}\n`);
  }
  return ok ? EXIT_CODES.ok : EXIT_CODES.hardFailure;
}
