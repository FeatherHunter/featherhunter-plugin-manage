/**
 * `dsh-verify self-check` — the four prerequisite checks plus the plugin's own.
 *
 * This command is the reference for every later L1 command: load the declaration,
 * build a run directory, plan, execute, write `run.json` + evidence, render. The
 * ordering matters — nothing is executed before the declaration is known and the
 * run directory exists, so a blocked declaration still leaves a report on disk.
 *
 * Two output contracts hold in both modes: `--json` puts exactly one JSON document
 * on stdout (progress and human lines go to stderr), and human mode prints the
 * check lines plus the report/evidence tail on stdout. The exit code always comes
 * from the report, never from an ad-hoc branch.
 */
import { EXIT_CODES } from "../../capability-description";
import type { ProfileName } from "../../contracts/branding";
import type { CheckResult } from "../../contracts/check";
import type { Ports } from "../../contracts/ports";
import { formatFailure } from "../../contracts/result";
import {
  createRunReport,
  exitCodeOfRun,
  finishRunReport,
  runReportJson,
  verdictLine,
  type RunReport,
} from "../../contracts/run-state";
import { resolveProfile } from "../../contracts/verification-profile";
import {
  loadVerificationDeclaration,
  type DeclarationLoadResult,
  type LoadDeclarationOptions,
} from "../../declaration/loader";
import { createEvidenceStore } from "../../evidence/store";
import {
  renderSelfCheckHuman,
  withReportDigest,
  writeRunReport,
  type HumanReportTail,
} from "../../orchestration/report";
import { prepareRunDirectory } from "../../orchestration/run-directory";
import { executePlan } from "../../orchestration/runner";
import { planSelfCheck, SELF_CHECK_COMMAND, type SelfCheckContext } from "../../orchestration/self-check";
import { checkId } from "../../orchestration/types";
import { resolveRealHome } from "../../runtime/dsh/home";
import { isPosixAbsolute, isWindowsAbsolute, joinFsPath, resolveAgainst } from "../../runtime/paths";
import type { RuntimeFacts } from "../../runtime/types";
import type { ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected; the CLI wires the real machine. */
export interface SelfCheckCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

/** `<cwd>/.scratch/verify` unless `--work-root` says otherwise. */
function resolveWorkRoot(cwd: string, raw: string | undefined): string {
  if (raw === undefined) return joinFsPath(cwd, ".scratch", "verify");
  return isWindowsAbsolute(raw) || isPosixAbsolute(raw) ? raw : resolveAgainst(cwd, raw);
}

/** The DSH home: `DSH_HOME` when set, otherwise the real user home's `.dsh`. */
function resolveDshHome(ports: Ports): string {
  const configured = ports.env.get("DSH_HOME")?.trim();
  if (configured !== undefined && configured.length > 0) {
    return isWindowsAbsolute(configured) || isPosixAbsolute(configured)
      ? configured
      : resolveAgainst(ports.env.cwd(), configured);
  }
  return resolveRealHome(ports.env);
}

/** The one check a blocked/failed declaration reports under. */
const DECLARATION_CHECK_ID = checkId("profile-declaration");
const DECLARATION_CHECK_TITLE = "the plugin declares and loads its verification profile";

/** Run one `self-check` invocation and return its exit code. */
export async function runSelfCheckCommand(args: ParsedArgs, deps: SelfCheckCommandDeps): Promise<number> {
  const { ports, io } = deps;
  const { clock, env, fs } = ports;
  const cwd = env.cwd();
  const startedMs = clock.nowMs();
  const startedAt = clock.iso(startedMs);
  const workRoot = resolveWorkRoot(cwd, args.workRoot);

  const prepared = await prepareRunDirectory({ fs, workRoot, command: SELF_CHECK_COMMAND, startedAt });
  if (!prepared.ok) {
    io.stderr(`dsh-verify: could not create the run directory under ${workRoot}: ${formatFailure(prepared.error)}\n`);
    return EXIT_CODES.blocked;
  }
  const { runDir, evidenceDir } = prepared.value;
  const evidence = createEvidenceStore({ fs, root: evidenceDir, clock });

  /** Write the report first, then print; a crashed stdout must not lose the record. */
  async function finishAndEmit(report: RunReport): Promise<number> {
    const written = await writeRunReport({ fs, runDir, report });
    if (!written.ok) {
      io.stderr(`dsh-verify: could not write the run report: ${formatFailure(written.error)}\n`);
      return EXIT_CODES.blocked;
    }
    const finalReport = withReportDigest(report, written.value);
    const tail: HumanReportTail = {
      reportPath: written.value.reportPath,
      reportSha256: written.value.reportSha256,
      evidenceDir,
      evidenceCount: evidence.items().length,
    };
    const human = renderSelfCheckHuman(finalReport, tail);
    if (args.json) {
      io.stdout(`${runReportJson(finalReport)}\n`);
      io.stderr(`${human}\n`);
      io.stderr(`${verdictLine(finalReport)}\n`);
    } else {
      io.stdout(`${human}\n`);
    }
    return exitCodeOfRun(finalReport);
  }

  const loadOptions: LoadDeclarationOptions = {
    fs,
    cwd,
    nodeVersion: deps.runtime.nodeVersion,
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
  };
  const loaded = await (deps.loadDeclaration ?? loadVerificationDeclaration)(loadOptions);

  if (!loaded.ok) {
    const failure = loaded.error;
    const status = failure.kind === "failed" ? "fail" : "blocked";
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
    const check: CheckResult = {
      id: DECLARATION_CHECK_ID,
      title: DECLARATION_CHECK_TITLE,
      hard: true,
      status,
      detail: failure.message,
      ...(status === "fail"
        ? { expected: "a loadable, valid verification declaration", actual: failure.message }
        : {}),
      ...(failure.hint === undefined ? {} : { hint: failure.hint }),
      evidence: refs,
      durationMs: Math.max(0, clock.nowMs() - startedMs),
    };
    const report = finishRunReport(
      createRunReport({
        command: SELF_CHECK_COMMAND,
        profile: args.profile ?? "(declaration not loaded)",
        startedAt,
        notes: [`work root: ${workRoot}`],
      }),
      {
        checks: [check],
        steps: [],
        finishedAt: clock.iso(),
        artifacts: { report: joinFsPath(runDir, "run.json"), evidence: evidenceDir },
      },
    );
    return finishAndEmit(report);
  }

  const declaration = loaded.value;
  const resolved = resolveProfile(declaration.profile, args.profile);
  if (!resolved.ok) {
    io.stderr(`dsh-verify: ${formatFailure(resolved.error)}\n`);
    return EXIT_CODES.blocked;
  }
  const profileName: ProfileName = resolved.value;
  const dshHome = resolveDshHome(ports);
  const profileDir = joinFsPath(dshHome, "profiles", profileName);

  // A small environment snapshot: enough for another machine to understand the
  // run, and deliberately not a dump of the process environment (it can hold
  // credentials, which must never reach a report or evidence file).
  const environment = await evidence.recordJson(
    "environment",
    {
      platform: env.platform(),
      nodeVersion: deps.runtime.nodeVersion,
      cwd,
      workRoot,
      dshHome,
      profile: profileName,
      declaration: {
        path: declaration.path,
        kind: declaration.kind,
        exportName: declaration.exportName,
        requiredNode: declaration.requiredNode,
      },
      screenRequested: args.screen,
    },
    { note: "the environment this run observed" },
  );
  if (!environment.ok) {
    io.stderr(`dsh-verify: could not record the environment evidence: ${formatFailure(environment.error)}\n`);
  }

  // Progress is stderr noise in human mode: the check lines already carry the
  // outcome. In --json mode stderr is where progress and the human rendering
  // belong, because stdout carries exactly one JSON document.
  const note = (message: string): void => {
    if (args.json) io.stderr(`dsh-verify: ${message}\n`);
  };
  const context: SelfCheckContext = {
    profile: declaration.profile,
    profileName,
    ports,
    cwd,
    dshHome,
    profileDir,
    workRoot,
    nodeVersion: deps.runtime.nodeVersion,
    readFileSlice: deps.runtime.readFileSlice,
    declaration: {
      path: declaration.path,
      kind: declaration.kind,
      exportName: declaration.exportName,
      requiredNode: declaration.requiredNode,
    },
    screenRequested: args.screen,
    evidence,
    note,
  };

  const plan = planSelfCheck({ profile: declaration.profile, screenRequested: args.screen });
  const outcome = await executePlan(plan, context, { ports, clock, note });

  const report = finishRunReport(
    createRunReport({
      command: SELF_CHECK_COMMAND,
      profile: profileName,
      startedAt,
      notes: [`work root: ${workRoot}`, `declaration: ${declaration.path}`],
    }),
    {
      checks: outcome.results,
      steps: outcome.steps,
      finishedAt: clock.iso(),
      artifacts: { report: joinFsPath(runDir, "run.json"), evidence: evidenceDir },
      notes: [`node: ${deps.runtime.nodeVersion}`, `dsh home: ${dshHome}`],
    },
  );
  return finishAndEmit(report);
}
