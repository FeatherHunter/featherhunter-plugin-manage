/**
 * `dsh-verify run <scenario.ts>` — load a plugin repository's scenarios and
 * report them in the same shape as every other run.
 *
 * The command owns only the CLI contract. Loading, the primitive layer, the
 * per-step report conversion and the concurrency pool live in
 * `orchestration/scenario-run.ts`; a scenario file is data, not a second runner.
 *
 * Exit codes: 0 every check passed (skips allowed), 1 a hard check failed,
 * 2 the run could not start or a prerequisite is blocked. `--json` prints one
 * report document on stdout and sends progress, human lines and the verdict to
 * stderr; the report is written before anything is printed.
 */
import type { BrowserProbeFactory, Ports } from "../../contracts/ports";
import { formatFailure } from "../../contracts/result";
import {
  createRunReport,
  exitCodeOfRun,
  finishRunReport,
  runReportJson,
  verdictLine,
  type RunReport,
} from "../../contracts/run-state";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import type { EvidenceManifestItem } from "../../contracts/evidence-contract";
import { buildEvidenceManifest, writeEvidenceManifest } from "../../evidence/manifest";
import { createEvidenceStore } from "../../evidence/store";
import { loadDeclarationContext } from "../../orchestration/context";
import { findProjectRoot } from "../../orchestration/checks/skills-observation";
import { planRunDirectory, prepareRunDirectory } from "../../orchestration/run-directory";
import {
  renderSelfCheckHuman,
  withReportDigest,
  writeRunReport,
  type HumanReportTail,
} from "../../orchestration/report";
import {
  MAX_SCENARIO_CONCURRENCY,
  RUN_COMMAND,
  describeScenarioResult,
  loadScenarioFile,
  runScenarios,
} from "../../orchestration/scenario-run";
import { discoverDsh, hostCliPath } from "../../runtime/dsh/discover";
import { joinFsPath } from "../../runtime/paths";
import { createBinaryWriter, type BinaryWriter } from "../../runtime/platform/binary-writer";
import type { RuntimeFacts } from "../../runtime/types";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";
import { emitFailure, emitUsageFailure } from "./failure";

/** Everything the command needs injected; tests replace the machine. */
export interface RunCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
  readonly binaryWriter?: BinaryWriter;
  /** Explicit browser adapter; `null` disables browser steps for this run. */
  readonly adapter?: BrowserProbeFactory | null;
  readonly importModule?: (specifier: string) => Promise<unknown>;
  readonly npmCommand?: string;
  readonly headless?: boolean;
}

export const RUN_USAGE = "dsh-verify run <scenario.ts> [--concurrency <n>] [--fail-fast|--collect-all] [--json] [--dry-run]";

const RUN_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--dry-run",
  "--profile",
  "--declaration",
  "--work-root",
  "--concurrency",
  "--fail-fast",
  "--collect-all",
]);

interface ParsedConcurrency {
  readonly value: number;
}

function parseConcurrency(raw: string | undefined): ParsedConcurrency | { readonly problem: string } {
  if (raw === undefined) return { value: 1 };
  if (!/^[0-9]+$/.test(raw)) {
    return { problem: `--concurrency needs an integer between 1 and ${MAX_SCENARIO_CONCURRENCY}, got "${raw}"` };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SCENARIO_CONCURRENCY) {
    return { problem: `--concurrency needs an integer between 1 and ${MAX_SCENARIO_CONCURRENCY}, got "${raw}"` };
  }
  return { value };
}


function runPlanJson(
  plan: {
    readonly runId: string;
    readonly runDir: string;
    readonly evidenceDir: string;
  },
  context: {
    readonly workRoot: string;
    readonly profileName: string;
    readonly dshHome: string;
    readonly profileDir: string;
  },
  scenarioFile: string,
  scenarios: readonly { readonly id: string; readonly title: string; readonly steps: readonly unknown[] }[],
  options: {
    readonly concurrency: number;
    readonly failFast: boolean;
    readonly collectAll: boolean;
    readonly repoRoot: string;
    readonly runtime: { readonly exe: string; readonly cliJs: string };
  },
): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "run",
    ok: true,
    dryRun: true,
    plan: {
      workRoot: context.workRoot,
      runId: plan.runId,
      runDir: plan.runDir,
      evidenceDir: plan.evidenceDir,
      scenarioFile,
      scenarios: scenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        stepCount: scenario.steps.length,
      })),
      scenarioCount: scenarios.length,
      stepCount: scenarios.reduce((total, scenario) => total + scenario.steps.length, 0),
      concurrency: options.concurrency,
      failFast: options.failFast,
      collectAll: options.collectAll,
      profile: context.profileName,
      profileDir: context.profileDir,
      dshHome: context.dshHome,
      repoRoot: options.repoRoot,
      runtime: options.runtime,
    },
  })}\n`;
}

function renderRunPlan(
  plan: { readonly runId: string; readonly runDir: string; readonly evidenceDir: string },
  scenarioFile: string,
  scenarios: readonly { readonly id: string; readonly title: string; readonly steps: readonly unknown[] }[],
  options: {
    readonly concurrency: number;
    readonly failFast: boolean;
    readonly collectAll: boolean;
    readonly workRoot: string;
  },
): string {
  const lines: string[] = [];
  lines.push("run plan (dry run) — nothing was written and no scenario was executed");
  lines.push(`scenario file: ${scenarioFile}`);
  lines.push(`scenarios: ${scenarios.length} (${scenarios.reduce((total, item) => total + item.steps.length, 0)} step(s))`);
  for (const scenario of scenarios) lines.push(`  - ${scenario.id}: ${scenario.title} (${scenario.steps.length} step(s))`);
  lines.push(`run dir: ${plan.runDir}`);
  lines.push(`evidence dir: ${plan.evidenceDir}`);
  lines.push(`work root: ${options.workRoot}`);
  lines.push(`concurrency: ${options.concurrency} (mode: ${options.failFast ? "fail-fast" : "collect-all"})`);
  lines.push("dry run: nothing was written");
  return `${lines.join("\n")}\n`;
}

/** Run one `run` invocation and return its exit code. */
export async function runScenarioCommand(args: ParsedArgs, deps: RunCommandDeps): Promise<number> {
  const { ports, io } = deps;
  // `parseArgs` puts the command name in positional[0]; `flagProblems` expects
  // only flags after it, so validate the flag shape against that slice and read
  // the scenario path separately.
  const problems = flagProblems({ ...args, positional: args.positional.slice(0, 1) }, RUN_FLAGS);
  if (problems.length > 0) return emitUsageFailure(io, args.json, RUN_COMMAND, problems, RUN_USAGE);
  if (args.positional.length < 2) {
    return emitUsageFailure(io, args.json, RUN_COMMAND, ["run requires a scenario file"], RUN_USAGE);
  }
  if (args.positional.length > 2) {
    return emitUsageFailure(
      io,
      args.json,
      RUN_COMMAND,
      [`run takes exactly one scenario file, got ${args.positional.length - 1}`],
      RUN_USAGE,
    );
  }
  if (args.failFast && args.collectAll) {
    return emitUsageFailure(
      io,
      args.json,
      RUN_COMMAND,
      ["--fail-fast and --collect-all are mutually exclusive"],
      RUN_USAGE,
    );
  }
  const concurrency = parseConcurrency(args.concurrency);
  if ("problem" in concurrency) {
    return emitUsageFailure(io, args.json, RUN_COMMAND, [concurrency.problem], RUN_USAGE);
  }

  const cwd = ports.env.cwd();
  const repoRoot = await findProjectRoot(ports.fs, cwd);
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
    return emitFailure(io, args.json, RUN_COMMAND, loaded.error.stage, loaded.error.failure);
  }
  const context = loaded.value;

  const discovered = await discoverDsh({ fs: ports.fs, env: ports.env });
  if (!discovered.ok) {
    return emitFailure(io, args.json, RUN_COMMAND, "runtime", discovered.error);
  }
  const runtimePaths = { exe: discovered.value.exe, cliJs: hostCliPath(discovered.value) };

  const scenarioSpecifier = args.positional[1] ?? "";
  const scenarioLoaded = await loadScenarioFile({
    ports,
    cwd,
    repoRoot,
    specifier: scenarioSpecifier,
    ...(deps.importModule === undefined ? {} : { importModule: deps.importModule }),
  });
  if (!scenarioLoaded.ok) {
    return emitFailure(io, args.json, RUN_COMMAND, `scenario-${scenarioLoaded.error.stage}`, scenarioLoaded.error);
  }

  const startedMs = ports.clock.nowMs();
  const startedAt = ports.clock.iso(startedMs);

  if (args.dryRun) {
    const planned = await planRunDirectory({
      fs: ports.fs,
      workRoot: context.workRoot,
      command: RUN_COMMAND,
      startedAt,
    });
    if (!planned.ok) {
      return emitFailure(io, args.json, RUN_COMMAND, "report", planned.error);
    }
    if (args.json) {
      io.stdout(
        runPlanJson(
          planned.value,
          context,
          scenarioLoaded.value.path,
          scenarioLoaded.value.scenarios,
          {
            concurrency: concurrency.value,
            failFast: args.failFast,
            collectAll: args.collectAll,
            repoRoot,
            runtime: runtimePaths,
          },
        ),
      );
    } else {
      io.stdout(
        renderRunPlan(planned.value, scenarioLoaded.value.path, scenarioLoaded.value.scenarios, {
          concurrency: concurrency.value,
          failFast: args.failFast,
          collectAll: args.collectAll,
          workRoot: context.workRoot,
        }),
      );
    }
    return 0;
  }

  const prepared = await prepareRunDirectory({
    fs: ports.fs,
    workRoot: context.workRoot,
    command: RUN_COMMAND,
    startedAt,
  });
  if (!prepared.ok) {
    return emitFailure(io, args.json, RUN_COMMAND, "report", prepared.error);
  }
  const { runDir, runId, evidenceDir } = prepared.value;
  const evidence = createEvidenceStore({ fs: ports.fs, root: evidenceDir, clock: ports.clock });

  const note = (message: string): void => {
    io.stderr(`dsh-verify run: ${message}\n`);
  };
  const environment = await evidence.recordJson(
    "environment",
    {
      platform: ports.env.platform(),
      nodeVersion: deps.runtime.nodeVersion,
      cwd,
      workRoot: context.workRoot,
      dshHome: context.dshHome,
      profile: context.profileName,
      scenarioFile: scenarioLoaded.value.path,
      concurrency: concurrency.value,
      failFast: args.failFast,
      collectAll: args.collectAll,
    },
    { note: "the environment this run observed" },
  );
  if (!environment.ok) note(`could not record environment evidence: ${formatFailure(environment.error)}`);

  const executed = await runScenarios(scenarioLoaded.value.scenarios, {
    ports,
    runtime: { nodeVersion: deps.runtime.nodeVersion, readFileSlice: deps.runtime.readFileSlice },
    runtimePaths,
    dshHome: context.dshHome,
    workRoot: context.workRoot,
    repoRoot,
    profileName: context.profileName,
    profile: context.profile,
    profileDir: context.profileDir,
    evidence,
    binaryWriter: deps.binaryWriter ?? createBinaryWriter(),
    ...(deps.adapter === undefined ? {} : { adapter: deps.adapter }),
    ...(deps.importModule === undefined ? {} : { importModule: deps.importModule }),
    ...(deps.npmCommand === undefined ? {} : { npmCommand: deps.npmCommand }),
    ...(deps.headless === undefined ? {} : { headless: deps.headless }),
    note,
    concurrency: concurrency.value,
    failFast: args.failFast,
  });
  if (!executed.ok) {
    return emitFailure(io, args.json, RUN_COMMAND, "scenario", executed.error);
  }
  const outcome = executed.value;

  const summary = await evidence.recordJson(
    "scenarios",
    {
      scenarios: outcome.scenarios.map((scenario) => ({
        id: scenario.scenarioId,
        title: scenario.title,
        ok: scenario.ok,
        steps: scenario.steps.map((step) => ({ id: step.stepId, state: step.state })),
      })),
      state: outcome.state,
      exitCode: outcome.exitCode,
    },
    { note: "per-scenario step states" },
  );
  if (!summary.ok) note(`could not record the scenario summary: ${formatFailure(summary.error)}`);

  const items: readonly EvidenceManifestItem[] = evidence.items();
  const manifest = buildEvidenceManifest({
    generatedAt: ports.clock.iso(),
    batch: { name: runId, dir: runDir, root: context.workRoot },
    meta: {
      command: RUN_COMMAND,
      profile: context.profileName,
      scenarioFile: scenarioLoaded.value.path,
    },
    summary: {
      state: outcome.state,
      exitCode: outcome.exitCode,
      scenarios: outcome.scenarios.length,
      checks: outcome.checks.length,
    },
    checks: outcome.checks.map((check) => ({
      name: check.id,
      ok: check.status === "pass" || check.status === "skip",
      detail: check.detail,
      recordedAt: ports.clock.iso(),
    })),
    items,
  });
  const writtenManifest = await writeEvidenceManifest({
    fs: ports.fs,
    evidenceRoot: evidenceDir,
    manifest,
  });
  if (!writtenManifest.ok) {
    note(`could not write the evidence manifest: ${formatFailure(writtenManifest.error)}`);
  }

  const report: RunReport = finishRunReport(
    createRunReport({
      command: RUN_COMMAND,
      profile: context.profileName,
      startedAt,
      notes: [`work root: ${context.workRoot}`, `scenario: ${scenarioLoaded.value.path}`],
    }),
    {
      checks: outcome.checks,
      steps: outcome.steps,
      finishedAt: ports.clock.iso(),
      ...(writtenManifest.ok
        ? { evidence: { manifestPath: writtenManifest.value.manifestPath, itemCount: items.length } }
        : {}),
      artifacts: { report: joinFsPath(runDir, "run.json"), evidence: evidenceDir },
      notes: [
        `scenario file: ${scenarioLoaded.value.path}`,
        `concurrency: ${concurrency.value}`,
        `mode: ${args.failFast ? "fail-fast" : "collect-all"}`,
        ...outcome.notes,
      ],
    },
  );

  const written = await writeRunReport({ fs: ports.fs, runDir, report });
  if (!written.ok) {
    return emitFailure(io, args.json, RUN_COMMAND, "report", written.error);
  }
  const finalReport = withReportDigest(report, written.value);
  const tail: HumanReportTail = {
    reportPath: written.value.reportPath,
    reportSha256: written.value.reportSha256,
    evidenceDir,
    evidenceCount: evidence.items().length,
  };
  const scenarioLines = outcome.scenarios.map((scenario) => describeScenarioResult(scenario));
  const human = renderSelfCheckHuman(finalReport, tail);
  if (args.json) {
    io.stdout(`${runReportJson(finalReport)}\n`);
    io.stderr(`${[...scenarioLines, human].join("\n")}\n`);
    io.stderr(`${verdictLine(finalReport)}\n`);
  } else {
    // The human stdout contract is check lines plus the verifiable tail; the
    // per-scenario summary is progress, so it goes to stderr with the notes.
    if (scenarioLines.length > 0) io.stderr(`${scenarioLines.join("\n")}\n`);
    io.stdout(`${human}\n`);
  }
  return exitCodeOfRun(finalReport);
}