/**
 * Planning and executing one isolated instance.
 *
 * The plan is a pure value plus read-only validation: given the declaration, the
 * real home, the runtime and the work root, it decides the instance id, the
 * directory layout, the profile copy and the exact launch argv/env. `--dry-run`
 * renders that value; the real launch passes the *same* value to
 * `executeInstance`. There is no second code path that could print one plan and
 * execute another.
 *
 * Execution keeps one ordering rule that matters for evidence: the instance
 * record is written only after both readiness criteria passed — the host printed
 * its token URL *and* every enabled plugin entry reached `fiberPhase: active`.
 * A record that exists is a handle a later command may use; it must not point at
 * a process that is still loading or already half-dead.
 *
 * Secrets live in `InstancePlan.launch.env` (child environment) and nowhere else:
 * the plan projection written to `plan.json` and the instance record carry
 * variable names and provenance only.
 */
import { canonicalJson, sha256Text } from "../contracts/identity";
import type { ReadyUrl } from "../contracts/launch-plan";
import {
  joinPath,
  planLaunch,
  type DshRuntimePaths,
  type LaunchModelPlan,
  type LaunchPlan,
} from "../contracts/launch-plan";
import type { Ports } from "../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../contracts/result";
import type { ProfileName } from "../contracts/branding";
import type { VerificationProfile } from "../contracts/verification-profile";
import { copyProfile, type CopyProfileOutcome } from "../runtime/dsh/home";
import { resolveModelCredential } from "../runtime/dsh/credential-store";
import {
  connectHost,
  pluginInventoryReadiness,
  type InventoryReadiness,
} from "../runtime/dsh/http-session";
import {
  buildInstanceRecord,
  reapProcess,
  startInstance,
  writeInstanceRecord,
  type InstanceModelRecord,
  type InstanceReadiness,
  type InstanceRecord,
} from "../runtime/dsh/launch";
import { joinFsPath } from "../runtime/paths";

/** Which part of the launch failed; the CLI maps this onto the exit-code contract. */
export type InstanceFailureStage = "prerequisite" | "not-ready";

/** A launch failure carrying the stage that produced it. */
export type InstanceFailure = Failure & { readonly stage: InstanceFailureStage };

/** The readiness criterion in one sentence, reused by errors and reports. */
export const READINESS_CRITERION =
  "the host printed its token URL and every enabled plugin entry reported fiberPhase active";

/** Where one instance lives. All paths are absolute. */
export interface InstanceLayout {
  /** `<workRoot>/instances/<instanceId>`. */
  readonly dir: string;
  /** Isolated `DSH_HOME`. */
  readonly home: string;
  /** Redirected `USERPROFILE`/`HOME`. */
  readonly userprofile: string;
  /** Child process cwd; holds the plugin cache and logs. */
  readonly workdir: string;
  readonly stdoutLog: string;
  readonly stderrLog: string;
  readonly planPath: string;
  readonly instancePath: string;
}

/** The profile copy the instance needs before it can start. */
export interface ProfileCopyPlan {
  readonly sourceProfileDir: string;
  readonly targetProfileDir: string;
  readonly pluginCacheDir: string | null;
}

/** Everything `--dry-run` prints and `executeInstance` performs. */
export interface InstancePlan {
  readonly instanceId: string;
  readonly profileName: ProfileName;
  readonly profile: VerificationProfile;
  readonly layout: InstanceLayout;
  readonly copy: ProfileCopyPlan;
  readonly launch: LaunchPlan;
  /** Model configured on the child env; contains the secret, never projected. */
  readonly modelPlan: LaunchModelPlan | null;
  /** Model provenance recorded in `instance.json`; contains no secret. */
  readonly model: InstanceModelRecord | null;
  /** Warning to print when the model is configured but its credential is missing. */
  readonly modelNote: string | null;
  /** Human-readable planning notes (paths, copy source, model provenance). */
  readonly notes: readonly string[];
  readonly workRoot: string;
  readonly dshHome: string;
  readonly startedAtMs: number;
  readonly startedAt: string;
  readonly keep: boolean;
}

export interface PlanInstanceOptions {
  readonly ports: Ports;
  readonly runtime: DshRuntimePaths;
  /** The developer's real DSH home; only read, never written. */
  readonly dshHome: string;
  readonly profileName: ProfileName;
  readonly profile: VerificationProfile;
  /** `<dshHome>/profiles/<profileName>`; must exist. */
  readonly profileDir: string;
  readonly workRoot: string;
  /** `0` (default) asks the host for an ephemeral port. */
  readonly port?: number;
  readonly keep: boolean;
  /** Injected so a test fixes the id and the timestamps. */
  readonly startedAtMs: number;
}

/** JSON-safe shape of the plan; contains names, never secret values. */
export interface PlanProjection {
  readonly schemaVersion: 1;
  readonly instanceId: string;
  readonly profile: string;
  readonly dir: string;
  readonly home: string;
  readonly userprofile: string;
  readonly workdir: string;
  readonly startedAt: string;
  readonly argv: readonly string[];
  readonly envNames: readonly string[];
  readonly secretEnvNames: readonly string[];
  readonly port: number;
  readonly logFiles: {
    readonly stdout: string;
    readonly stderr: string;
    readonly pluginLogDir: string | null;
  };
  readonly profileCopy: {
    readonly sourceProfileDir: string;
    readonly targetProfileDir: string;
    readonly pluginCacheDir: string | null;
    readonly files?: number;
    readonly bytes?: number;
    readonly removedLogDirectory?: string | null;
  };
  readonly model: InstanceModelRecord | null;
  readonly notes: readonly string[];
  readonly keep: boolean;
}

/** Deterministic instance id: no clock-format dependence beyond the epoch ms. */
export function instanceIdFor(profile: string, workRoot: string, startedAtMs: number): string {
  return sha256Text(canonicalJson({ profile, workRoot, startedAtMs })).slice(0, 16);
}

/** The instance directory layout for one id. */
export function instanceLayoutFor(workRoot: string, instanceId: string): InstanceLayout {
  const dir = joinFsPath(workRoot, "instances", instanceId);
  return {
    dir,
    home: joinFsPath(dir, "home"),
    userprofile: joinFsPath(dir, "userprofile"),
    workdir: joinFsPath(dir, "workdir"),
    stdoutLog: joinFsPath(dir, "instance.stdout.log"),
    stderrLog: joinFsPath(dir, "instance.stderr.log"),
    planPath: joinFsPath(dir, "plan.json"),
    instancePath: joinFsPath(dir, "instance.json"),
  };
}

/** Tag a failure with its stage; the first tag wins. */
function stageFailure(
  stage: InstanceFailureStage,
  error: Failure,
  extraHint?: string,
): InstanceFailure {
  const hint =
    extraHint === undefined
      ? error.hint
      : error.hint === undefined
        ? extraHint
        : `${error.hint}; ${extraHint}`;
  return {
    code: error.code,
    message: error.message,
    ...(hint === undefined ? {} : { hint }),
    ...(error.details === undefined ? {} : { details: error.details }),
    stage,
  };
}

function prerequisite<TValue = never>(error: Failure, extraHint?: string): Result<TValue, InstanceFailure> {
  return err(stageFailure("prerequisite", error, extraHint));
}

function notReady<TValue = never>(error: Failure, extraHint?: string): Result<TValue, InstanceFailure> {
  return err(stageFailure("not-ready", error, extraHint));
}

/**
 * Decide the model the instance should start with.
 *
 * A declared model whose credential cannot be found is a warning, not a failure:
 * the instance is still exactly what this command promises to produce (an
 * isolated, ready DSH), and making `launch` depend on a machine-specific secret
 * would turn "start an instance" into "start an instance with a paid model".
 */
async function planModel(
  ports: Ports,
  profile: VerificationProfile,
  home: string,
  dshHome: string,
): Promise<{ modelPlan: LaunchModelPlan | null; model: InstanceModelRecord | null; note: string | null; notes: readonly string[] }> {
  const selected = profile.model;
  if (selected === false) {
    return { modelPlan: null, model: null, note: null, notes: ["profile.model is false: the instance is not given a model credential"] };
  }
  const lookup = await resolveModelCredential({
    apiKeyEnv: selected.apiKeyEnv,
    batchHome: home,
    realHome: dshHome,
    readText: (path) => ports.fs.readText(path),
    envGet: (name) => ports.env.get(name),
  });
  const notes = [...lookup.notes];
  if (lookup.credential === null) {
    const note =
      `model ${selected.provider}/${selected.model} is configured but ${selected.apiKeyEnv} is missing ` +
      "(checked the batch home, the real home store and the process environment); " +
      "the instance can start, but model calls may fail";
    return {
      modelPlan: null,
      model: {
        provider: selected.provider,
        model: selected.model,
        apiKeyEnv: selected.apiKeyEnv,
        credentialSource: "missing",
        credentialAvailable: false,
        profileConfigured: true,
      },
      note,
      notes,
    };
  }
  const modelPlan: LaunchModelPlan = {
    provider: selected.provider,
    model: selected.model,
    apiKeyEnv: selected.apiKeyEnv,
    secretValue: lookup.credential.value,
    source: lookup.credential.source,
  };
  notes.push(`model credential ${selected.apiKeyEnv} comes from ${lookup.credential.source}`);
  return {
    modelPlan,
    model: {
      provider: selected.provider,
      model: selected.model,
      apiKeyEnv: selected.apiKeyEnv,
      credentialSource: lookup.credential.source,
      credentialAvailable: true,
      profileConfigured: true,
    },
    note: null,
    notes,
  };
}

/**
 * Build the launch plan. Reads files (profile existence, credential store) and
 * writes nothing; the only effects happen in `executeInstance`.
 */
export async function planInstance(options: PlanInstanceOptions): Promise<Result<InstancePlan, InstanceFailure>> {
  const { ports, profile, profileDir } = options;
  const stat = await ports.fs.stat(profileDir);
  if (!stat.ok) {
    return prerequisite(
      failure(
        "prerequisite",
        `the profile directory does not exist: ${profileDir}`,
        "open DSH once with this profile, or point DSH_HOME at the home that has it",
        { profileDir, dshHome: options.dshHome },
      ),
    );
  }
  if (stat.value.kind !== "directory") {
    return prerequisite(failure("prerequisite", `the profile path is not a directory: ${profileDir}`, undefined, { profileDir }));
  }

  const instanceId = instanceIdFor(options.profileName, options.workRoot, options.startedAtMs);
  const layout = instanceLayoutFor(options.workRoot, instanceId);
  const copy: ProfileCopyPlan = {
    sourceProfileDir: profileDir,
    targetProfileDir: joinFsPath(layout.home, "profiles", options.profileName),
    pluginCacheDir: profile.pluginCacheDir ?? null,
  };
  const model = await planModel(ports, profile, layout.home, options.dshHome);

  const launched = planLaunch({
    profile: options.profileName,
    home: layout.home,
    userprofile: layout.userprofile,
    startCwd: layout.workdir,
    logDir: layout.dir,
    ...(profile.pluginCacheDir === undefined ? {} : { pluginCacheDir: profile.pluginCacheDir }),
    runtime: options.runtime,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(model.modelPlan === null ? {} : { model: model.modelPlan }),
    instanceEnvAllowlist: profile.instanceEnvAllowlist,
    baseEnv: ports.env.snapshot(),
  });
  if (!launched.ok) {
    return prerequisite(launched.error, "the launch plan is invalid; this is a bug in the plan inputs, not a machine problem");
  }

  const notes = [
    `profile ${options.profileName} copied from ${copy.sourceProfileDir} into the isolated home`,
    `instance directory: ${layout.dir}`,
    `launch cwd: ${layout.workdir}`,
    `instance logs: ${layout.stdoutLog}`,
    ...model.notes,
  ];
  if (copy.pluginCacheDir !== null) notes.push(`plugin log directory cleared in the copy: ${joinFsPath(copy.targetProfileDir, copy.pluginCacheDir, "logs")}`);
  notes.push(`launch argv: ${launched.value.argv.join(" ")}`);

  return ok({
    instanceId,
    profileName: options.profileName,
    profile,
    layout,
    copy,
    launch: launched.value,
    modelPlan: model.modelPlan,
    model: model.model,
    modelNote: model.note,
    notes,
    workRoot: options.workRoot,
    dshHome: options.dshHome,
    startedAtMs: options.startedAtMs,
    startedAt: ports.clock.iso(options.startedAtMs),
    keep: options.keep,
  });
}

/** Project a plan into the JSON-safe shape written to `plan.json` and printed by `--json`. */
export function projectInstancePlan(plan: InstancePlan, copyOutcome?: CopyProfileOutcome | null): PlanProjection {
  return {
    schemaVersion: 1,
    instanceId: plan.instanceId,
    profile: plan.profileName,
    dir: plan.layout.dir,
    home: plan.layout.home,
    userprofile: plan.layout.userprofile,
    workdir: plan.layout.workdir,
    startedAt: plan.startedAt,
    argv: plan.launch.argv,
    envNames: plan.launch.envNames,
    secretEnvNames: plan.launch.secretEnvNames,
    port: plan.launch.port,
    logFiles: {
      stdout: plan.launch.logFiles.stdout,
      stderr: plan.launch.logFiles.stderr,
      pluginLogDir: plan.launch.logFiles.pluginLogDir,
    },
    profileCopy: {
      sourceProfileDir: plan.copy.sourceProfileDir,
      targetProfileDir: plan.copy.targetProfileDir,
      pluginCacheDir: plan.copy.pluginCacheDir,
      ...(copyOutcome === undefined || copyOutcome === null
        ? {}
        : { files: copyOutcome.files, bytes: copyOutcome.bytes, removedLogDirectory: copyOutcome.removedLogDirectory }),
    },
    model: plan.model,
    notes: plan.notes,
    keep: plan.keep,
  };
}

export interface ExecuteInstanceOptions {
  readonly ports: Ports;
  readonly plan: InstancePlan;
  readonly runtime: DshRuntimePaths;
  readonly note?: (message: string) => void;
  readonly readyTimeoutMs?: number;
  /**
   * Runs after the isolated home is copied and the instance directories exist,
   * but before the host process starts. The only safe moment to seed state the
   * host loads into memory during boot (workspace registries, settings rows):
   * seeding after startup is overwritten by the running host, seeding before
   * this point loses the files with the home copy.
   */
  readonly beforeStart?: (info: {
    readonly home: string;
    readonly dir: string;
    readonly profile: string;
  }) => void | Promise<void>;
}

/** A launched, proven-ready instance plus the evidence captured at launch time. */
export interface ExecutedInstance {
  readonly record: InstanceRecord;
  readonly readiness: InstanceReadiness;
  readonly copy: CopyProfileOutcome;
  readonly plan: PlanProjection;
}

/** Stop a process tree and report whether the cleanup itself worked. */
async function reapAfterFailure(ports: Ports, pid: number, message: string): Promise<string> {
  const reaped = await reapProcess({ fs: ports.fs, clock: ports.clock, process: ports.process, pid });
  return reaped.ok ? message : `${message}; cleanup warning: ${reaped.error.message}`;
}

/** The readiness evidence record (never contains secrets). */
function readinessOf(
  sessionStatus: number,
  inventory: InventoryReadiness,
  started: { readonly startedAtMs: number },
  nowMs: number,
  checkedAt: string,
): InstanceReadiness {
  return {
    stdoutLine: true,
    connectStatus: sessionStatus,
    inventory: {
      entryCount: inventory.entryCount,
      enabledCount: inventory.enabledCount,
      activeCount: inventory.activeCount,
      offenders: inventory.offenders,
    },
    checkedAt,
    elapsedMs: Math.max(0, nowMs - started.startedAtMs),
  };
}

/** One-line description of the entries that kept the instance from being ready. */
export function describeOffenders(offenders: InventoryReadiness["offenders"]): string {
  return offenders
    .slice(0, 5)
    .map((offender) => `${offender.entryId || "(unnamed entry)"} fiberPhase=${offender.fiberPhase ?? "null"}`)
    .join(", ");
}

/**
 * Execute a plan: copy the profile, start the host, prove both readiness
 * criteria, then write `plan.json` and `instance.json`.
 *
 * Every failure after the spawn stops the tree before returning, so a failed
 * launch never leaves a host process holding the port. The two records are
 * written last, in that order: the instance record is the handle, so it is the
 * very last thing that appears.
 */
export async function executeInstance(
  options: ExecuteInstanceOptions,
): Promise<Result<ExecutedInstance, InstanceFailure>> {
  const { ports, plan } = options;
  const note = options.note ?? ((): void => {});
  const { fs, clock } = ports;

  note(`copying profile ${plan.profileName}: ${plan.copy.sourceProfileDir} -> ${plan.copy.targetProfileDir}`);
  const copied = await copyProfile({
    fs,
    sourceHome: plan.dshHome,
    targetHome: plan.layout.home,
    profile: plan.profileName,
    ...(plan.profile.pluginCacheDir === undefined ? {} : { pluginCacheDir: plan.profile.pluginCacheDir }),
  });
  if (!copied.ok) return prerequisite(copied.error, "the isolated home could not be prepared");

  for (const directory of [plan.layout.dir, plan.layout.userprofile, plan.layout.workdir]) {
    const made = await fs.makeDir(directory);
    if (!made.ok) return prerequisite(made.error, `could not create ${directory}`);
  }

  if (options.beforeStart !== undefined) {
    try {
      await options.beforeStart({ home: plan.layout.home, dir: plan.layout.dir, profile: plan.profileName });
    } catch (error) {
      return prerequisite(
        failure(
          "prerequisite",
          `beforeStart hook failed: ${error instanceof Error ? error.message : String(error)}`,
          "the hook runs after the isolated home is copied and before the host starts; fix it and rerun",
        ),
      );
    }
  }

  note(`starting the instance (${plan.launch.argv[0] ?? "no executable"})`);
  const started = await startInstance({
    ports,
    plan: plan.launch,
    runtime: options.runtime,
    note,
    ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }),
  });
  if (!started.ok) return notReady(started.error);

  const session = await connectHost({ http: ports.http, clock, ready: started.value.ready });
  if (!session.ok) {
    const reaped = await reapAfterFailure(ports, started.value.pid, session.error.hint ?? session.error.message);
    return notReady(
      { ...session.error, hint: reaped },
      "the instance was stopped after the readiness handshake failed",
    );
  }

  const inventory = await pluginInventoryReadiness(session.value);
  if (!inventory.ok) {
    const reaped = await reapAfterFailure(ports, started.value.pid, inventory.error.hint ?? inventory.error.message);
    return notReady(
      { ...inventory.error, hint: reaped },
      "the instance was stopped after the plugin inventory could not be read",
    );
  }
  if (!inventory.value.allReady) {
    const offenders = describeOffenders(inventory.value.offenders);
    await reapAfterFailure(ports, started.value.pid, "");
    return notReady(
      failure(
        "prerequisite",
        `the instance started but its plugin inventory is not ready: ${inventory.value.offenders.length} enabled entries are not active`,
        `offenders: ${offenders}; instance stdout: ${plan.layout.stdoutLog}; instance stderr: ${plan.layout.stderrLog}`,
        {
          entryCount: inventory.value.entryCount,
          enabledCount: inventory.value.enabledCount,
          activeCount: inventory.value.activeCount,
          offenders: inventory.value.offenders,
          pid: started.value.pid,
        },
      ),
      "the instance was stopped because a half-loaded instance must not survive a launch",
    );
  }

  const checkedAt = clock.iso();
  const readiness = readinessOf(
    session.value.status,
    inventory.value,
    started.value,
    clock.nowMs(),
    checkedAt,
  );
  const projection = projectInstancePlan(plan, copied.value);

  note(`writing the launch records under ${plan.layout.dir}`);
  const planWritten = await fs.writeJson(plan.layout.planPath, projection);
  if (!planWritten.ok) {
    await reapAfterFailure(ports, started.value.pid, "");
    return notReady(planWritten.error, "the instance was stopped because its plan could not be written");
  }

  const record = buildInstanceRecord({
    started: { ...started.value },
    plan: plan.launch,
    runtime: options.runtime,
    model: plan.model,
    readiness,
    instanceId: plan.instanceId,
    dir: plan.layout.dir,
    keep: plan.keep,
    planPath: plan.layout.planPath,
  });
  const recorded = await writeInstanceRecord(fs, record);
  if (!recorded.ok) {
    await reapAfterFailure(ports, started.value.pid, "");
    return notReady(recorded.error, "the instance was stopped because its handle could not be written");
  }

  return ok({ record, readiness, copy: copied.value, plan: projection });
}
