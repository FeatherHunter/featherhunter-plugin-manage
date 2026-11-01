/**
 * Scenario loading and execution.
 *
 * The loader is the only place that touches the plugin repository's scenario
 * file. It uses a dynamic `import()` wrapped in `new Function` — the same trick
 * the browser and declaration loaders use — so a bundler cannot statically
 * rewrite the specifier and so an unreadable scenario is a classified failure
 * rather than a stack trace.
 *
 * The runner turns every observation into a normal `CheckResult`. Built-in steps
 * report `source: "builtin"`; a scenario body reports `source: "custom"`. That
 * single field is what lets a reader tell "the tool checked this" from "the
 * plugin checked this" without a second report format.
 */
import { pathToFileURL } from "node:url";

import { CHECK_ID_RE, parseProfileName } from "../contracts/branding";
import type { CheckResult, CheckStatus } from "../contracts/check";
import type { EvidenceItemRef } from "../contracts/evidence-contract";
import type { Ports } from "../contracts/ports";
import type { DshRuntimePaths } from "../contracts/launch-plan";
import { err, failure, ok, type Failure, type Result } from "../contracts/result";
import type { RunState, RunStep } from "../contracts/run-state";
import { stateFromChecks } from "../contracts/run-state";
import type {
  ScenarioDefinition,
  ScenarioObservation,
  ScenarioResult,
  ScenarioStep,
  ScenarioStepResult,
} from "../contracts/scenario";
import { parseScenario, scenarioPassed } from "../contracts/scenario";
import type { ProfileName } from "../contracts/branding";
import type { VerificationProfile } from "../contracts/verification-profile";
import type { EvidenceStore } from "../evidence/store";
import type { BinaryWriter } from "../runtime/platform/binary-writer";
import { joinFsPath, isPosixAbsolute, isWindowsAbsolute, resolveAgainst } from "../runtime/paths";
import { checkId } from "./types";
import type { CheckOutcome } from "./types";
import type { InstanceHandle, PrimitiveCheckResult, Primitives, PageFailure } from "./primitives";
import { checkObservation, createPrimitives, observationToCheck, PRIMITIVE_CHECK_IDS } from "./primitives";
import type { BrowserProbeFactory } from "../contracts/ports";
import type { ReadFileSlice } from "../runtime/types";

export const RUN_COMMAND = "run";
export const DEFAULT_SCENARIO_TIMEOUT_MS = 120_000;
export const MAX_SCENARIO_CONCURRENCY = 32;

export type ScenarioLoadStage = "path" | "import" | "export" | "validate";
export type ScenarioLoadFailure = Failure & { readonly stage: ScenarioLoadStage };

export interface LoadedScenarioFile {
  readonly path: string;
  readonly scenarios: readonly ScenarioDefinition<ScenarioContext>[];
}

export interface ScenarioContext {
  readonly scenarioId: string;
  readonly primitives: Primitives;
  readonly instance: InstanceHandle | null;
  readonly instances: readonly InstanceHandle[];
  readonly evidence: EvidenceStore;
  readonly note: (message: string) => void;
}

export interface ScenarioLoadOptions {
  readonly ports: Ports;
  readonly cwd: string;
  readonly repoRoot: string;
  readonly specifier: string;
  readonly importModule?: (specifier: string) => Promise<unknown>;
}

type ScenarioModule = Readonly<Record<string, unknown>>;

function nativeImport(specifier: string): Promise<unknown> {
  const load = new Function("specifier", "return import(specifier);") as (value: string) => Promise<unknown>;
  return load(specifier);
}

function loadFailure(stage: ScenarioLoadStage, failureValue: Failure): ScenarioLoadFailure {
  return { ...failureValue, stage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeScenario(value: unknown): value is ScenarioDefinition<ScenarioContext> {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && Array.isArray(value.steps);
}

function classifyImportError(error: unknown): ScenarioLoadFailure {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : null;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SyntaxError) {
    return loadFailure("import", failure("invalid-input", `scenario module has a syntax error: ${message}`, "fix the scenario file; it is imported as plain ESM/TypeScript"));
  }
  if (code === "ERR_MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED" || code === "ERR_UNSUPPORTED_DIR_IMPORT") {
    return loadFailure(
      "import",
      failure(
        "prerequisite",
        `scenario module could not be resolved: ${message}`,
        "check the path and that the scenario's imports exist; a scenario may only import this capability through its public entry",
      ),
    );
  }
  if (code === "ERR_UNKNOWN_FILE_EXTENSION" || code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" || code === "ERR_UNKNOWN_MODULE_FORMAT") {
    return loadFailure(
      "import",
      failure(
        "unsupported",
        `this Node runtime cannot import the scenario module: ${message}`,
        "run with a Node version that supports the scenario's extension, or write the scenario as .mjs/.js",
      ),
    );
  }
  return loadFailure("import", failure("invalid-input", `scenario module failed to load: ${message}`, "fix the scenario file and rerun"));
}

function scenarioCandidates(module: ScenarioModule): { name: string; value: unknown }[] {
  const candidates: { name: string; value: unknown }[] = [];
  const push = (name: string, value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => candidates.push({ name: `${name}[${index}]`, value: entry }));
      return;
    }
    candidates.push({ name, value });
  };
  if ("default" in module) push("default", module.default);
  if ("scenarios" in module) push("scenarios", module.scenarios);
  for (const [name, value] of Object.entries(module)) {
    if (name === "default" || name === "scenarios") continue;
    if (looksLikeScenario(value)) push(name, value);
  }
  return candidates;
}

export async function loadScenarioFile(options: ScenarioLoadOptions): Promise<Result<LoadedScenarioFile, ScenarioLoadFailure>> {
  const { ports, cwd, repoRoot, specifier } = options;
  if (specifier.trim().length === 0) {
    return err(loadFailure("path", failure("invalid-input", "scenario path is empty", "pass a .ts/.mjs/.js file")));
  }
  const absolute = isWindowsAbsolute(specifier) || isPosixAbsolute(specifier);
  const bases = absolute ? [""] : [cwd, ...(repoRoot === cwd ? [] : [repoRoot])];
  const extensions = ["", ".ts", ".mjs", ".js"];
  const tried: string[] = [];
  let resolved: string | null = null;
  for (const base of bases) {
    for (const extension of extensions) {
      const candidate = absolute ? specifier + extension : resolveAgainst(base, specifier + extension);
      tried.push(candidate);
      if (await ports.fs.exists(candidate)) {
        resolved = candidate;
        break;
      }
    }
    if (resolved !== null) break;
  }
  if (resolved === null) {
    return err(
      loadFailure(
        "path",
        failure(
          "prerequisite",
          `scenario file not found: ${specifier}`,
          `tried: ${tried.slice(0, 6).join(", ")}${tried.length > 6 ? " …" : ""}`,
        ),
      ),
    );
  }

  let module: unknown;
  try {
    module = await (options.importModule ?? nativeImport)(pathToFileURL(resolved).href);
  } catch (error) {
    return err(classifyImportError(error));
  }
  if (!isRecord(module)) {
    return err(loadFailure("export", failure("invalid-input", `${resolved} did not export a module object`, "export a scenario with defineScenario()")));
  }

  const candidates = scenarioCandidates(module);
  if (candidates.length === 0) {
    return err(
      loadFailure(
        "export",
        failure(
          "invalid-input",
          `${resolved} exports no scenario`,
          "export one with `export default defineScenario({...})`, or export a `scenarios` array",
        ),
      ),
    );
  }

  const byId = new Map<string, { readonly name: string; readonly value: ScenarioDefinition<ScenarioContext> }>();
  for (const candidate of candidates) {
    if (!looksLikeScenario(candidate.value)) {
      return err(
        loadFailure(
          "export",
          failure(
            "invalid-input",
            `${resolved} export ${candidate.name} is not a scenario`,
            "a scenario needs id, title and steps; use defineScenario() so this is checked where it is written",
          ),
        ),
      );
    }
    const parsed = parseScenario(candidate.value);
    if (!parsed.ok) {
      return err(loadFailure("validate", failure(parsed.error.code, `${candidate.name}: ${parsed.error.message}`, parsed.error.hint)));
    }
    const existing = byId.get(parsed.value.id);
    if (existing !== undefined) {
      if (existing.value === parsed.value) continue;
      return err(
        loadFailure(
          "validate",
          failure(
            "invalid-input",
            `scenario id ${parsed.value.id} is exported twice (${existing.name} and ${candidate.name})`,
            "give each scenario in the file a unique id",
          ),
        ),
      );
    }
    byId.set(parsed.value.id, { name: candidate.name, value: parsed.value });
  }

  return ok({ path: resolved, scenarios: [...byId.values()].map((entry) => entry.value) });
}

/* ------------------------------------------------------------------ runner */

export interface ScenarioRunOptions {
  readonly ports: Ports;
  readonly runtime: { readonly nodeVersion: string; readonly readFileSlice: ReadFileSlice | null };
  readonly runtimePaths: DshRuntimePaths;
  readonly dshHome: string;
  readonly workRoot: string;
  readonly repoRoot: string;
  readonly profileName: ProfileName;
  readonly profile: VerificationProfile;
  readonly profileDir: string;
  readonly evidence: EvidenceStore;
  readonly binaryWriter?: BinaryWriter;
  readonly adapter?: BrowserProbeFactory | null;
  readonly importModule?: (specifier: string) => Promise<unknown>;
  readonly npmCommand?: string;
  readonly headless?: boolean;
  readonly note?: (message: string) => void;
  /** Default 1; clamped to 1..MAX_SCENARIO_CONCURRENCY. */
  readonly concurrency?: number;
  /** Stop each scenario at its first failing step. */
  readonly failFast?: boolean;
}

export interface ScenarioRunOutcome {
  readonly scenarios: readonly ScenarioResult[];
  readonly checks: readonly CheckResult[];
  readonly steps: readonly RunStep[];
  readonly notes: readonly string[];
  readonly state: RunState;
  readonly exitCode: 0 | 1 | 2;
}

interface ScenarioRunOne {
  readonly result: ScenarioResult;
  readonly checks: readonly CheckResult[];
  readonly steps: readonly RunStep[];
  readonly cleanupCheck: CheckResult | null;
}

function stepSource(step: ScenarioStep<ScenarioContext>): "builtin" | "custom" {
  return step.kind === "custom" ? "custom" : "builtin";
}

function failureObservation(
  step: ScenarioStep<ScenarioContext>,
  detail: string,
  options: { expected?: string; actual?: string; hint?: string; status?: CheckStatus; source?: "builtin" | "custom" } = {},
): ScenarioObservation {
  const status = options.status ?? "fail";
  return {
    checkId: step.id,
    title: step.title,
    ok: status === "pass" || status === "skip",
    status,
    detail,
    ...(options.expected === undefined ? {} : { expected: options.expected }),
    ...(options.actual === undefined ? {} : { actual: options.actual }),
    ...(options.hint === undefined ? {} : { hint: options.hint }),
    source: options.source ?? stepSource(step),
  };
}

function paramsRecord(step: ScenarioStep<ScenarioContext>): Record<string, unknown> {
  return step.params ?? {};
}

function unknownParams(step: ScenarioStep<ScenarioContext>, allowed: readonly string[]): ScenarioObservation | null {
  const unknown = Object.keys(paramsRecord(step)).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return null;
  return failureObservation(step, `step ${step.id} has unknown param(s): ${unknown.join(", ")}`, {
    expected: `params from: ${allowed.join(", ") || "(none)"}`,
    actual: unknown.join(", "),
    hint: "remove the typo; built-in steps validate their parameters",
  });
}

function stringParam(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function numberParam(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function booleanParam(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function instanceFailureObservation(
  step: ScenarioStep<ScenarioContext>,
  error: Failure & { readonly stage?: string },
): ScenarioObservation {
  const blocked = error.stage === "prerequisite";
  return failureObservation(step, error.message, {
    expected: "the instance reaches the ready line",
    actual: error.message,
    hint: error.hint ?? "read the launch logs and fix the prerequisite, then rerun",
    status: blocked ? "blocked" : "fail",
  });
}

function installFailureObservation(step: ScenarioStep<ScenarioContext>, error: Failure): ScenarioObservation {
  const blocked = error.code === "prerequisite" || error.code === "unsupported";
  return failureObservation(step, error.message, {
    expected: "the candidate installs into the isolated profile",
    actual: error.message,
    hint: error.hint ?? "fix the tarball or profile, then rerun",
    status: blocked ? "blocked" : "fail",
  });
}

function checkToObservation(step: ScenarioStep<ScenarioContext>, result: PrimitiveCheckResult, hard = true): ScenarioObservation {
  return checkObservation(result, { hard });
}

function checkResultToObservation(step: ScenarioStep<ScenarioContext>, check: CheckResult): ScenarioObservation {
  return {
    checkId: check.id,
    title: check.title,
    ok: check.status === "pass" || check.status === "skip",
    status: check.status,
    detail: check.detail,
    ...(check.expected === undefined ? {} : { expected: check.expected }),
    ...(check.actual === undefined ? {} : { actual: check.actual }),
    ...(check.hint === undefined ? {} : { hint: check.hint }),
    source: check.source ?? "builtin",
    hard: check.hard,
  };
}

function normalizeCustomObservation(step: ScenarioStep<ScenarioContext>, value: unknown): ScenarioObservation {
  if (!isRecord(value)) {
    return failureObservation(step, "custom step returned a non-object observation", {
      expected: "ScenarioObservation objects",
      actual: JSON.stringify(value),
      hint: "return [{ ok, detail }] from run()",
    });
  }
  const detail = typeof value.detail === "string" ? value.detail : "custom observation has no detail";
  const ok = typeof value.ok === "boolean" ? value.ok : false;
  const status = typeof value.status === "string" ? (value.status as CheckStatus) : undefined;
  if (status !== undefined && !["pass", "fail", "skip", "blocked"].includes(status)) {
    return failureObservation(step, `custom observation has unknown status ${JSON.stringify(status)}`, {
      expected: "pass, fail, skip or blocked",
      actual: status,
      hint: "use one of the four CheckStatus values",
    });
  }
  const checkIdValue = typeof value.checkId === "string" ? value.checkId : undefined;
  if (checkIdValue !== undefined && !CHECK_ID_RE.test(checkIdValue)) {
    return failureObservation(step, `custom observation checkId ${JSON.stringify(checkIdValue)} is not a check id`, {
      expected: "lowercase kebab-case, e.g. dock-below-360",
      actual: checkIdValue,
      hint: "check ids use the same rule as built-in ids: [a-z][a-z0-9-]{1,63}",
    });
  }
  const effectiveStatus: CheckStatus = status ?? (ok ? "pass" : "fail");
  const effectiveOk = ok && effectiveStatus !== "fail" && effectiveStatus !== "blocked";
  return {
    ...(checkIdValue === undefined ? {} : { checkId: checkIdValue }),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ok: effectiveOk,
    status: effectiveStatus,
    detail,
    ...(typeof value.expected === "string" ? { expected: value.expected } : {}),
    ...(typeof value.actual === "string" ? { actual: value.actual } : {}),
    ...(typeof value.hint === "string" ? { hint: value.hint } : {}),
    ...(Array.isArray(value.evidence) ? { evidence: value.evidence.filter((entry): entry is string => typeof entry === "string") } : {}),
    ...(typeof value.hard === "boolean" ? { hard: value.hard } : {}),
    // A custom step is always custom: letting it claim "builtin" would erase the
    // one field the report uses to separate plugin checks from core checks.
    source: "custom",
  };
}

function observationsFrom(value: unknown, step: ScenarioStep<ScenarioContext>): ScenarioObservation[] {
  if (!Array.isArray(value)) {
    return [
      failureObservation(step, "custom step run() did not return an array", {
        expected: "readonly ScenarioObservation[]",
        actual: typeof value,
        hint: "return an array, even when it holds one observation",
      }),
    ];
  }
  return value.map((entry) => normalizeCustomObservation(step, entry));
}

async function executeStep(
  step: ScenarioStep<ScenarioContext>,
  context: ScenarioContext,
  definition: ScenarioDefinition<ScenarioContext>,
): Promise<ScenarioObservation[]> {
  const { primitives } = context;
  switch (step.kind) {
    case "launch": {
      const unknown = unknownParams(step, ["port", "keep", "readyTimeoutMs"]);
      if (unknown !== null) return [unknown];
      const params = paramsRecord(step);
      const port = params.port === undefined ? undefined : numberParam(params, "port");
      if (params.port !== undefined && (port === null || port === undefined || port < 0 || port > 65535)) {
        return [failureObservation(step, "launch port must be an integer between 0 and 65535", {
          expected: "0..65535",
          actual: String(params.port),
          hint: "omit --port to let DSH choose one",
        })];
      }
      const keep = params.keep === undefined ? false : booleanParam(params, "keep");
      if (keep === null) {
        return [failureObservation(step, "launch keep must be a boolean", { expected: "true or false", actual: String(params.keep), hint: "drop keep to default to false" })];
      }
      const readyTimeoutMs = params.readyTimeoutMs === undefined ? undefined : numberParam(params, "readyTimeoutMs");
      if (params.readyTimeoutMs !== undefined && (readyTimeoutMs === null || readyTimeoutMs === undefined || readyTimeoutMs <= 0)) {
        return [failureObservation(step, "launch readyTimeoutMs must be a positive integer", { expected: "positive integer", actual: String(params.readyTimeoutMs), hint: "drop readyTimeoutMs to use the launch default" })];
      }
      const launched = await primitives.launch({
        ...(port === null || port === undefined ? {} : { port }),
        keep,
        ...(readyTimeoutMs === null || readyTimeoutMs === undefined ? {} : { readyTimeoutMs }),
        ...(definition.hooks?.beforeLaunch === undefined
          ? {}
          : { beforeLaunch: (info: { home: string; dir: string; profile: string }) => definition.hooks?.beforeLaunch?.(context, info) }),
        ...(definition.hooks?.afterLaunch === undefined
          ? {}
          : { afterLaunch: (handle: InstanceHandle) => definition.hooks?.afterLaunch?.(context, { instance: handle }) }),
      });
      if (!launched.ok) return [instanceFailureObservation(step, launched.error)];
      return [
        {
          checkId: step.id,
          title: step.title,
          ok: true,
          status: "pass",
          detail: `instance ${launched.value.record.instanceId ?? launched.value.pid} is ready at ${launched.value.record.originUrl} (pid ${launched.value.pid})`,
          source: "builtin",
        },
      ];
    }

    case "stop": {
      const unknown = unknownParams(step, ["id"]);
      if (unknown !== null) return [unknown];
      const id = stringParam(paramsRecord(step), "id") ?? undefined;
      const stopped = await primitives.stop(id);
      if (!stopped.ok) {
        return [failureObservation(step, stopped.error.message, { expected: "the instance stops", actual: stopped.error.message, hint: stopped.error.hint })];
      }
      return [
        {
          checkId: step.id,
          title: step.title,
          ok: true,
          status: "pass",
          detail: `stopped ${stopped.value.length} instance(s)`,
          source: "builtin",
        },
      ];
    }

    case "logs": {
      const unknown = unknownParams(step, ["id", "bytes"]);
      if (unknown !== null) return [unknown];
      const params = paramsRecord(step);
      const id = stringParam(params, "id") ?? undefined;
      const bytes = params.bytes === undefined ? 4000 : numberParam(params, "bytes");
      if (bytes === null || bytes <= 0) {
        return [failureObservation(step, "logs bytes must be a positive integer", { expected: "positive integer", actual: String(params.bytes), hint: "omit bytes to read the last 4000 bytes" })];
      }
      const logs = await primitives.logs(id, bytes);
      if (!logs.ok) {
        return [failureObservation(step, logs.error.message, { expected: "stdout/stderr log files", actual: logs.error.message, hint: logs.error.hint })];
      }
      if (!logs.value.readable) {
        return [failureObservation(step, "instance log files are missing", {
          expected: `${logs.value.stdoutPath} and ${logs.value.stderrPath}`,
          actual: "one or both files are absent",
          hint: "the instance may have been stopped and its directory cleaned; read logs before stop",
        })];
      }
      return [
        {
          checkId: step.id,
          title: step.title,
          ok: true,
          status: "pass",
          detail: `read ${bytes} bytes from stdout/stderr (pid ${logs.value.pid}, alive: ${logs.value.alive})`,
          source: "builtin",
        },
      ];
    }

    case "model": {
      const unknown = unknownParams(step, []);
      if (unknown !== null) return [unknown];
      const model = await primitives.model();
      if (!model.ok) {
        return [failureObservation(step, model.error.message, {
          expected: "a readable profile patch layer",
          actual: model.error.message,
          hint: model.error.hint,
          status: model.error.code === "prerequisite" ? "blocked" : "fail",
        })];
      }
      if (model.value.selection === false) {
        return [{ checkId: step.id, title: step.title, ok: true, status: "skip", detail: "profile declares model: false", source: "builtin" }];
      }
      if (!model.value.configured) {
        return [failureObservation(step, "the profile does not configure the declared model", {
          expected: `${model.value.selection.provider}/${model.value.selection.model}`,
          actual: model.value.observation?.state.problems?.map((problem) => problem.code).join(", ") ?? "not configured",
          hint: "run dsh-verify model --fix against this profile, then rerun",
        })];
      }
      return [
        {
          checkId: step.id,
          title: step.title,
          ok: true,
          status: "pass",
          detail: `${model.value.selection.provider}/${model.value.selection.model} is configured; credential ${model.value.credential?.available === true ? `present via ${model.value.credential.source}` : "not observed"}`,
          source: "builtin",
        },
      ];
    }

    case "install": {
      const unknown = unknownParams(step, ["tgz", "method", "candidate"]);
      if (unknown !== null) return [unknown];
      const params = paramsRecord(step);
      const tgz = stringParam(params, "tgz");
      if (tgz === null || tgz.length === 0) {
        return [failureObservation(step, "install requires a tgz path", { expected: "params.tgz", actual: String(params.tgz), hint: "pass the candidate .tgz" })];
      }
      const method = params.method === undefined ? "extract" : stringParam(params, "method");
      if (method !== "extract" && method !== "cli") {
        return [failureObservation(step, "install method must be extract or cli", { expected: "extract | cli", actual: String(params.method), hint: "omit method to default to extract" })];
      }
      const candidate = params.candidate === undefined ? null : stringParam(params, "candidate");
      if (params.candidate !== undefined && candidate === null) {
        return [failureObservation(step, "install candidate must be a path", { expected: "a candidate directory or candidate.json", actual: String(params.candidate), hint: "omit candidate to verify against the tarball" })];
      }
      const installed = await primitives.install({ tgz, method, candidate });
      if (!installed.ok) return [installFailureObservation(step, installed.error)];
      return installed.value.checks.map((check) => checkResultToObservation(step, check));
    }

    case "skills": {
      const unknown = unknownParams(step, []);
      if (unknown !== null) return [unknown];
      const skills = await primitives.skills();
      if (!skills.ok) {
        return [failureObservation(step, skills.error.message, { expected: "the skills-set check runs", actual: skills.error.message, hint: skills.error.hint })];
      }
      return [checkToObservation(step, skills.value)];
    }

    case "check": {
      const unknown = unknownParams(step, ["check", "hard"]);
      if (unknown !== null) return [unknown];
      const params = paramsRecord(step);
      const name = stringParam(params, "check");
      if (name === null || !(PRIMITIVE_CHECK_IDS as readonly string[]).includes(name)) {
        return [failureObservation(step, `unknown built-in check ${JSON.stringify(params.check)}`, {
          expected: PRIMITIVE_CHECK_IDS.join(", "),
          actual: String(params.check),
          hint: "use one of the built-in check ids",
        })];
      }
      const hard = params.hard === undefined ? true : booleanParam(params, "hard");
      if (hard === null) {
        return [failureObservation(step, "check hard must be a boolean", { expected: "true or false", actual: String(params.hard), hint: "omit hard to default to true" })];
      }
      const checked = await primitives.check(name as (typeof PRIMITIVE_CHECK_IDS)[number]);
      if (!checked.ok) {
        return [failureObservation(step, checked.error.message, { expected: "the built-in check runs", actual: checked.error.message, hint: checked.error.hint })];
      }
      return [checkToObservation(step, checked.value, hard)];
    }

    case "evidence": {
      const unknown = unknownParams(step, ["name", "text", "json", "kind", "note"]);
      if (unknown !== null) return [unknown];
      const params = paramsRecord(step);
      const name = stringParam(params, "name");
      if (name === null || name.length === 0) {
        return [failureObservation(step, "evidence requires a name", { expected: "params.name", actual: String(params.name), hint: "pass a stable evidence stem" })];
      }
      if (params.text !== undefined && params.json !== undefined) {
        return [failureObservation(step, "evidence takes text or json, not both", { expected: "one of text/json", actual: "both", hint: "drop one of them" })];
      }
      const kind = params.kind === undefined ? undefined : stringParam(params, "kind");
      const note = params.note === undefined ? undefined : stringParam(params, "note");
      const recorded = await primitives.evidence(
        name,
        params.json !== undefined ? params.json : params.text,
        {
          ...(params.json === undefined ? {} : { json: true }),
          ...(kind === null || kind === undefined ? {} : { kind: kind as never }),
          ...(note === null || note === undefined ? {} : { note }),
        },
      );
      if (!recorded.ok) {
        return [failureObservation(step, recorded.error.message, { expected: "the evidence item is recorded", actual: recorded.error.message, hint: recorded.error.hint })];
      }
      return [{
        checkId: step.id,
        title: step.title,
        ok: true,
        status: "pass",
        detail: `recorded evidence ${recorded.value.path}`,
        evidence: [recorded.value.path],
        source: "builtin",
      }];
    }

    case "sleep": {
      const unknown = unknownParams(step, ["ms"]);
      if (unknown !== null) return [unknown];
      const ms = numberParam(paramsRecord(step), "ms");
      if (ms === null || ms < 0) {
        return [failureObservation(step, "sleep requires a non-negative integer ms", { expected: "ms >= 0", actual: String(paramsRecord(step).ms), hint: "pass params: { ms: 500 }" })];
      }
      await primitives.sleep(ms);
      return [{ checkId: step.id, title: step.title, ok: true, status: "pass", detail: `slept ${ms}ms`, source: "builtin" }];
    }

    case "custom": {
      if (step.run === undefined) {
        return [failureObservation(step, "custom step has no run()", { expected: "run()", actual: "missing", hint: "define the step with kind custom and a body" })];
      }
      try {
        return observationsFrom(await step.run(context), step);
      } catch (error) {
        return [failureObservation(step, `custom step threw: ${error instanceof Error ? error.message : String(error)}`, {
          expected: "run() returns observations",
          actual: error instanceof Error ? error.message : String(error),
          hint: "catch expected errors inside the scenario and return an observation instead",
        })];
      }
    }
  }
}

function stepFailed(observations: readonly ScenarioObservation[]): boolean {
  return observations.some(
    (observation) => observation.ok === false || observation.status === "fail" || observation.status === "blocked",
  );
}

function skippedObservation(step: ScenarioStep<ScenarioContext>, reason: string): ScenarioObservation {
  return {
    checkId: step.id,
    title: step.title,
    ok: true,
    status: "skip",
    detail: reason,
    source: stepSource(step),
  };
}

function evidenceResolver(store: EvidenceStore): (paths: readonly string[]) => EvidenceItemRef[] {
  const items = store.items();
  return (paths) =>
    paths.flatMap((path) => {
      const found = items.find(
        (item) => item.path === path || item.path.endsWith(`/${path}`) || item.path.endsWith(`\\${path}`),
      );
      return found === undefined ? [] : [{ path: found.path, sha256: found.sha256, kind: found.kind }];
    });
}

async function runOne(
  definition: ScenarioDefinition<ScenarioContext>,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOne> {
  const note = options.note ?? (() => undefined);
  const prefix = `scenario ${definition.id}`;
  const primitives = createPrimitives({
    ports: options.ports,
    runtime: options.runtime,
    runtimePaths: options.runtimePaths,
    dshHome: options.dshHome,
    workRoot: options.workRoot,
    repoRoot: options.repoRoot,
    profileName: options.profileName,
    profile: options.profile,
    profileDir: options.profileDir,
    evidence: options.evidence,
    note: (message) => note(`${prefix}: ${message}`),
    ...(options.binaryWriter === undefined ? {} : { binaryWriter: options.binaryWriter }),
    ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
    ...(options.importModule === undefined ? {} : { importModule: options.importModule }),
    ...(options.npmCommand === undefined ? {} : { npmCommand: options.npmCommand }),
    ...(options.headless === undefined ? {} : { headless: options.headless }),
  });

  const context = (): ScenarioContext => ({
    scenarioId: definition.id,
    primitives,
    instance: primitives.lastInstance(),
    instances: primitives.instances(),
    evidence: options.evidence,
    note,
  });

  const stepResults: ScenarioStepResult[] = [];
  const runSteps: RunStep[] = [];
  let stopped = false;

  for (const step of definition.steps) {
    const startedAt = options.ports.clock.nowMs();
    const startedIso = options.ports.clock.iso(startedAt);
    if (stopped) {
      const observations = [skippedObservation(step, `not run: --fail-fast stopped after the first failing step`)];
      stepResults.push({ stepId: step.id, title: step.title, state: "skipped", observations, durationMs: 0 });
      runSteps.push({ id: step.id, title: step.title, startedAt: startedIso, finishedAt: startedIso, state: "skipped", detail: "not run: --fail-fast" });
      continue;
    }

    const current = context();
    if (step.skipWhen !== undefined) {
      let skip = false;
      try {
        skip = await step.skipWhen(current);
      } catch (error) {
        const observations = [failureObservation(step, `skipWhen threw: ${error instanceof Error ? error.message : String(error)}`, {
          expected: "skipWhen returns a boolean",
          actual: error instanceof Error ? error.message : String(error),
          hint: "fix the predicate; a throwing predicate is a failed step, not a skip",
        })];
        const finishedAt = options.ports.clock.nowMs();
        stepResults.push({ stepId: step.id, title: step.title, state: "failed", observations, durationMs: finishedAt - startedAt });
        runSteps.push({ id: step.id, title: step.title, startedAt: startedIso, finishedAt: options.ports.clock.iso(finishedAt), state: "failed", detail: observations[0]?.detail });
        if (options.failFast === true) stopped = true;
        continue;
      }
      if (skip) {
        const observations = [skippedObservation(step, "skipWhen returned true")];
        const finishedAt = options.ports.clock.nowMs();
        stepResults.push({ stepId: step.id, title: step.title, state: "skipped", observations, durationMs: finishedAt - startedAt });
        runSteps.push({ id: step.id, title: step.title, startedAt: startedIso, finishedAt: options.ports.clock.iso(finishedAt), state: "skipped", detail: "skipWhen returned true" });
        continue;
      }
    }

    let observations: ScenarioObservation[];
    try {
      observations = await executeStep(step, current, definition);
    } catch (error) {
      observations = [failureObservation(step, `step threw: ${error instanceof Error ? error.message : String(error)}`, {
        expected: "the step returns observations",
        actual: error instanceof Error ? error.message : String(error),
        hint: "this is a bug in the step; report it with the scenario file",
      })];
    }
    const finishedAt = options.ports.clock.nowMs();
    const failed = stepFailed(observations);
    stepResults.push({
      stepId: step.id,
      title: step.title,
      state: failed ? "failed" : "done",
      observations,
      durationMs: finishedAt - startedAt,
    });
    runSteps.push({
      id: step.id,
      title: step.title,
      startedAt: startedIso,
      finishedAt: options.ports.clock.iso(finishedAt),
      state: failed ? "failed" : "done",
      ...(failed ? { detail: observations.find((observation) => observation.ok === false)?.detail ?? "step failed" } : {}),
    });
    if (failed && options.failFast === true) stopped = true;
  }

  const checks: CheckResult[] = [];
  const refs = evidenceResolver(options.evidence);
  for (const stepResult of stepResults) {
    stepResult.observations.forEach((observation, index) => {
      checks.push(
        observationToCheck(
          observation,
          { id: stepResult.stepId, title: stepResult.title, source: stepResult.observations[0]?.source ?? "builtin" },
          index,
          refs,
        ),
      );
    });
    if (stepResult.state === "failed" && stepResult.observations.length === 0) {
      checks.push({
        id: checkId(stepResult.stepId),
        title: stepResult.title,
        hard: true,
        status: "fail",
        detail: "step failed without an observation",
        expected: "at least one observation",
        actual: "none",
        hint: "this is a bug in the runner or the step",
        evidence: [],
        durationMs: 0,
        source: "custom",
      });
    }
  }

  const disposed = await primitives.dispose();
  let cleanupCheck: CheckResult | null = null;
  if (!disposed.ok) {
    cleanupCheck = {
      id: checkId("teardown-clean"),
      title: "scenario teardown leaves no process",
      hard: true,
      status: "blocked",
      detail: `could not stop every instance: ${disposed.error.message}`,
      hint: disposed.error.hint ?? "run dsh-verify cleanup and stop the residual process",
      evidence: [],
      durationMs: 0,
      source: "builtin",
    };
  }

  const result: ScenarioResult = {
    scenarioId: definition.id,
    title: definition.title,
    ok: scenarioPassed(stepResults),
    steps: stepResults,
  };
  return { result, checks, steps: runSteps, cleanupCheck };
}

export async function runScenarios(
  definitions: readonly ScenarioDefinition<ScenarioContext>[],
  options: ScenarioRunOptions,
): Promise<Result<ScenarioRunOutcome, Failure>> {
  const note = options.note ?? (() => undefined);
  const concurrency = Math.max(1, Math.min(MAX_SCENARIO_CONCURRENCY, options.concurrency ?? 1));
  if (definitions.length === 0) {
    return err(failure("invalid-input", "no scenarios to run", "export at least one scenario from the file"));
  }
  for (const definition of definitions) {
    if (definition.profile !== undefined) {
      const parsed = parseProfileName(definition.profile);
      if (!parsed.ok) {
        return err(failure("invalid-input", `scenario ${definition.id} has an invalid profile ${JSON.stringify(definition.profile)}`, "profile names are lowercase kebab-case"));
      }
      if (parsed.value !== options.profileName) {
        return err(
          failure(
            "invalid-input",
            `scenario ${definition.id} targets profile ${parsed.value}, but this run loaded ${options.profileName}`,
            `rerun with --profile ${parsed.value}; one run loads one profile`,
          ),
        );
      }
    }
  }

  const ordered: (ScenarioRunOne | undefined)[] = new Array(definitions.length).fill(undefined);
  let next = 0;
  let stopScheduling = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopScheduling) return;
      const index = next;
      next += 1;
      if (index >= definitions.length) return;
      const definition = definitions[index];
      if (definition === undefined) return;
      note(`${definition.id}: starting`);
      const entry = await runOne(definition, options);
      ordered[index] = entry;
      if (options.failFast === true && entry.checks.some((check) => check.status === "fail" || check.status === "blocked")) {
        stopScheduling = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, definitions.length) }, () => worker()));

  const scenarios: ScenarioResult[] = [];
  const checks: CheckResult[] = [];
  const steps: RunStep[] = [];
  for (const entry of ordered) {
    if (entry === undefined) continue;
    scenarios.push(entry.result);
    checks.push(...entry.checks);
    steps.push(...entry.steps);
    if (entry.cleanupCheck !== null) checks.push(entry.cleanupCheck);
  }
  const derived = stateFromChecks(checks);
  const skippedScenarios = definitions.length - scenarios.length;
  return ok({
    scenarios,
    checks,
    steps,
    notes:
      skippedScenarios > 0
        ? [`--fail-fast stopped scheduling after the first failing scenario; ${skippedScenarios} of ${definitions.length} scenario(s) were not run`]
        : [],
    state: derived.state,
    exitCode: derived.exitCode,
  });
}

/** Build the one-line human summary the CLI prints for a scenario result. */
export function describeScenarioResult(result: ScenarioResult): string {
  const failed = result.steps.filter((step) => step.state === "failed").length;
  const skipped = result.steps.filter((step) => step.state === "skipped").length;
  return `${result.scenarioId}: ${result.ok ? "passed" : "failed"} — ${result.steps.length} step(s), ${failed} failed, ${skipped} skipped`;
}
