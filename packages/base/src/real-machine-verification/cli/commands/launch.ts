/**
 * `dsh-verify launch` — start one isolated instance and prove it is ready.
 *
 * The command never decides anything the library does not already know: context
 * resolution, runtime discovery, planning and execution all live one layer down.
 * What is here is only the CLI contract — flag validation, the two output modes and
 * the exit-code mapping.
 *
 * `--dry-run` and a real launch share the *same* `planInstance` value. The dry run
 * renders it and returns; nothing is created, written, spawned or stopped. That is
 * what makes "print the plan, then run the plan" honest: there is no second
 * planning path that could differ from the one that executes.
 *
 * Output contract: with `--json` stdout carries exactly one JSON document,
 * progress and warnings go to stderr; without it, stdout carries the human result
 * lines. Exit codes: `0` ready, `1` the instance did not become ready, `2` a
 * prerequisite (runtime, profile, declaration, flags) is missing.
 */
import { EXIT_CODES } from "../../capability-description";
import type { DshRuntimePaths } from "../../contracts/launch-plan";
import type { Ports } from "../../contracts/ports";
import { formatFailure, type Failure } from "../../contracts/result";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import { loadDeclarationContext } from "../../orchestration/context";
import {
  executeInstance,
  planInstance,
  projectInstancePlan,
  type InstanceFailure,
  type InstancePlan,
  type PlanProjection,
} from "../../orchestration/instance";
import { discoverDsh, hostCliPath } from "../../runtime/dsh/discover";
import {
  instanceDirectory,
  type InstanceModelRecord,
  type InstanceReadiness,
  type InstanceRecord,
} from "../../runtime/dsh/launch";
import { joinFsPath } from "../../runtime/paths";
import type { RuntimeFacts } from "../../runtime/types";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected; the CLI wires the real machine. */
export interface LaunchCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

/** The usage line, repeated in errors so a caller never has to read `describe`. */
export const LAUNCH_USAGE = "dsh-verify launch [--profile <p>] [--keep] [--port <n>] [--dry-run] [--json]";

/** Flags this command implements; anything else recognized is a usage error. */
const LAUNCH_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--profile",
  "--declaration",
  "--work-root",
  "--port",
  "--keep",
  "--dry-run",
]);

const DEFAULT_PORT = 0;

/** `--port`: decimal, 0 (ephemeral) through 65535. */
function parsePort(raw: string | undefined): { readonly port: number } | { readonly problem: string } {
  if (raw === undefined) return { port: DEFAULT_PORT };
  if (!/^[0-9]+$/.test(raw)) return { problem: `--port needs an integer between 0 and 65535, got "${raw}"` };
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    return { problem: `--port needs an integer between 0 and 65535, got "${raw}"` };
  }
  return { port };
}

/** One human line for the model provenance; never a secret. */
function renderModel(model: InstanceModelRecord | null): string {
  if (model === null) return "none (profile.model is false)";
  const credential = model.credentialAvailable
    ? `credential ${model.credentialSource}`
    : `credential missing (${model.apiKeyEnv} was not found)`;
  return `${model.provider}/${model.model} — ${credential}`;
}

function renderDryRun(plan: InstancePlan, projection: PlanProjection): string {
  const lines: string[] = [];
  lines.push("launch plan (dry run) — nothing was written and no process was started");
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
  lines.push(`plugin log dir: ${projection.logFiles.pluginLogDir ?? "(none)"}`);
  lines.push(`profile copy: ${projection.profileCopy.sourceProfileDir} -> ${projection.profileCopy.targetProfileDir}`);
  lines.push(`model: ${renderModel(projection.model)}`);
  lines.push("notes:");
  for (const note of projection.notes) lines.push(`  - ${note}`);
  return lines.join("\n") + "\n";
}

function renderLaunched(
  record: InstanceRecord,
  readiness: InstanceReadiness,
  instancePath: string,
  workRoot: string,
): string {
  const lines: string[] = [];
  lines.push(`instance ${record.instanceId ?? "(no id)"} is ready`);
  lines.push(`pid: ${record.pid}`);
  lines.push(`port: ${record.port}`);
  lines.push(
    `readyMs: ${record.readyMs} (connect HTTP ${readiness.connectStatus}, ` +
      `${readiness.inventory.activeCount}/${readiness.inventory.enabledCount} enabled entries active)`,
  );
  lines.push(`home: ${record.home}`);
  lines.push(`workdir: ${record.startCwd}`);
  lines.push(`stdout log: ${record.stdoutPath}`);
  lines.push(`stderr log: ${record.stderrPath}`);
  lines.push(`model: ${renderModel(record.model)}`);
  lines.push(`instance: ${instancePath}`);
  lines.push(`stop: dsh-verify stop --id ${record.instanceId ?? "<id>"} --work-root ${workRoot}`);
  return lines.join("\n") + "\n";
}

/** The launch-side half of the JSON contract: one failure document. */
function failureJson(command: string, stage: string, error: Failure): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command,
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
function reject(args: ParsedArgs, io: CliIo, command: string, stage: string, message: string): number {
  io.stderr(`dsh-verify ${command}: ${message}\n`);
  if (args.json) io.stdout(failureJson(command, stage, { code: "invalid-input", message }));
  return EXIT_CODES.blocked;
}

/** Run one `launch` invocation and return its exit code. */
export async function runLaunchCommand(args: ParsedArgs, deps: LaunchCommandDeps): Promise<number> {
  const { ports, io } = deps;

  const problems = flagProblems(args, LAUNCH_FLAGS);
  if (problems.length > 0) return reject(args, io, "launch", "usage", `${problems.join("; ")}\n${LAUNCH_USAGE}`);

  const port = parsePort(args.port);
  if ("problem" in port) return reject(args, io, "launch", "usage", port.problem);

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
    io.stderr(`dsh-verify launch: ${formatFailure(failure)}\n`);
    if (args.json) io.stdout(failureJson("launch", stage, failure));
    return EXIT_CODES.blocked;
  }

  const runtime = await discoverDsh({ fs: ports.fs, env: ports.env });
  if (!runtime.ok) {
    io.stderr(`dsh-verify launch: ${formatFailure(runtime.error)}\n`);
    if (args.json) io.stdout(failureJson("launch", "runtime", runtime.error));
    return EXIT_CODES.blocked;
  }

  // Discovery hands back the archive-internal entry path; the spawn needs the two
  // joined, and the plan must see the same value the process will receive.
  const runtimePaths: DshRuntimePaths = { exe: runtime.value.exe, cliJs: hostCliPath(runtime.value) };

  const planned = await planInstance({
    ports,
    runtime: runtimePaths,
    dshHome: context.value.dshHome,
    profileName: context.value.profileName,
    profile: context.value.profile,
    profileDir: context.value.profileDir,
    workRoot: context.value.workRoot,
    port: port.port,
    keep: args.keep,
    startedAtMs: ports.clock.nowMs(),
  });
  if (!planned.ok) {
    const failure: InstanceFailure = planned.error;
    io.stderr(`dsh-verify launch: ${formatFailure(failure)}\n`);
    if (args.json) io.stdout(failureJson("launch", failure.stage, failure));
    return failure.stage === "prerequisite" ? EXIT_CODES.blocked : EXIT_CODES.hardFailure;
  }
  const plan = planned.value;

  if (args.dryRun) {
    const projection = projectInstancePlan(plan);
    if (args.json) io.stdout(`${JSON.stringify({ schemaVersion: 1, command: "launch", ok: true, dryRun: true, plan: projection })}\n`);
    else io.stdout(renderDryRun(plan, projection));
    if (plan.modelNote !== null) io.stderr(`dsh-verify launch: warning: ${plan.modelNote}\n`);
    return EXIT_CODES.ok;
  }

  if (plan.modelNote !== null) io.stderr(`dsh-verify launch: warning: ${plan.modelNote}\n`);
  const note = (message: string): void => {
    io.stderr(`dsh-verify launch: ${message}\n`);
  };
  const executed = await executeInstance({ ports, plan, runtime: runtimePaths, note });
  if (!executed.ok) {
    const failure = executed.error;
    io.stderr(`dsh-verify launch: ${formatFailure(failure)} (stage: ${failure.stage})\n`);
    if (args.json) io.stdout(failureJson("launch", failure.stage, failure));
    return failure.stage === "not-ready" ? EXIT_CODES.hardFailure : EXIT_CODES.blocked;
  }

  const { record, readiness, plan: projection } = executed.value;
  const instancePath = joinFsPath(instanceDirectory(record), "instance.json");
  if (args.json) {
    io.stdout(
      `${JSON.stringify({ schemaVersion: 1, command: "launch", ok: true, instance: record, readiness, plan: projection })}\n`,
    );
  } else {
    io.stdout(renderLaunched(record, readiness, instancePath, context.value.workRoot));
  }
  return EXIT_CODES.ok;
}
