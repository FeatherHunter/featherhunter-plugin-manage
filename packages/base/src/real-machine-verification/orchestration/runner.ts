/**
 * Executing a plan: the only place that decides a check's status for the machine.
 *
 * Two behaviours keep a green report honest:
 *
 * 1. **Capability gating.** A check that requires an adapter the machine does not
 *    have never runs; the plan's `onMissing` decides between `blocked` and
 *    `skip`. A checked plan can therefore be reused on a headless CI machine
 *    without every optional check turning red.
 * 2. **Crash containment.** A throwing check (including plugin-supplied custom
 *    checks) becomes a `fail` with the thrown sentence in `actual`, not an
 *    unhandled rejection that kills the run and loses the other observations.
 */
import type { CheckResult } from "../contracts/check";
import type { ClockPort, Ports } from "../contracts/ports";
import type { RunStep } from "../contracts/run-state";
import type { CheckModule, CheckOutcome, CheckPlan, OptionalCapability } from "./types";
import { failed, normalizeOutcome, toCheckResult } from "./types";

/** Default capability detection: does this port aggregate expose the thing? */
export function capabilityAvailable(ports: Ports, capability: OptionalCapability): boolean {
  switch (capability) {
    case "browser":
      return ports.browser !== null && ports.browser !== undefined;
    case "screen":
      return ports.screen !== null && ports.screen !== undefined;
    case "command":
      return ports.command !== null && ports.command !== undefined;
    case "process":
      return ports.process !== null && ports.process !== undefined;
    case "http":
      return ports.http !== null && ports.http !== undefined;
    case "read-file-slice":
      // Not a port: the runtime fact is injected separately, so the caller says.
      return false;
  }
}

export interface ExecutePlanOptions {
  /** The machine the plan runs against; capability gating reads it. */
  readonly ports: Ports;
  readonly clock: ClockPort;
  readonly note?: (message: string) => void;
  /** Explicit capability overrides; defaults to what the ports expose. */
  readonly capabilities?: Readonly<Partial<Record<OptionalCapability, boolean>>>;
}

export interface ExecutePlanOutcome {
  readonly results: readonly CheckResult[];
  /** Steps belong to L1 commands that act; a read-only self-check has none. */
  readonly steps: readonly RunStep[];
}

/** Describe a thrown value without leaking a stack into the report. */
function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Does the plan's requirement set hold on this machine? */
function missingCapabilities<TContext>(
  check: CheckModule<TContext>,
  ports: Ports,
  overrides: Readonly<Partial<Record<OptionalCapability, boolean>>> | undefined,
): readonly OptionalCapability[] {
  return check.requires.filter((capability) => {
    const override = overrides?.[capability];
    return override === undefined ? !capabilityAvailable(ports, capability) : !override;
  });
}

/**
 * Run every check in plan order.
 *
 * Sequential on purpose: each check observes the same machine, and a later ticket
 * that needs parallelism can compose plans instead of threading a scheduler
 * through this function.
 */
export async function executePlan<TContext>(
  plan: CheckPlan<TContext>,
  context: TContext,
  options: ExecutePlanOptions,
): Promise<ExecutePlanOutcome> {
  const results: CheckResult[] = [];
  for (const check of plan.checks) {
    const missing = missingCapabilities(check, options.ports, options.capabilities);
    if (missing.length > 0) {
      const names = missing.join(", ");
      const detail = `required capability unavailable: ${names}`;
      const hint =
        check.missingHint ??
        `provide a ${names} adapter (see the capability description) so this check can observe the machine`;
      const status = check.onMissing === "blocked" ? "blocked" : "skip";
      const outcome: CheckOutcome =
        status === "blocked"
          ? {
              status: "blocked",
              detail,
              hint,
              blockedReason: { code: "adapter-missing", message: detail, hint },
            }
          : { status: "skip", detail, hint };
      results.push(toCheckResult(check, outcome, 0));
      options.note?.(`${check.id}: ${status} (${names} unavailable)`);
      continue;
    }

    const startedAt = options.clock.nowMs();
    let outcome: CheckOutcome;
    try {
      outcome = await check.run(context);
    } catch (error) {
      const message = describeThrown(error);
      outcome = failed(
        `the check threw: ${message}`,
        "the check completes and returns an observation",
        message,
        "this is a defect in the check; keep the report and open a ticket against the capability",
      );
    }
    const durationMs = Math.max(0, options.clock.nowMs() - startedAt);
    const result = toCheckResult(check, normalizeOutcome(outcome), durationMs);
    results.push(result);
    const marker = result.status === "pass" ? "ok" : result.status;
    options.note?.(`${result.id}: ${marker}`);
  }
  return { results, steps: [] };
}
