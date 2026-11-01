/**
 * `dsh-verify install` — install one candidate tarball into an isolated profile.
 *
 * This command is deliberately thin: unpacking, the cross-drive refusal and the
 * five post-install checks all live in `orchestration/install-package.ts`. What
 * belongs here is the CLI contract — which flags are legal, how a fatal failure
 * is rendered, and how the check results map to an exit code.
 *
 * Output contract: with `--json` stdout carries exactly one JSON document and
 * progress/check lines go to stderr; without it, stdout carries the check lines.
 */
import { EXIT_CODES } from "../../capability-description";
import type { Ports } from "../../contracts/ports";
import { formatFailure } from "../../contracts/result";
import { stateFromChecks } from "../../contracts/run-state";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import { loadDeclarationContext } from "../../orchestration/context";
import {
  DEFAULT_INSTALL_METHOD,
  INSTALL_METHODS,
  installPackage,
  planInstall,
  type InstallMethod,
  type InstallPlan,
} from "../../orchestration/install-package";
import { renderCheckLines } from "../../orchestration/report";
import { resolveAgainst } from "../../runtime/paths";
import { createBinaryWriter, type BinaryWriter } from "../../runtime/platform/binary-writer";
import type { RuntimeFacts } from "../../runtime/types";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";
import { emitFailure, emitUsageFailure } from "./failure";

/** Everything the command needs injected; tests replace the machine. */
export interface InstallCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
  /** The binary write seam; defaults to the real filesystem writer. */
  readonly binaryWriter?: BinaryWriter;
}

export const INSTALL_USAGE = "dsh-verify install --tgz <file> [--method extract|cli] [--profile <p>] [--json] [--dry-run]";

const INSTALL_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--dry-run",
  "--profile",
  "--declaration",
  "--work-root",
  "--tgz",
  "--method",
  "--candidate",
]);

function parseMethod(raw: string | undefined): { readonly method: InstallMethod } | { readonly problem: string } {
  if (raw === undefined) return { method: DEFAULT_INSTALL_METHOD };
  if (!(INSTALL_METHODS as readonly string[]).includes(raw)) {
    return { problem: `--method must be one of ${INSTALL_METHODS.join(", ")}, got "${raw}"` };
  }
  return { method: raw as InstallMethod };
}


function installPlanJson(plan: InstallPlan): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "install",
    ok: true,
    dryRun: true,
    plan: {
      tgzPath: plan.tgzPath,
      tgzSha256: plan.tgzSha256,
      method: plan.method,
      packageName: plan.packageName,
      packageVersion: plan.packageVersion,
      profileDir: plan.profileDir,
      targetDir: plan.targetDir,
      nodeModulesDir: plan.nodeModulesDir,
      willReplaceExisting: plan.willReplaceExisting,
      expectedSource: plan.expectedSource,
      candidatePath: plan.candidatePath,
      expectedFileCount: plan.expectedFileCount,
      expectedFiles: plan.expectedFiles.map((file) => ({ path: file.path, bytes: file.bytes })),
      profileManifestPath: plan.profileManifestPath,
      dependencySpec: plan.dependencySpec,
      npmArgv: plan.npmArgv,
      notes: plan.notes,
    },
  })}\n`;
}

function renderInstallPlan(plan: InstallPlan): string {
  const lines: string[] = [];
  lines.push("install plan (dry run) — nothing was written");
  lines.push(`tarball: ${plan.tgzPath} (sha256 ${plan.tgzSha256})`);
  lines.push(`package: ${plan.packageName}@${plan.packageVersion}`);
  lines.push(`method: ${plan.method}`);
  lines.push(`target: ${plan.targetDir}`);
  lines.push(`existing target: ${plan.willReplaceExisting ? "yes, it would be replaced" : "no"}`);
  lines.push(`expected files: ${plan.expectedFileCount} (source: ${plan.expectedSource})`);
  for (const file of plan.expectedFiles) lines.push(`  - ${file.path} (${file.bytes} bytes)`);
  lines.push(`profile manifest: ${plan.profileManifestPath} (dependencies[${plan.packageName}] = ${plan.dependencySpec})`);
  if (plan.npmArgv !== null) lines.push(`npm: ${plan.npmArgv.join(" ")}`);
  for (const note of plan.notes) lines.push(`note: ${note}`);
  lines.push("dry run: nothing was written");
  return `${lines.join("\n")}\n`;
}

/** Run one `install` invocation and return its exit code. */
export async function runInstallCommand(args: ParsedArgs, deps: InstallCommandDeps): Promise<number> {
  const { ports, io } = deps;
  const problems = flagProblems(args, INSTALL_FLAGS);
  if (problems.length > 0) return emitUsageFailure(io, args.json, "install", problems, INSTALL_USAGE);
  if (args.tgz === undefined || args.tgz.trim().length === 0) {
    return emitUsageFailure(io, args.json, "install", ["install requires --tgz <file>"], INSTALL_USAGE);
  }
  const method = parseMethod(args.method);
  if ("problem" in method) {
    return emitUsageFailure(io, args.json, "install", [method.problem], INSTALL_USAGE);
  }

  const cwd = ports.env.cwd();
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
    return emitFailure(io, args.json, "install", loaded.error.stage, loaded.error.failure);
  }
  const context = loaded.value;

  const tgzPath = resolveAgainst(cwd, args.tgz);
  const candidatePath = args.candidate === undefined ? null : resolveAgainst(cwd, args.candidate);
  const note = (message: string): void => {
    io.stderr(`dsh-verify install: ${message}\n`);
  };
  // Installing mutates the profile's node_modules. When DSH_HOME is not set the
  // target is the real user home, which the documentation forbids writing; say
  // so before the first byte is written instead of leaving it to the operator.
  const dshHomeOverride = ports.env.snapshot()["DSH_HOME"];
  if (dshHomeOverride === undefined || dshHomeOverride.trim() === "") {
    note(
      `warning: DSH_HOME is not set, so the target profile ${context.profileDir} belongs to the real user home; ` +
        "copy it into a batch home and set DSH_HOME to keep the real home untouched",
    );
  }

  if (args.dryRun) {
    const planned = await planInstall({
      ports,
      tgzPath,
      method: method.method,
      dshHome: context.dshHome,
      profileName: context.profileName,
      profileDir: context.profileDir,
      packageName: context.profile.packageName,
      clientEntry: context.profile.clientEntry,
      ...(candidatePath === null ? {} : { candidatePath }),
    });
    if (!planned.ok) {
      return emitFailure(io, args.json, "install", planned.error.stage, planned.error);
    }
    if (args.json) io.stdout(installPlanJson(planned.value));
    else io.stdout(renderInstallPlan(planned.value));
    return EXIT_CODES.ok;
  }

  note(`installing ${tgzPath} into ${context.profileDir} (${method.method})`);

  const installed = await installPackage({
    ports,
    binaryWriter: deps.binaryWriter ?? createBinaryWriter(),
    tgzPath,
    method: method.method,
    dshHome: context.dshHome,
    profileName: context.profileName,
    profileDir: context.profileDir,
    packageName: context.profile.packageName,
    clientEntry: context.profile.clientEntry,
    candidatePath,
    note,
  });
  if (!installed.ok) {
    return emitFailure(io, args.json, "install", installed.error.stage, installed.error);
  }

  const outcome = installed.value;
  const exitCode = stateFromChecks(outcome.checks).exitCode;
  const lines = outcome.checks.flatMap((check) => renderCheckLines(check));
  if (args.json) {
    const payload = {
      schemaVersion: 1,
      command: "install",
      ok: exitCode === 0,
      profile: context.profileName,
      ...outcome,
    };
    io.stdout(`${JSON.stringify(payload)}\n`);
    for (const line of lines) io.stderr(`${line}\n`);
  } else {
    for (const line of lines) io.stdout(`${line}\n`);
  }
  if (exitCode !== 0) {
    const failed = outcome.checks.filter((check) => check.status === "fail" || check.status === "blocked");
    io.stderr(`dsh-verify install: ${failed.length} check(s) did not pass; expectedSource=${outcome.expectedSource}\n`);
  }
  return exitCode === 0 ? EXIT_CODES.ok : exitCode;
}