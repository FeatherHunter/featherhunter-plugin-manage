/**
 * `dsh-verify model` — inspect, and only with `--fix` repair, one profile's
 * model wiring in its patch layer.
 *
 * The command is a thin CLI contract over two lower layers: `profile-rules`
 * decides what is wrong (pure text), and `model-configurator` reads/plans/writes
 * and re-reads. What lives here is the check vocabulary, the human line format,
 * the `--json` document and the exit-code mapping.
 *
 * Read-only by default. `--fix` is the only path that calls writeText, and even
 * then only when the plan actually changes a line. A profile that already
 * conforms is left byte-for-byte alone.
 *
 * Exit codes: `0` every check passes, `1` a hard mismatch remains (including a
 * recheck that did not converge), `2` a prerequisite is missing (no patch layer,
 * no provider entry, no credential value) or the invocation is invalid.
 */
import { EXIT_CODES } from "../../capability-description";
import type { BlockedReason } from "../../contracts/evidence-contract";
import type { Ports } from "../../contracts/ports";
import {
  inspectModelConfig,
  planModelConfigEdit,
  type ModelConfigProblem,
  type ModelConfigState,
} from "../../contracts/profile-rules";
import { formatFailure, type Failure } from "../../contracts/result";
import type { ModelSelection, VerificationProfile } from "../../contracts/verification-profile";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import { loadDeclarationContext } from "../../orchestration/context";
import { findWriteUnderRealHome } from "../../runtime/dsh/home";
import {
  fixModelConfig,
  modelPatchPath,
  observeCredentialPresence,
  readModelConfig,
  type CredentialPresence,
} from "../../runtime/dsh/model-configurator";
import type { RuntimeFacts } from "../../runtime/types";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** Everything the command needs injected; the CLI wires the real machine. */
export interface ModelCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

/** The usage line, repeated in errors so a caller never has to read `describe`. */
export const MODEL_USAGE =
  "dsh-verify model [--profile <p>] [--provider <p>] [--model <m>] [--api-key-env <ENV>] [--fix] [--json] [--dry-run]";

/** Flags this command implements; anything else recognized is a usage error. */
const MODEL_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--dry-run",
  "--profile",
  "--declaration",
  "--provider",
  "--model",
  "--api-key-env",
  "--fix",
]);

type ModelCheckStatus = "pass" | "fail" | "skip" | "blocked";

/** One line of the human format and one element of the JSON `checks` array. */
interface ModelCheck {
  readonly id: string;
  readonly status: ModelCheckStatus;
  readonly detail: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
  /** Present on every blocked line, so a reader never parses the sentence for the cause. */
  readonly blockedReason?: BlockedReason;
}

/** Every fail line carries all three fields; this is the hint when rules have none. */
const DEFAULT_FAIL_HINT =
  "run dsh-verify model --fix (it only edits existing entries) or edit the patch entry by hand; values are compared verbatim";

function problemOf(
  state: ModelConfigState,
  code: ModelConfigProblem["code"],
  entryId?: string,
): ModelConfigProblem | null {
  return (
    state.problems.find(
      (problem) => problem.code === code && (entryId === undefined || problem.entryId === entryId),
    ) ?? null
  );
}

function failFromProblem(id: string, problem: ModelConfigProblem): ModelCheck {
  return {
    id,
    status: "fail",
    detail: problem.message,
    expected: problem.expected ?? "(not stated)",
    actual: problem.actual ?? "(not stated)",
    hint: problem.hint ?? DEFAULT_FAIL_HINT,
  };
}

/**
 * Turn the pure inspection into stable check ids. The grouping is deliberate:
 * each id answers one operator question ("which default provider?", "which
 * credential reference?"), so a recheck can name exactly what still fails.
 */
function buildChecks(
  state: ModelConfigState,
  selection: ModelSelection,
  credential: CredentialPresence,
): ModelCheck[] {
  const checks: ModelCheck[] = [];

  const missingDefault = problemOf(state, "missing-default-model-entry");
  if (missingDefault !== null) {
    checks.push({
      id: "model-default-entry",
      status: "blocked",
      detail: missingDefault.message,
      blockedReason: {
        code: "prerequisite-missing",
        message: missingDefault.message,
        ...(missingDefault.hint === undefined ? {} : { hint: missingDefault.hint }),
      },
      expected: missingDefault.expected ?? "agent-default-model entry",
      actual: missingDefault.actual ?? "absent",
      ...(missingDefault.hint === undefined ? {} : { hint: missingDefault.hint }),
    });
  } else {
    checks.push({
      id: "model-default-entry",
      status: "pass",
      detail: "agent-default-model entry exists",
    });

    const provider = problemOf(state, "provider-mismatch", "agent-default-model");
    checks.push(
      provider === null
        ? {
            id: "model-default-provider",
            status: "pass",
            detail: `default provider is ${state.defaultProvider ?? "(missing)"}`,
          }
        : failFromProblem("model-default-provider", provider),
    );

    const model = problemOf(state, "model-mismatch", "agent-default-model");
    checks.push(
      model === null
        ? {
            id: "model-default-model",
            status: "pass",
            detail: `default model is ${state.defaultModel ?? "(missing)"}`,
          }
        : failFromProblem("model-default-model", model),
    );
  }

  const missingProvider = problemOf(state, "missing-provider-entry");
  const providerBlock = problemOf(state, "provider-mismatch", "llm-pi-ai");
  if (missingProvider !== null) {
    checks.push({
      id: "model-provider-entry",
      status: "blocked",
      detail: missingProvider.message,
      blockedReason: {
        code: "prerequisite-missing",
        message: missingProvider.message,
        ...(missingProvider.hint === undefined ? {} : { hint: missingProvider.hint }),
      },
      expected: missingProvider.expected ?? "llm-pi-ai entry",
      actual: missingProvider.actual ?? "absent",
      ...(missingProvider.hint === undefined ? {} : { hint: missingProvider.hint }),
    });
  } else {
    checks.push({
      id: "model-provider-entry",
      status: "pass",
      detail: "llm-pi-ai entry exists",
    });
  }

  if (missingProvider !== null) {
    checks.push({
      id: "model-provider-block",
      status: "skip",
      detail: "skipped because the llm-pi-ai entry is missing",
    });
    checks.push({
      id: "model-credential-ref",
      status: "skip",
      detail: "skipped because the llm-pi-ai entry is missing",
    });
    checks.push({
      id: "model-declared-models",
      status: "skip",
      detail: "skipped because the llm-pi-ai entry is missing",
    });
  } else {
    checks.push(
      providerBlock === null
        ? {
            id: "model-provider-block",
            status: "pass",
            detail: `llm-pi-ai declares provider ${selection.provider}`,
          }
        : failFromProblem("model-provider-block", providerBlock),
    );

    if (providerBlock !== null) {
      checks.push({
        id: "model-credential-ref",
        status: "skip",
        detail: `skipped because provider ${selection.provider} is not configured`,
      });
      checks.push({
        id: "model-declared-models",
        status: "skip",
        detail: `skipped because provider ${selection.provider} is not configured`,
      });
    } else {
      const keyEnv = problemOf(state, "api-key-env-mismatch");
      checks.push(
        keyEnv === null
          ? {
              id: "model-credential-ref",
              status: "pass",
              detail: `provider ${selection.provider} reads its key from ${selection.apiKeyEnv}`,
            }
          : failFromProblem("model-credential-ref", keyEnv),
      );

      const models = problemOf(state, "models-empty") ?? problemOf(state, "model-not-declared");
      checks.push(
        models === null
          ? {
              id: "model-declared-models",
              status: "pass",
              detail: `models list declares ${selection.model} (${state.declaredModels.length} id(s))`,
            }
          : failFromProblem("model-declared-models", models),
      );
    }
  }

  const mismatches = state.problems.filter((problem) => problem.code === "reference-model-mismatch");
  if (mismatches.length === 0) {
    checks.push({
      id: "model-reference-model",
      status: "pass",
      detail:
        state.references.length === 0
          ? "no reference parties name a provider/model pair"
          : `${state.references.length} reference item(s) agree with the declared model id`,
    });
  } else {
    checks.push({
      id: "model-reference-model",
      status: "fail",
      detail: mismatches.map((problem) => problem.message).join("; "),
      expected: selection.model,
      actual: mismatches.map((problem) => `${problem.entryId ?? "?"}=${problem.actual ?? "?"}`).join(", "),
      hint: mismatches[0]?.hint ?? DEFAULT_FAIL_HINT,
    });
  }

  const credentialApplies =
    missingProvider === null && providerBlock === null && problemOf(state, "api-key-env-mismatch") === null;
  if (!credentialApplies) {
    checks.push({
      id: "model-credential-value",
      status: "skip",
      detail: `skipped because the patch layer does not reference ${selection.apiKeyEnv}`,
    });
  } else if (credential.available) {
    checks.push({
      id: "model-credential-value",
      status: "pass",
      detail: `${credential.ref} is available from ${
        credential.source === "env" ? "the process environment" : "the DSH home credential store"
      }`,
    });
  } else {
    checks.push({
      id: "model-credential-value",
      status: "blocked",
      detail: `no value for ${credential.ref}: ${credential.note ?? "not found"}`,
      expected: `a value for ${credential.ref}`,
      actual: "not found",
      hint: `add ${credential.ref} to ${credential.storePath} or set it in the environment; this command never invents credential values`,
      blockedReason: {
        code: "prerequisite-missing",
        message: `no value for ${credential.ref}: ${credential.note ?? "not found"}`,
        hint: `add ${credential.ref} to ${credential.storePath} or set it in the environment`,
      },
    });
  }

  return checks;
}

function exitCodeFor(checks: readonly ModelCheck[]): number {
  if (checks.some((check) => check.status === "fail")) return EXIT_CODES.hardFailure;
  if (checks.some((check) => check.status === "blocked")) return EXIT_CODES.blocked;
  return EXIT_CODES.ok;
}

/** One human line; the fail form always names expected, actual and a hint. */
function renderCheckLine(check: ModelCheck): string {
  const extras: string[] = [];
  if (check.status === "fail") {
    extras.push(`expected ${check.expected ?? "(not stated)"}`);
    extras.push(`actual ${check.actual ?? "(not stated)"}`);
  }
  if (check.hint !== undefined) extras.push(`hint: ${check.hint}`);
  const suffix = extras.length === 0 ? "" : `; ${extras.join("; ")}`;
  return `${check.status} ${check.id} ${check.detail}${suffix}`;
}

interface ModelFixReport {
  readonly requested: boolean;
  readonly changed: boolean;
  readonly written: boolean;
  readonly notes: readonly string[];
  readonly error: Failure | null;
}

interface ModelReport {
  readonly schemaVersion: 1;
  readonly command: "model";
  readonly ok: boolean;
  readonly profile: string;
  readonly profileDir: string;
  readonly patchPath: string;
  readonly selection: ModelSelection;
  readonly before: ModelConfigState | null;
  readonly after: ModelConfigState | null;
  readonly checks: readonly ModelCheck[];
  readonly credential: CredentialPresence | null;
  readonly fix: ModelFixReport;
}

/** The one-document failure form shared with the other commands. */
function failureJson(stage: string, error: Failure): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "model",
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

function reject(args: ParsedArgs, io: CliIo, stage: string, error: Failure): number {
  io.stderr(`dsh-verify model: ${formatFailure(error)}\n`);
  if (args.json) io.stdout(failureJson(stage, error));
  return EXIT_CODES.blocked;
}

/** Emit the report in the requested mode and return its exit code. */
function emitReport(args: ParsedArgs, io: CliIo, report: ModelReport, exitCode: number): number {
  const sink = args.json ? io.stderr : io.stdout;
  for (const check of report.checks) sink(`${renderCheckLine(check)}\n`);
  if (args.json) {
    io.stdout(`${JSON.stringify({ ...report, ok: exitCode === EXIT_CODES.ok })}\n`);
  }
  return exitCode;
}

/** `--fix` refusal: the rules said this entry must not be invented. */
function fixRefusalCheck(error: Failure): ModelCheck {
  return {
    id: "model-fix",
    status: "blocked",
    detail: `refused to edit the patch layer: ${error.message}`,
    expected: "an existing patch entry that can be repaired in place",
    actual: error.message,
    hint: error.hint ?? "repair or install the profile first; this command never invents a plugin entry",
    blockedReason: {
      code: "prerequisite-missing",
      message: `refused to edit the patch layer: ${error.message}`,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
    },
  };
}

/** `--fix` planning failure that is not a refused prerequisite (an internal non-convergence). */
function fixPlanFailureCheck(error: Failure): ModelCheck {
  return {
    id: "model-fix",
    status: "fail",
    detail: `could not plan an edit for the patch layer: ${error.message}`,
    expected: "a minimal edit plan that re-inspects as conforming",
    actual: error.message,
    hint: error.hint ?? "review the patch layer by hand; this tool will not write a plan it cannot verify",
  };
}

/** `--fix` write failure: the plan existed but the file did not change. */
function fixWriteFailureCheck(error: Failure): ModelCheck {
  return {
    id: "model-fix",
    status: "fail",
    detail: "the patch layer could not be written",
    expected: "the patch layer written with the planned edit",
    actual: error.message,
    hint: error.hint ?? "the patch file is unchanged; fix the file permission or the disk and rerun",
  };
}

interface SelectionResolution {
  readonly selection: ModelSelection;
  readonly failure: Failure | null;
}

/** Resolve the declaration's model, then apply explicit flag overrides. */
function resolveSelection(args: ParsedArgs, profile: VerificationProfile): SelectionResolution {
  const declared = profile.model;
  if (declared === false) {
    const missing = [
      ...(args.provider === undefined ? ["--provider"] : []),
      ...(args.model === undefined ? ["--model"] : []),
      ...(args.apiKeyEnv === undefined ? ["--api-key-env"] : []),
    ];
    if (missing.length > 0) {
      return {
        selection: { provider: "", model: "", apiKeyEnv: "" },
        failure: {
          code: "prerequisite",
          message: `the profile declares no model (model: false); ${
            missing.length === 3 ? "pass --provider, --model and --api-key-env together" : `missing ${missing.join(", ")}`
          }`,
          hint: "set model: { provider, model, apiKeyEnv } in the declaration, or pass all three flags",
        },
      };
    }
  }

  const base = declared === false ? undefined : declared;
  const provider = args.provider ?? base?.provider;
  const model = args.model ?? base?.model;
  const apiKeyEnv = args.apiKeyEnv ?? base?.apiKeyEnv;
  const missingNames = [
    ...(provider === undefined || provider.length === 0 ? ["provider"] : []),
    ...(model === undefined || model.length === 0 ? ["model"] : []),
    ...(apiKeyEnv === undefined || apiKeyEnv.length === 0 ? ["apiKeyEnv"] : []),
  ];
  if (provider === undefined || model === undefined || apiKeyEnv === undefined || missingNames.length > 0) {
    return {
      selection: { provider: "", model: "", apiKeyEnv: "" },
      failure: {
        code: "prerequisite",
        message: `the model selection is incomplete: ${missingNames.join(", ")} missing`,
        hint: "pass --provider, --model and --api-key-env, or declare them in the profile",
      },
    };
  }

  for (const [name, value] of [
    ["provider", provider],
    ["model", model],
    ["apiKeyEnv", apiKeyEnv],
  ] as const) {
    if (/[\r\n]/.test(value)) {
      return {
        selection: { provider: "", model: "", apiKeyEnv: "" },
        failure: {
          code: "invalid-input",
          message: `${name} must not contain a line break`,
          hint: "provider, model and apiKeyEnv are single-line YAML scalars",
        },
      };
    }
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.$-]*$/.test(apiKeyEnv)) {
    return {
      selection: { provider: "", model: "", apiKeyEnv: "" },
      failure: {
        code: "invalid-input",
        message: `apiKeyEnv ${JSON.stringify(apiKeyEnv)} is not an environment-variable-shaped reference name`,
        hint: "use letters, digits, underscore, dot, dollar or dash, starting with a letter or underscore",
      },
    };
  }

  return {
    selection: {
      provider,
      model,
      apiKeyEnv,
      ...(base?.contextWindow === undefined ? {} : { contextWindow: base.contextWindow }),
      ...(base?.maxTokens === undefined ? {} : { maxTokens: base.maxTokens }),
      ...(base?.input === undefined ? {} : { input: base.input }),
    },
    failure: null,
  };
}


function modelPlanJson(
  context: { readonly profileName: string; readonly profileDir: string },
  patchPath: string,
  selection: ModelSelection,
  before: { readonly state: ModelConfigState; readonly text: string },
  credential: CredentialPresence,
  edit: { readonly changed: boolean; readonly notes: readonly string[] } | { readonly error: Failure },
  checks: readonly ModelCheck[],
  fixRequested: boolean,
  exitCode: number,
  predictedChecks: readonly ModelCheck[],
): string {
  const editJson =
    "error" in edit
      ? { changed: false, notes: [], error: edit.error }
      : { changed: edit.changed, notes: edit.notes, error: null };
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "model",
    ok: exitCode === EXIT_CODES.ok,
    exitCode,
    dryRun: true,
    plan: {
      profile: context.profileName,
      profileDir: context.profileDir,
      patchPath,
      selection,
      fixRequested,
      current: {
        configured: before.state.configured,
        problems: before.state.problems,
      },
      edit: editJson,
      wouldWrite: fixRequested && !before.state.configured && !("error" in edit) && edit.changed,
      credential: {
        ref: credential.ref,
        available: credential.available,
        source: credential.source,
        storePath: credential.storePath,
        storeRefPresent: credential.storeRefPresent,
      },
      checks,
      // What the run would report: with --fix the checks of the planned text,
      // without it the current checks. ok/exitCode above follow this block.
      predicted: { exitCode, checks: predictedChecks },
    },
  })}\n`;
}

function renderModelPlan(
  context: { readonly profileName: string; readonly profileDir: string },
  patchPath: string,
  selection: ModelSelection,
  before: { readonly state: ModelConfigState; readonly text: string },
  edit: { readonly changed: boolean; readonly notes: readonly string[] } | { readonly error: Failure },
  checks: readonly ModelCheck[],
  fixRequested: boolean,
): string {
  const lines: string[] = [];
  lines.push("model plan (dry run) — nothing was written");
  lines.push(`profile: ${context.profileName} (${context.profileDir})`);
  lines.push(`patch: ${patchPath}`);
  lines.push(`selection: ${selection.provider}/${selection.model} (credential ref ${selection.apiKeyEnv})`);
  lines.push(`current: configured=${String(before.state.configured)}, problems=${before.state.problems.length}`);
  lines.push(`fix requested: ${String(fixRequested)}`);
  if ("error" in edit) {
    lines.push(`edit: cannot be planned — ${formatFailure(edit.error)}`);
  } else {
    lines.push(`edit: ${edit.changed ? `${edit.notes.length} change(s)` : "no change"}`);
    for (const note of edit.notes) lines.push(`  - ${note}`);
  }
  lines.push(`checks (current state): ${checks.length}`);
  for (const check of checks) lines.push(`  - ${check.status} ${check.id} ${check.detail}`);
  lines.push("dry run: nothing was written");
  return `${lines.join("\n")}\n`;
}

/** Run one `model` invocation and return its exit code. */
export async function runModelCommand(args: ParsedArgs, deps: ModelCommandDeps): Promise<number> {
  const { ports, io } = deps;

  const problems = flagProblems(args, MODEL_FLAGS);
  if (problems.length > 0) {
    return reject(args, io, "usage", {
      code: "invalid-input",
      message: `${problems.join("; ")}; usage: ${MODEL_USAGE}`,
    });
  }

  const context = await loadDeclarationContext({
    ports,
    cwd: ports.env.cwd(),
    nodeVersion: deps.runtime.nodeVersion,
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
    ...(args.profile === undefined ? {} : { profileOverride: args.profile }),
    ...(deps.loadDeclaration === undefined ? {} : { loadDeclaration: deps.loadDeclaration }),
  });
  if (!context.ok) {
    return reject(args, io, context.error.stage, context.error.failure);
  }

  const resolved = resolveSelection(args, context.value.profile);
  if (resolved.failure !== null) {
    return reject(args, io, "selection", resolved.failure);
  }
  const selection = resolved.selection;
  const patchPath = modelPatchPath(context.value.profileDir);

  io.stderr(
    `dsh-verify model: profile ${context.value.profileName}, patch ${patchPath}, ` +
      `selection ${selection.provider}/${selection.model}, credential ref ${selection.apiKeyEnv}\n`,
  );

  const observed = await readModelConfig(ports.fs, context.value.profileDir, selection);
  if (!observed.ok) {
    const check: ModelCheck = {
      id: "model-patch",
      status: "blocked",
      detail: observed.error.message,
      expected: `a readable ${patchPath}`,
      actual: "missing or unreadable",
      ...(observed.error.hint === undefined ? {} : { hint: observed.error.hint }),
      blockedReason: {
        code: "prerequisite-missing",
        message: observed.error.message,
        ...(observed.error.hint === undefined ? {} : { hint: observed.error.hint }),
      },
    };
    const report: ModelReport = {
      schemaVersion: 1,
      command: "model",
      ok: false,
      profile: context.value.profileName,
      profileDir: context.value.profileDir,
      patchPath,
      selection,
      before: null,
      after: null,
      checks: [check],
      credential: null,
      fix: { requested: args.fix, changed: false, written: false, notes: [], error: null },
    };
    return emitReport(args, io, report, EXIT_CODES.blocked);
  }

  const before = observed.value;
  const credential = await observeCredentialPresence(
    ports.fs,
    ports.env,
    context.value.dshHome,
    selection.apiKeyEnv,
  );

  // --fix is the only writer in this command. The real user home is read-only
  // for this tool: an edit to the patch layer there is an edit to the developer's
  // actual install, so refuse before planning it. The check covers containment
  // and links as well as an exact match (see findWriteUnderRealHome): a DSH_HOME
  // below the real home, or a link that lands in it, is still the real home.
  // A dry run writes nothing, so it plans and warns instead of refusing.
  const realHomeHit = args.fix
    ? await findWriteUnderRealHome({
        fs: ports.fs,
        env: ports.env,
        cwd: ports.env.cwd(),
        dshHome: context.value.dshHome,
      })
    : null;
  if (realHomeHit !== null && !args.dryRun) {
    return reject(args, io, "fix", {
      code: "prerequisite",
      message: `refusing to edit the real DSH home ${realHomeHit.realHome}: DSH_HOME ${realHomeHit.value}`,
      hint: "copy the profile into a batch home and set DSH_HOME to that copy, then rerun with --fix",
      details: { dshHome: context.value.dshHome, patchPath, realHome: realHomeHit.realHome },
    });
  }
  if (realHomeHit !== null) {
    io.stderr(
      `dsh-verify model: warning: the target DSH home ${context.value.dshHome} belongs to the real user home ${realHomeHit.realHome}; ` +
        "a real --fix would be refused (the dry run writes nothing)\n",
    );
  }

  if (args.dryRun) {
    const edit = planModelConfigEdit(before.text, selection);
    const editPlan = edit.ok ? { changed: edit.value.changed, notes: edit.value.notes } : { error: edit.error };
    const checks = buildChecks(before.state, selection, credential);
    // A dry run must reach the same conclusion as the real run, and never a fixed
    // 0: without `--fix` that is the rule over the current checks; with `--fix` it
    // is the rule over the checks the planned text would produce (the plan is a
    // pure edit, so the prediction needs no write), including the same refusal or
    // planning-failure check the real path would append.
    let predictedChecks: ModelCheck[] = [...checks];
    if (args.fix) {
      if (!edit.ok) {
        predictedChecks.push(edit.error.code === "prerequisite" ? fixRefusalCheck(edit.error) : fixPlanFailureCheck(edit.error));
      } else {
        predictedChecks = buildChecks(inspectModelConfig(edit.value.text, selection), selection, credential);
      }
    }
    const dryRunExit = exitCodeFor(predictedChecks);
    if (args.json) {
      io.stdout(
        modelPlanJson(
          { profileName: context.value.profileName, profileDir: context.value.profileDir },
          patchPath,
          selection,
          before,
          credential,
          editPlan,
          checks,
          args.fix,
          dryRunExit,
          predictedChecks,
        ),
      );
    } else {
      io.stdout(
        renderModelPlan(
          { profileName: context.value.profileName, profileDir: context.value.profileDir },
          patchPath,
          selection,
          before,
          editPlan,
          checks,
          args.fix,
        ),
      );
    }
    return dryRunExit;
  }

  let checks = buildChecks(before.state, selection, credential);
  let fix: ModelFixReport = {
    requested: args.fix,
    changed: false,
    written: false,
    notes: [],
    error: null,
  };
  let after: ModelConfigState | null = null;
  let stateAfter = before.state;

  if (args.fix && !before.state.configured) {
    const outcome = await fixModelConfig(ports.fs, before, selection);
    fix = {
      requested: true,
      changed: outcome.changed,
      written: outcome.written,
      notes: outcome.notes,
      error: outcome.failure,
    };

    if (outcome.failure !== null && !outcome.written) {
      if (outcome.changed) {
        checks = [...checks, fixWriteFailureCheck(outcome.failure)];
      } else if (outcome.failure.code === "prerequisite") {
        checks = [...checks, fixRefusalCheck(outcome.failure)];
      } else {
        checks = [...checks, fixPlanFailureCheck(outcome.failure)];
      }
    } else if (outcome.written && outcome.after !== null) {
      stateAfter = outcome.after.state;
      after = stateAfter;
      checks = buildChecks(stateAfter, selection, credential);
      const changeNote =
        outcome.notes.length === 0
          ? "nothing to change; no write was made"
          : `wrote ${outcome.notes.length} change(s): ${outcome.notes.join("; ")}`;
      checks = [
        ...checks,
        {
          id: "model-fix",
          status: "pass",
          detail: changeNote,
        },
        stateAfter.configured
          ? {
              id: "model-recheck",
              status: "pass",
              detail: "re-read the written patch layer: every model rule passes",
            }
          : {
              id: "model-recheck",
              status: "fail",
              detail:
                "the patch layer was written, but re-inspection still fails: " +
                checks
                  .filter((item) => item.status === "fail")
                  .map((item) => item.id)
                  .join(", ") +
                " (" +
                stateAfter.problems.map((problem) => problem.code).join(", ") +
                ")",
              expected: "a re-read patch layer that passes every model rule",
              actual: stateAfter.problems.map((problem) => problem.message).join("; "),
              hint: "the file changed but the rules still disagree; review the failing checks and edit the patch entry by hand",
            },
      ];
    } else if (outcome.written) {
      // The write landed but the read-back did not: say so rather than claim success.
      checks = [
        ...checks,
        {
          id: "model-fix",
          status: "pass",
          detail: `wrote ${outcome.notes.length} change(s); the result could not be read back`,
        },
        {
          id: "model-recheck",
          status: "fail",
          detail: "the patch layer was written, but could not be re-read for inspection",
          expected: "the written patch layer re-read and inspected",
          actual: outcome.failure?.message ?? "read-back failed",
          hint: outcome.failure?.hint ?? "inspect the patch file by hand before rerunning",
        },
      ];
    }
  } else if (args.fix) {
    fix = {
      requested: true,
      changed: false,
      written: false,
      notes: ["already conforming; nothing written"],
      error: null,
    };
    checks = [
      ...checks,
      {
        id: "model-fix",
        status: "pass",
        detail: "already conforming; nothing written",
      },
    ];
  }

  const report: ModelReport = {
    schemaVersion: 1,
    command: "model",
    ok: false,
    profile: context.value.profileName,
    profileDir: context.value.profileDir,
    patchPath,
    selection,
    before: before.state,
    after,
    checks,
    credential,
    fix,
  };
  return emitReport(args, io, report, exitCodeFor(checks));
}