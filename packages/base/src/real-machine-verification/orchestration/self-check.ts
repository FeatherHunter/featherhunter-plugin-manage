/**
 * The self-check plan: which checks run, in which order, and what they need.
 *
 * Planning is deliberately separate from execution and from reporting. Ticket 11
 * (browser) and ticket 12 (scenarios) extend the *plan* — they add modules to this
 * list or compose a new list — without the runner or the reporter learning about
 * them. That is the whole extension seam: a check is data plus a function.
 *
 * The profile itself is the plan's input: its `checks` array appends custom checks
 * after the built-ins, and a custom check that reuses a built-in id is dropped (the
 * report must have unique ids, and the built-in one is the one readers recognize).
 */
import type { ProfileName } from "../contracts/branding";
import type { Ports } from "../contracts/ports";
import type { CheckObservation, CustomCheck, VerificationProfile } from "../contracts/verification-profile";
import type { DeclarationKind } from "../declaration/loader";
import type { EvidenceStore } from "../evidence/store";
import type { ReadFileSlice } from "../runtime/types";
import { failed, passed, type CheckModule, type CheckPlan } from "./types";
import { createDshRuntimeCheck } from "./checks/dsh-runtime";
import { createNodeVersionCheck } from "./checks/node-version";
import { createPackageInstalledCheck } from "./checks/package-installed";
import { createProfileDeclarationCheck } from "./checks/profile-declaration";
import { createProfilePresentCheck } from "./checks/profile-present";
import { createScreenPresentCheck } from "./checks/screen-present";

/** The command name this plan reports under. */
export const SELF_CHECK_COMMAND = "self-check";

/** The part of a loaded declaration the checks need; kept narrow on purpose. */
export interface SelfCheckDeclaration {
  readonly path: string;
  readonly kind: DeclarationKind;
  readonly exportName: string;
  readonly requiredNode: string;
}

/** Everything a self-check run knows about the machine before it observes it. */
export interface SelfCheckContext {
  readonly profile: VerificationProfile;
  readonly profileName: ProfileName;
  readonly ports: Ports;
  readonly cwd: string;
  /** The DSH home that holds the real profiles (read-only for this command). */
  readonly dshHome: string;
  readonly profileDir: string;
  readonly workRoot: string;
  readonly nodeVersion: string;
  readonly readFileSlice: ReadFileSlice | null;
  readonly declaration: SelfCheckDeclaration;
  readonly screenRequested: boolean;
  readonly evidence: EvidenceStore;
  /** Progress and warnings; the CLI sends these to stderr. */
  readonly note: (message: string) => void;
}

export interface SelfCheckPlanInput {
  readonly profile: VerificationProfile;
  /** Whether the user asked for display checks (`--screen`). */
  readonly screenRequested: boolean;
}

/** Wrap a profile-supplied custom check as a plan module. */
function toCustomCheck(custom: CustomCheck<unknown>): CheckModule<SelfCheckContext> {
  return {
    id: custom.id,
    title: custom.title,
    hard: custom.hard ?? true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const observed: CheckObservation | boolean = await custom.run(context as unknown);
      if (typeof observed === "boolean") {
        return observed
          ? passed("the custom check reported success")
          : failed(
              "the custom check reported failure",
              "the custom check's claim holds",
              "the check returned false",
              "inspect the plugin's custom check implementation",
            );
      }
      if (observed.ok) return passed(observed.detail);
      return failed(
        observed.detail,
        observed.expected ?? "the custom check's claim holds",
        observed.actual ?? observed.detail,
        observed.hint ?? "inspect the plugin's custom check implementation",
      );
    },
  };
}

/**
 * Build the self-check plan for one run.
 *
 * The four prerequisite checks come first on purpose: if the declaration is not
 * the one the plugin meant, or Node cannot run it, the later findings are about a
 * different artifact than the reader thinks. The order is also the order a reader
 * sees in the report, which makes a failed run readable top-to-bottom.
 */
export function planSelfCheck(input: SelfCheckPlanInput): CheckPlan<SelfCheckContext> {
  const checks: CheckModule<SelfCheckContext>[] = [
    createProfileDeclarationCheck(),
    createDshRuntimeCheck(),
    createNodeVersionCheck(),
    createProfilePresentCheck(),
    createPackageInstalledCheck(),
  ];
  if (input.screenRequested) checks.push(createScreenPresentCheck());

  const seen = new Set<string>(checks.map((check) => check.id));
  for (const custom of input.profile.checks) {
    if (seen.has(custom.id)) continue;
    seen.add(custom.id);
    checks.push(toCustomCheck(custom));
  }

  return { command: SELF_CHECK_COMMAND, checks };
}
