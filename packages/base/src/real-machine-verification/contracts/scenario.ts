/**
 * Scenario contract: the escape hatch that keeps the built-in commands from
 * becoming a ceiling.
 *
 * The tool ships a fixed set of L1 commands (self-check, single-instance,
 * concurrent, freeze, batch, run). Those cover the common cases, but a plugin
 * will eventually need a claim nobody anticipated — "the narrow-window layout
 * keeps the dock below 360px", "the first-run dialog closes on the primary
 * screen". Requiring a new base command for each of those is how the old
 * per-repository scripts drifted; requiring a full DSL for them is how the tool
 * becomes a language nobody can debug.
 *
 * A scenario is therefore plain TypeScript that the *plugin repository* writes,
 * importing the primitives from this package. The tool loads it, runs the steps,
 * collects observations and evidence, and reports them exactly like built-in
 * checks. Nothing here knows what the scenario means.
 *
 * Two rules keep scenarios honest:
 *
 * - an observation is falsifiable — it says what it expected and what it saw;
 * - a scenario may not invent evidence: files it wants kept are handed to the
 *   evidence collector, not written wherever it likes.
 */
import { err, ok, type Result } from "./result";

/** What one scenario step observed. */
export interface ScenarioObservation {
  /** Defaults to the step id when omitted. */
  readonly checkId?: string;
  readonly ok: boolean;
  /** One sentence: what was observed. */
  readonly detail: string;
  /** What the claim required. */
  readonly expected?: string;
  /** What actually happened. */
  readonly actual?: string;
  /** What to do about a failure. */
  readonly hint?: string;
  /** Paths (inside the batch evidence directory) the runner should keep. */
  readonly evidence?: readonly string[];
}

/** Kinds the runner understands; `custom` is the only one whose body the scenario owns. */
export type ScenarioStepKind = "check" | "launch" | "stop" | "custom" | "sleep";

/** One step. Built-in kinds are executed from their parameters; `custom` runs the function. */
export interface ScenarioStep<TContext = unknown> {
  readonly id: string;
  readonly title: string;
  readonly kind: ScenarioStepKind;
  /** Only for `custom` steps. Required for `custom`, forbidden otherwise. */
  readonly run?: (context: TContext) => Promise<readonly ScenarioObservation[]> | readonly ScenarioObservation[];
  /** Milliseconds before the step is failed as hung. Defaults to the run timeout. */
  readonly timeoutMs?: number;
  /** Return true to skip this step and record it as skipped. */
  readonly skipWhen?: (context: TContext) => boolean | Promise<boolean>;
}

/** What a plugin repository writes in `verify/scenarios/<id>.ts`. */
export interface ScenarioDefinition<TContext = unknown> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Profile to use; defaults to the run's profile so a scenario is portable. */
  readonly profile?: string;
  readonly steps: readonly ScenarioStep<TContext>[];
  readonly notes?: readonly string[];
}

const SCENARIO_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
const STEP_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;

function invalid(message: string, hint?: string): Result<never> {
  return err({ code: "invalid-input", message, ...(hint === undefined ? {} : { hint }) });
}

/** Validate a scenario definition. Throws for the common case of a scenario file. */
export function defineScenario<TContext>(definition: ScenarioDefinition<TContext>): ScenarioDefinition<TContext> {
  const parsed = parseScenario(definition);
  if (!parsed.ok) throw new Error(`scenario ${JSON.stringify(definition.id)} is invalid: ${parsed.error.message}`);
  return parsed.value;
}

/** Non-throwing variant for definitions loaded across a boundary. */
export function parseScenario<TContext>(definition: ScenarioDefinition<TContext>): Result<ScenarioDefinition<TContext>> {
  if (typeof definition !== "object" || definition === null) {
    return invalid("scenario must be an object");
  }
  if (typeof definition.id !== "string" || !SCENARIO_ID_RE.test(definition.id)) {
    return invalid(`scenario id ${JSON.stringify(definition.id)} must be lowercase kebab-case`);
  }
  if (typeof definition.title !== "string" || definition.title.trim().length === 0) {
    return invalid(`scenario ${definition.id} needs a title`);
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    return invalid(`scenario ${definition.id} needs at least one step`);
  }
  const seen = new Set<string>();
  for (const step of definition.steps) {
    if (typeof step.id !== "string" || !STEP_ID_RE.test(step.id)) {
      return invalid(`scenario ${definition.id}: step id ${JSON.stringify(step.id)} must be lowercase kebab-case`);
    }
    if (seen.has(step.id)) {
      return invalid(`scenario ${definition.id}: step id ${step.id} is duplicated`);
    }
    seen.add(step.id);
    if (typeof step.title !== "string" || step.title.trim().length === 0) {
      return invalid(`scenario ${definition.id}: step ${step.id} needs a title`);
    }
    if (step.kind === "custom" && typeof step.run !== "function") {
      return invalid(`scenario ${definition.id}: custom step ${step.id} must provide run()`);
    }
    if (step.kind !== "custom" && step.run !== undefined) {
      return invalid(
        `scenario ${definition.id}: step ${step.id} is ${step.kind} but provides run(); use kind "custom" or drop run`,
        "built-in steps are executed by the runner, so a body on them is silently ignored — which hides mistakes",
      );
    }
    if (step.timeoutMs !== undefined && (!Number.isInteger(step.timeoutMs) || step.timeoutMs <= 0)) {
      return invalid(`scenario ${definition.id}: step ${step.id} timeoutMs must be a positive integer`);
    }
  }
  return ok({
    ...definition,
    steps: [...definition.steps],
    ...(definition.notes === undefined ? {} : { notes: [...definition.notes] }),
  });
}

/** Per-step outcome in a scenario run. */
export interface ScenarioStepResult {
  readonly stepId: string;
  readonly title: string;
  readonly state: "done" | "failed" | "skipped";
  readonly observations: readonly ScenarioObservation[];
  readonly durationMs: number;
}

/** The result of running one scenario. */
export interface ScenarioResult {
  readonly scenarioId: string;
  readonly title: string;
  readonly ok: boolean;
  readonly steps: readonly ScenarioStepResult[];
}

/** True when every step ran and all its observations were ok. */
export function scenarioPassed(steps: readonly ScenarioStepResult[]): boolean {
  return steps.every((step) => step.state === "done" && step.observations.every((observation) => observation.ok));
}

/** One-line description for `dsh-verify describe` and for the README example. */
export function describeScenario(definition: ScenarioDefinition<unknown>): string {
  const kinds = definition.steps.map((step) => `${step.id}(${step.kind})`).join(", ");
  return `${definition.id}: ${definition.title} — ${definition.steps.length} step(s): ${kinds}`;
}
