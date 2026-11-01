/**
 * `dsh-verify freeze` — mint one candidate and say what it is.
 *
 * Like the other commands this layer only owns the CLI contract: flags, context
 * resolution, the two output modes and exit codes. The evidence gathering lives
 * in `orchestration/freeze.ts`.
 *
 * Exit codes: `0` the candidate was frozen and its client entry checked; `1`
 * the candidate is provably not this source (HEAD moved, entry mismatch, source
 * unstable); `2` a prerequisite is missing or the entry could not be checked.
 */
import { EXIT_CODES } from "../../capability-description";
import type { CandidateEntryCheck } from "../../contracts/candidate-rules";
import type { Ports } from "../../contracts/ports";
import { formatFailure, type Failure } from "../../contracts/result";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import { loadDeclarationContext } from "../../orchestration/context";
import {
  freezeCandidate,
  planFreeze,
  type CandidateChanges,
  type FreezeFailure,
  type FreezeOutcome,
  type FreezePlan,
} from "../../orchestration/freeze";
import { joinFsPath, resolveAgainst } from "../../runtime/paths";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected. */
export interface FreezeCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  /** Only the node version matters here; the loader enforces `requiredNode`. */
  readonly runtime?: { readonly nodeVersion: string };
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

export const FREEZE_USAGE = "dsh-verify freeze [--out <dir>] [--allow-dirty] [--json] [--dry-run]";

const FREEZE_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--dry-run",
  "--profile",
  "--declaration",
  "--work-root",
  "--out",
  "--allow-dirty",
]);

interface FreezeJsonChanges {
  readonly previous: {
    readonly path: string;
    readonly sha256: string;
    readonly commit: string;
    readonly generatedAt: string;
    readonly dir: string;
  };
  readonly added: readonly string[];
  readonly changed: CandidateChanges["changed"];
  readonly removed: readonly string[];
}

function changesJson(outcome: FreezeOutcome): FreezeJsonChanges | null {
  if (outcome.changes === null || outcome.previous === null) return null;
  return {
    previous: {
      path: outcome.previous.manifestPath,
      sha256: outcome.previous.manifestSha256,
      commit: outcome.previous.manifest.git.commit,
      generatedAt: outcome.previous.manifest.generatedAt,
      dir: outcome.previous.dir,
    },
    added: outcome.changes.added,
    changed: outcome.changes.changed,
    removed: outcome.changes.removed,
  };
}

function failureJson(stage: string, error: Failure): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "freeze",
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

function outcomeJson(outcome: FreezeOutcome, ok: boolean, error?: Failure, stage?: string): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "freeze",
    ok,
    candidate: outcome.candidate,
    candidatePath: outcome.candidatePath,
    candidateSha256: outcome.candidateSha256,
    entry: outcome.candidate.entry ?? null,
    notes: outcome.notes,
    changes: changesJson(outcome),
    ...(ok || error === undefined || stage === undefined
      ? {}
      : {
          error: {
            code: error.code,
            message: error.message,
            ...(error.hint === undefined ? {} : { hint: error.hint }),
            ...(error.details === undefined ? {} : { details: error.details }),
            stage,
          },
        }),
  })}\n`;
}

function renderEntry(entry: CandidateEntryCheck | undefined): string {
  if (entry === undefined) return "entry: not inspected";
  const found =
    entry.foundPackageName === null && entry.foundVersion === null
      ? "no name/version found"
      : `${entry.foundPackageName ?? "?"} v${entry.foundVersion ?? "?"}`;
  return `entry: ${entry.clientEntry} — ${entry.status} (${found})`;
}

function renderOutcome(outcome: FreezeOutcome): string {
  const { candidate } = outcome;
  const lines: string[] = [];
  lines.push(`candidate ${candidate.version} @ ${candidate.git.commit} (${candidate.validity}, sourceStable=${String(candidate.sourceStable)})`);
  lines.push(`candidate.json: ${outcome.candidatePath} (sha256 ${outcome.candidateSha256})`);
  lines.push(`tarball: ${candidate.package.tgzPath} (sha256 ${candidate.package.tgzSha256})`);
  lines.push(`files: ${candidate.package.fileCount} (fileDigest ${candidate.package.fileDigest})`);
  lines.push(`build commit: ${candidate.package.buildCommit ?? "not embedded"}`);
  lines.push(renderEntry(candidate.entry));
  if (outcome.changes !== null && outcome.previous !== null) {
    lines.push(`changes vs ${outcome.previous.dir}:`);
    for (const path of outcome.changes.added) lines.push(`  + ${path}`);
    for (const item of outcome.changes.changed) lines.push(`  ~ ${item.path}`);
    for (const path of outcome.changes.removed) lines.push(`  - ${path}`);
    if (outcome.changes.added.length + outcome.changes.changed.length + outcome.changes.removed.length === 0) {
      lines.push("  (no file changes)");
    }
  } else {
    lines.push(`changes: no earlier candidate for ${candidate.git.commit.slice(0, 12)}`);
  }
  return `${lines.join("\n")}\n`;
}


function planJson(plan: FreezePlan): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "freeze",
    ok: true,
    dryRun: true,
    plan: {
      outDir: plan.outDir,
      candidateName: plan.candidateName,
      candidateDir: plan.candidateDir,
      rootPackage: plan.rootPackage,
      git: plan.before,
      generatedAt: plan.generatedAt,
      build: plan.build,
      pack: plan.pack,
      previous:
        plan.previous === null
          ? null
          : {
              dir: plan.previous.dir,
              manifestPath: plan.previous.manifestPath,
              manifestSha256: plan.previous.manifestSha256,
              commit: plan.previous.manifest.git.commit,
            },
      notes: plan.notes,
    },
  })}\n`;
}

function renderDryRun(plan: FreezePlan): string {
  const lines: string[] = [];
  lines.push("freeze plan (dry run) — nothing was written");
  lines.push(`package: ${plan.rootPackage.name}@${plan.rootPackage.version}`);
  lines.push(`candidate: ${plan.candidateName}`);
  lines.push(`candidate dir: ${plan.candidateDir}`);
  lines.push(`out dir: ${plan.outDir}`);
  lines.push(`git: ${plan.before.commit} (${plan.before.branch}, dirty=${String(plan.before.dirty)})`);
  if (plan.before.dirty) lines.push(`dirty files: ${plan.before.dirtyFiles.length}`);
  lines.push(plan.build === null ? "build: no build command declared" : `build: ${plan.build.argv.join(" ")} (cwd ${plan.build.cwd})`);
  lines.push(`pack: ${plan.pack.argv.join(" ")}`);
  lines.push(
    plan.previous === null
      ? `previous: none for ${plan.before.commit.slice(0, 12)}`
      : `previous: ${plan.previous.dir} (sha256 ${plan.previous.manifestSha256})`,
  );
  for (const note of plan.notes) lines.push(`note: ${note}`);
  lines.push("dry run: nothing was written");
  return `${lines.join("\n")}\n`;
}

/** Run one `freeze` invocation and return its exit code. */
export async function runFreezeCommand(args: ParsedArgs, deps: FreezeCommandDeps): Promise<number> {
  const { ports, io } = deps;

  const problems = flagProblems(args, FREEZE_FLAGS);
  if (problems.length > 0) {
    const message = `${problems.join("; ")}\n${FREEZE_USAGE}`;
    io.stderr(`dsh-verify freeze: ${message}\n`);
    if (args.json) io.stdout(failureJson("usage", { code: "invalid-input", message }));
    return EXIT_CODES.blocked;
  }

  const cwd = ports.env.cwd();
  const context = await loadDeclarationContext({
    ports,
    cwd,
    nodeVersion: deps.runtime?.nodeVersion ?? "0.0.0-unknown",
    ...(args.workRoot === undefined ? {} : { workRoot: args.workRoot }),
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
    ...(args.profile === undefined ? {} : { profileOverride: args.profile }),
    ...(deps.loadDeclaration === undefined ? {} : { loadDeclaration: deps.loadDeclaration }),
  });
  if (!context.ok) {
    io.stderr(`dsh-verify freeze: ${formatFailure(context.error.failure)}\n`);
    if (args.json) io.stdout(failureJson(context.error.stage, context.error.failure));
    return EXIT_CODES.blocked;
  }

  const outDir = args.out === undefined
    ? joinFsPath(context.value.workRoot, "candidates")
    : resolveAgainst(cwd, args.out);

  if (args.dryRun) {
    const planned = await planFreeze({ ports, context: context.value, outDir, allowDirty: args.allowDirty });
    if (!planned.ok) {
      const error: FreezeFailure = planned.error;
      io.stderr(`dsh-verify freeze: ${formatFailure(error)} (stage: ${error.stage})\n`);
      if (args.json) io.stdout(failureJson(error.stage, error));
      return error.blocked ? EXIT_CODES.blocked : EXIT_CODES.hardFailure;
    }
    if (args.json) io.stdout(planJson(planned.value));
    else io.stdout(renderDryRun(planned.value));
    return EXIT_CODES.ok;
  }

  io.stderr(`dsh-verify freeze: building ${context.value.profile.packageName} from ${cwd}\n`);
  const frozen = await freezeCandidate({
    ports,
    context: context.value,
    outDir,
    allowDirty: args.allowDirty,
  });
  if (!frozen.ok) {
    const error: FreezeFailure = frozen.error;
    io.stderr(`dsh-verify freeze: ${formatFailure(error)} (stage: ${error.stage})\n`);
    if (args.json) io.stdout(failureJson(error.stage, error));
    return error.blocked ? EXIT_CODES.blocked : EXIT_CODES.hardFailure;
  }

  const outcome = frozen.value;
  for (const note of outcome.notes) io.stderr(`dsh-verify freeze: note: ${note}\n`);

  if (outcome.candidate.entry?.status === "blocked") {
    const entry = outcome.candidate.entry;
    const message = `packaged client entry ${entry.clientEntry} could not be checked (name=${String(entry.foundPackageName)}, version=${String(entry.foundVersion)})`;
    if (args.json) {
      io.stdout(outcomeJson(outcome, false, { code: "prerequisite", message, hint: "declare the plugin name and version in the client bundle" }, "entry"));
    } else {
      io.stdout(renderOutcome(outcome));
      io.stderr(`dsh-verify freeze: blocked: ${message}\n`);
    }
    return EXIT_CODES.blocked;
  }

  if (!outcome.candidate.sourceStable) {
    const message = "HEAD or the dirty file set changed while the package was built; the candidate is recorded with sourceStable=false";
    if (args.json) {
      io.stdout(outcomeJson(outcome, false, { code: "conflict", message, hint: "freeze again on a quiet tree" }, "git"));
    } else {
      io.stdout(renderOutcome(outcome));
      io.stderr(`dsh-verify freeze: fail: ${message}\n`);
    }
    return EXIT_CODES.hardFailure;
  }

  if (args.json) io.stdout(outcomeJson(outcome, true));
  else io.stdout(renderOutcome(outcome));
  return EXIT_CODES.ok;
}