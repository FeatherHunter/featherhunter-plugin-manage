/**
 * `dsh-verify isolation` — prove that plugin settings are redirected in a real
 * child process and that the plugin's real settings file survives untouched.
 *
 * The command runs the two hard isolation checks against one memoized probe:
 * both checks must describe the *same* child run, otherwise a second child could
 * hide the first one's damage. A failure prints the four-step fallback plan but
 * executes none of it — recovery touches a user's real settings and stays a
 * human decision.
 *
 * Output contracts match every other command: `--json` puts exactly one JSON
 * document on stdout (human lines, the fallback plan and progress go to stderr),
 * human mode prints the check lines plus the report/evidence tail on stdout, and
 * the exit code always comes from the report.
 */
import { EXIT_CODES } from "../../capability-description";
import type { CheckResult, CheckStatus } from "../../contracts/check";
import type { Ports } from "../../contracts/ports";
import { err, failure, formatFailure, type Failure, type Result } from "../../contracts/result";
import {
  createRunReport,
  exitCodeOfRun,
  finishRunReport,
  runReportJson,
  verdictLine,
  type RunReport,
} from "../../contracts/run-state";
import type { DeclarationFailure, DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import { createEvidenceStore } from "../../evidence/store";
import { loadDeclarationContext, resolveWorkRoot } from "../../orchestration/context";
import { renderSelfCheckHuman, withReportDigest, writeRunReport, type HumanReportTail } from "../../orchestration/report";
import { planRunDirectory, prepareRunDirectory } from "../../orchestration/run-directory";
import { executePlan } from "../../orchestration/runner";
import { checkId, type CheckPlan } from "../../orchestration/types";
import {
  isolationProbePaths,
  planSettingsIsolation,
  probeSettingsIsolation,
  realSettingsFilePath,
  type SettingsIsolationResult,
} from "../../runtime/dsh/isolation";
import { joinFsPath } from "../../runtime/paths";
import type { RuntimeFacts } from "../../runtime/types";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";
import { createIsolationHomeCheck, MISSING_SETTINGS_DIR_DETAIL, MISSING_SETTINGS_DIR_HINT, type IsolationProbeContext } from "../../orchestration/checks/isolation-home";
import { createSettingsIsolatedCheck } from "../../orchestration/checks/settings-isolated";

export const ISOLATION_COMMAND = "isolation";

/** The usage line, repeated in errors so a caller never has to read `describe`. */
export const ISOLATION_USAGE = "dsh-verify isolation [--profile <p>] [--work-root <dir>] [--json] [--dry-run]";

/** Flags this command implements; anything else recognized is a usage error. */
const ISOLATION_FLAGS: ReadonlySet<string> = new Set(["--json", "--dry-run", "--profile", "--declaration", "--work-root"]);

/**
 * The recovery steps a human follows after the real settings file was damaged.
 *
 * Printed only: `dsh-verify` never edits the real settings file, never takes a
 * lock and never restores a backup. The same lines are copied into the report's
 * notes so the plan survives the terminal scrollback.
 */
export const FALLBACK_PLAN: readonly string[] = [
  "fallback plan (printed only; dsh-verify executed none of these steps):",
  "  1. back up the real settings file and record its sha256 and mtime before touching anything",
  "  2. take a global mutex on the plugin settings directory so no other process writes while you repair",
  "  3. restore the file from the backup and confirm its sha256 matches the recorded hash",
  "  4. release the mutex, then rerun `dsh-verify isolation` before any other launch",
];

/** Everything the command needs injected; the CLI wires the real machine. */
export interface IsolationCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

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

/** The two checks a declaration failure reports under, so ids stay stable. */
function declarationChecks(failure: DeclarationFailure, durationMs: number): readonly CheckResult[] {
  const status: CheckStatus = failure.kind === "failed" ? "fail" : "blocked";
  const hint = failure.hint ?? "fix verify/profile.ts and rerun `dsh-verify isolation`";
  const make = (id: string, title: string): CheckResult => ({
    id: checkId(id),
    title,
    hard: true,
    status,
    detail: failure.message,
    ...(status === "fail"
      ? { expected: "a loadable, valid verification declaration", actual: failure.message }
      : {}),
    hint,
    evidence: [],
    durationMs,
  });
  return [
    make("isolation-home", "a child process resolves its home inside the redirected directory"),
    make("settings-isolated", "the plugin's real settings file stays byte-identical"),
  ];
}


/** `--dry-run`: load the declaration, name the probe, and write nothing. */
async function runIsolationDryRun(
  args: ParsedArgs,
  deps: IsolationCommandDeps,
  cwd: string,
  workRoot: string,
  startedAt: string,
): Promise<number> {
  const { ports, io } = deps;
  const { fs, env } = ports;
  const loaded = await loadDeclarationContext({
    ports,
    cwd,
    nodeVersion: deps.runtime.nodeVersion,
    ...(args.workRoot === undefined ? {} : { workRoot: args.workRoot }),
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
    ...(args.profile === undefined ? {} : { profileOverride: args.profile }),
    ...(deps.loadDeclaration === undefined ? {} : { loadDeclaration: deps.loadDeclaration }),
  });
  if (!loaded.ok) {
    io.stderr(`dsh-verify isolation: ${formatFailure(loaded.error.failure)}\n`);
    if (args.json) io.stdout(failureJson(ISOLATION_COMMAND, loaded.error.stage, loaded.error.failure));
    return EXIT_CODES.blocked;
  }
  const plannedRun = await planRunDirectory({ fs, workRoot, command: ISOLATION_COMMAND, startedAt });
  if (!plannedRun.ok) {
    io.stderr(`dsh-verify isolation: ${formatFailure(plannedRun.error)}\n`);
    if (args.json) io.stdout(failureJson(ISOLATION_COMMAND, "run-directory", plannedRun.error));
    return EXIT_CODES.blocked;
  }
  const { profile, profileName, profileDir, dshHome } = loaded.value;
  const run = plannedRun.value;
  const realHome = env.homeDir();
  const pluginSettingsDir = profile.pluginSettingsDir ?? null;
  const probePaths = isolationProbePaths(workRoot, run.runId);
  const realSettingsPath = pluginSettingsDir === null ? null : realSettingsFilePath(realHome, pluginSettingsDir);
  const probe =
    pluginSettingsDir === null
      ? null
      : planSettingsIsolation({
          env,
          pluginSettingsDir,
          realHome,
          redirectedHome: probePaths.redirectedHome,
          workdir: probePaths.workdir,
        });
  const checks = [createIsolationHomeCheck(), createSettingsIsolatedCheck()];
  const checkJson = checks.map((check) => ({
    id: check.id,
    title: check.title,
    hard: check.hard,
    requires: check.requires,
    onMissing: check.onMissing,
  }));

  if (args.json) {
    io.stdout(
      `${JSON.stringify({
        schemaVersion: 1,
        command: ISOLATION_COMMAND,
        ok: true,
        dryRun: true,
        plan: {
          workRoot,
          runId: run.runId,
          runDir: run.runDir,
          evidenceDir: run.evidenceDir,
          profile: profileName,
          profileDir,
          dshHome,
          realHome,
          pluginSettingsDir,
          realSettingsPath,
          probeRoot: probePaths.probeRoot,
          redirectedHome: probePaths.redirectedHome,
          workdir: probePaths.workdir,
          probe:
            probe === null
              ? null
              : {
                  argv: probe.argv,
                  cwd: probe.cwd,
                  env: probe.env,
                  envNames: probe.envNames,
                  timeoutMs: probe.timeoutMs,
                  markerPath: probe.markerPath,
                },
          checks: checkJson,
          note:
            probe === null
              ? "the profile declares no pluginSettingsDir; both checks would be blocked before spawning"
              : null,
        },
      })}\n`,
    );
  } else {
    const lines: string[] = [];
    lines.push("isolation plan (dry run) — nothing was written and no child was started");
    lines.push(`profile: ${profileName} (${profileDir})`);
    lines.push(`dsh home: ${dshHome}`);
    lines.push(`real home: ${realHome}`);
    lines.push(`plugin settings dir: ${pluginSettingsDir ?? "(not declared)"}`);
    lines.push(`real settings: ${realSettingsPath ?? "(not declared)"}`);
    lines.push(`run dir: ${run.runDir}`);
    lines.push(`probe root: ${probePaths.probeRoot}`);
    lines.push(`redirected home: ${probePaths.redirectedHome}`);
    lines.push(`workdir: ${probePaths.workdir}`);
    if (probe === null) {
      lines.push("probe: none (both checks would be blocked before spawning)");
    } else {
      lines.push(`probe argv: ${probe.argv.join(" ")}`);
      lines.push(`probe cwd: ${probe.cwd}`);
      lines.push(`probe env: ${probe.envNames.join(", ")}`);
      lines.push(`probe timeout: ${String(probe.timeoutMs)}ms`);
      lines.push(`marker: ${probe.markerPath}`);
    }
    lines.push(`checks: ${checkJson.length}`);
    for (const check of checkJson) lines.push(`  - ${check.id} (${check.hard ? "hard" : "soft"}): ${check.title}`);
    lines.push("dry run: nothing was written");
    io.stdout(`${lines.join("\n")}\n`);
  }
  return EXIT_CODES.ok;
}

/** Run one `isolation` invocation and return its exit code. */
export async function runIsolationCommand(args: ParsedArgs, deps: IsolationCommandDeps): Promise<number> {
  const { ports, io } = deps;
  const { clock, env, fs } = ports;

  const problems = flagProblems(args, ISOLATION_FLAGS);
  if (problems.length > 0) {
    return reject(args, io, ISOLATION_COMMAND, "usage", `${problems.join("; ")}\n${ISOLATION_USAGE}`);
  }

  const cwd = env.cwd();
  const startedMs = clock.nowMs();
  const startedAt = clock.iso(startedMs);
  const workRoot = resolveWorkRoot(cwd, args.workRoot);

  if (args.dryRun) return runIsolationDryRun(args, deps, cwd, workRoot, startedAt);

  const prepared = await prepareRunDirectory({ fs, workRoot, command: ISOLATION_COMMAND, startedAt });
  if (!prepared.ok) {
    io.stderr(`dsh-verify: could not create the run directory under ${workRoot}: ${formatFailure(prepared.error)}\n`);
    if (args.json) io.stdout(failureJson(ISOLATION_COMMAND, "run-directory", prepared.error));
    return EXIT_CODES.blocked;
  }
  const { runId, runDir, evidenceDir } = prepared.value;
  const evidence = createEvidenceStore({ fs, root: evidenceDir, clock });

  /** Write the report first, then print; a crashed stdout must not lose the record. */
  async function finishAndEmit(report: RunReport, fallback: boolean): Promise<number> {
    const written = await writeRunReport({ fs, runDir, report });
    if (!written.ok) {
      io.stderr(`dsh-verify: could not write the run report: ${formatFailure(written.error)}\n`);
      if (args.json) io.stdout(failureJson(ISOLATION_COMMAND, "report", written.error));
      return EXIT_CODES.blocked;
    }
    const finalReport = withReportDigest(report, written.value);
    const tail: HumanReportTail = {
      reportPath: written.value.reportPath,
      reportSha256: written.value.reportSha256,
      evidenceDir,
      evidenceCount: evidence.items().length,
    };
    const humanLines = [renderSelfCheckHuman(finalReport, tail)];
    if (fallback) humanLines.push("", ...FALLBACK_PLAN);
    const human = humanLines.join("\n");
    if (args.json) {
      io.stdout(`${runReportJson(finalReport)}\n`);
      io.stderr(`${human}\n`);
      io.stderr(`${verdictLine(finalReport)}\n`);
    } else {
      io.stdout(`${human}\n`);
    }
    return exitCodeOfRun(finalReport);
  }

  const loaded = await loadDeclarationContext({
    ports,
    cwd,
    nodeVersion: deps.runtime.nodeVersion,
    ...(args.workRoot === undefined ? {} : { workRoot: args.workRoot }),
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
    ...(args.profile === undefined ? {} : { profileOverride: args.profile }),
    ...(deps.loadDeclaration === undefined ? {} : { loadDeclaration: deps.loadDeclaration }),
  });

  if (!loaded.ok) {
    const contextFailure = loaded.error;
    if (contextFailure.stage === "profile") {
      const profileFailure = contextFailure.failure;
      io.stderr(`dsh-verify isolation: ${formatFailure(profileFailure)}\n`);
      if (args.json) io.stdout(failureJson(ISOLATION_COMMAND, "profile", profileFailure));
      return EXIT_CODES.blocked;
    }
    const failure = contextFailure.failure;
    const recorded = await evidence.recordJson(
      "declaration-failure",
      {
        kind: failure.kind,
        code: failure.code,
        message: failure.message,
        hint: failure.hint ?? null,
        requestedPath: args.declaration ?? null,
        cwd,
      },
      { note: "why the verification declaration could not be loaded" },
    );
    const refs = recorded.ok
      ? [{ path: recorded.value.path, sha256: recorded.value.sha256, kind: recorded.value.kind }]
      : [];
    const checks = declarationChecks(failure, Math.max(0, clock.nowMs() - startedMs)).map((check) => ({
      ...check,
      evidence: refs,
    }));
    const report = finishRunReport(
      createRunReport({
        command: ISOLATION_COMMAND,
        profile: args.profile ?? "(declaration not loaded)",
        startedAt,
        notes: [`work root: ${workRoot}`],
      }),
      {
        checks,
        steps: [],
        finishedAt: clock.iso(),
        artifacts: { report: joinFsPath(runDir, "run.json"), evidence: evidenceDir },
        notes: [`declaration: ${failure.message}`],
      },
    );
    return finishAndEmit(report, false);
  }

  const { profile, profileName } = loaded.value;
  const realHome = env.homeDir();
  const pluginSettingsDir = profile.pluginSettingsDir ?? null;
  const probePaths = isolationProbePaths(workRoot, runId);
  const realSettingsPath = pluginSettingsDir === null ? null : realSettingsFilePath(realHome, pluginSettingsDir);

  // Both checks must observe the same child: a second probe could hide the
  // damage the first one caused, so the run happens at most once per command.
  let probePromise: Promise<Result<SettingsIsolationResult>> | null = null;
  let probeRan = false;
  const probe = (): Promise<Result<SettingsIsolationResult>> => {
    if (pluginSettingsDir === null) {
      return Promise.resolve(err(failure("prerequisite", MISSING_SETTINGS_DIR_DETAIL, MISSING_SETTINGS_DIR_HINT)));
    }
    if (probePromise === null) {
      probeRan = true;
      probePromise = probeSettingsIsolation({
        ports,
        probeRoot: probePaths.probeRoot,
        pluginSettingsDir,
        realHome,
        redirectedHome: probePaths.redirectedHome,
        workdir: probePaths.workdir,
      });
    }
    return probePromise;
  };

  // Progress is stderr noise in human mode: the check lines already carry the
  // outcome. In --json mode stderr is where progress and human rendering belong.
  const note = (message: string): void => {
    if (args.json) io.stderr(`dsh-verify: ${message}\n`);
  };

  const context: IsolationProbeContext = {
    probeRoot: probePaths.probeRoot,
    redirectedHome: probePaths.redirectedHome,
    workdir: probePaths.workdir,
    pluginSettingsDir,
    evidence,
    note,
    probe,
  };

  const plan: CheckPlan<IsolationProbeContext> = {
    command: ISOLATION_COMMAND,
    checks: [createIsolationHomeCheck(), createSettingsIsolatedCheck()],
  };
  const outcome = await executePlan(plan, context, { ports, clock, note });

  const fallbackNeeded = probeRan && outcome.results.some((check) => check.status === "fail");
  const report = finishRunReport(
    createRunReport({
      command: ISOLATION_COMMAND,
      profile: profileName,
      startedAt,
      notes: [`work root: ${workRoot}`],
    }),
    {
      checks: outcome.results,
      steps: outcome.steps,
      finishedAt: clock.iso(),
      artifacts: { report: joinFsPath(runDir, "run.json"), evidence: evidenceDir },
      notes: [
        `probe root: ${probePaths.probeRoot}`,
        `redirected home: ${probePaths.redirectedHome}`,
        `real settings: ${realSettingsPath ?? "(pluginSettingsDir not declared)"}`,
        `real user profile: ${realHome}`,
        ...(fallbackNeeded ? FALLBACK_PLAN : []),
      ],
    },
  );
  return finishAndEmit(report, fallbackNeeded);
}