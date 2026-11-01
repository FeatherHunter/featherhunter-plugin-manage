/**
 * The verification profile: the *only* place a plugin repository states its differences.
 *
 * Everything the capability must know about one plugin lives here — its package
 * name, the profile to verify by default, how to build it, which skills it
 * registers, which model it expects. Keeping it in one declarative object is what
 * removes constants like `"web"` or `"D:/.../DeepSeek Harness.exe"` from tool code,
 * which is exactly how the previous per-repository scripts drifted apart.
 *
 * `defineVerificationProfile` validates at the boundary and returns a frozen,
 * normalized value: a typo in a profile fails at startup with a sentence, not a
 * mysterious empty report an hour later.
 */
import type { CheckId, ProfileName } from "./branding";
import { parseCheckId, parseProfileName } from "./branding";
import { err, ok, type Failure, type Result } from "./result";

/** One model the run should use. `apiKeyEnv` names a credential, never holds one. */
export interface ModelSelection {
  readonly provider: string;
  readonly model: string;
  /** Name of the credential reference, e.g. `MINIMAX_CN_API_KEY`. Never the value. */
  readonly apiKeyEnv: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly input?: readonly ("text" | "image")[];
}

/** A bundled-skill directory the package ships, and how many skills it must expose. */
export interface BundledSkillsDeclaration {
  /** Directory inside the plugin package, `/`-separated, e.g. `bundled-skills`. */
  readonly dir: string;
  /** Exact number of skills the set must contain (the set is compared by name). */
  readonly expected: number;
}

/** The observation a custom check returns. */
export interface CheckObservation {
  readonly ok: boolean;
  readonly detail: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
}

/**
 * A plugin-specific check. Kept deliberately small: a title, a hard flag, and a
 * function that observes. The runner owns statuses, timing and evidence.
 */
export interface CustomCheck<TContext = unknown> {
  readonly id: CheckId;
  readonly title: string;
  /** Defaults to `true`; a soft check reports but never exits non-zero. */
  readonly hard?: boolean;
  readonly run: (context: TContext) => Promise<CheckObservation | boolean> | CheckObservation | boolean;
}

/** Hooks let a plugin run code at the three moments that are genuinely plugin-shaped. */
export interface VerificationHooks {
  beforeLaunch?(context: { readonly home: string; readonly dir: string; readonly profile: ProfileName }): Promise<void> | void;
  afterLaunch?(context: { readonly instance: unknown }): Promise<void> | void;
  beforeStop?(context: { readonly instance: unknown }): Promise<void> | void;
}

/** What a plugin repository writes in `verify/profile.ts`. */
export interface VerificationProfileInput {
  /** Stable id for this profile; lowercase kebab-case (used in file names and reports). */
  readonly id: string;
  /** npm package name that must be installed into the verified profile. */
  readonly packageName: string;
  /** The DSH profile to verify unless a command overrides it. Required: no hidden default. */
  readonly defaultProfile: string;
  /** Module inside the installed package that proves which build is present. */
  readonly clientEntry?: string;
  /** Directory the plugin writes its cache/logs into, relative to the instance cwd. */
  readonly pluginCacheDir?: string;
  /**
   * Directory name the plugin uses for its own settings under the redirected
   * `USERPROFILE`/`HOME` (e.g. `<userprofile>/.dsh/<pluginSettingsDir>/settings.yaml`).
   * Declaring it lets the tool prove the instance cannot rewrite the developer's
   * real settings; leaving it out means that probe reports `blocked`, never `pass`.
   */
  readonly pluginSettingsDir?: string;
  /** Bundled skills this package registers; `false` means "this plugin registers none". */
  readonly bundledSkills?: BundledSkillsDeclaration | false;
  /** Model the run should configure; `false` means "do not touch model configuration". */
  readonly model?: ModelSelection | false;
  /** Workspace backends the plugin understands, in preference order. */
  readonly workspaceBackends?: readonly string[];
  /** How to build the package under verification. */
  readonly build?: { readonly command: string; readonly timeoutMs?: number };
  /** Environment variables the instance may receive beyond the safe default allowlist. */
  readonly instanceEnvAllowlist?: readonly string[];
  readonly hooks?: VerificationHooks;
  readonly checks?: readonly CustomCheck[];
}

/** The normalized, frozen profile used everywhere after validation. */
export interface VerificationProfile {
  readonly id: string;
  readonly packageName: string;
  readonly defaultProfile: ProfileName;
  readonly clientEntry: string;
  readonly pluginCacheDir?: string;
  readonly pluginSettingsDir?: string;
  readonly bundledSkills: BundledSkillsDeclaration | false;
  readonly model: ModelSelection | false;
  readonly workspaceBackends: readonly string[];
  readonly build?: { readonly command: string; readonly timeoutMs: number };
  readonly instanceEnvAllowlist: readonly string[];
  readonly hooks?: VerificationHooks;
  readonly checks: readonly CustomCheck[];
}

const PROFILE_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
const NPM_PACKAGE_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const RELATIVE_POSIX_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const DIR_NAME_RE = /^[A-Za-z0-9._-]+$/;

function invalid(message: string, hint?: string): Result<never> {
  return err({ code: "invalid-input", message, ...(hint === undefined ? {} : { hint }) });
}

/** Validate the parts that need it, then freeze. Throws only for adversarial use. */
export function defineVerificationProfile(input: VerificationProfileInput): VerificationProfile {
  const result = parseVerificationProfile(input);
  if (!result.ok) {
    const failure: Failure = result.error;
    throw new Error(`verification profile is invalid: ${failure.message}${failure.hint ? ` — ${failure.hint}` : ""}`);
  }
  return result.value;
}

/** Non-throwing variant: use when the profile comes from disk or another process. */
export function parseVerificationProfile(input: VerificationProfileInput): Result<VerificationProfile> {
  if (typeof input !== "object" || input === null) {
    return invalid("profile must be an object", "call defineVerificationProfile({ ... }) in verify/profile.ts");
  }
  if (typeof input.id !== "string" || !PROFILE_ID_RE.test(input.id)) {
    return invalid(`profile id ${JSON.stringify(input.id)} is not lowercase kebab-case`);
  }
  if (typeof input.packageName !== "string" || !NPM_PACKAGE_RE.test(input.packageName)) {
    return invalid(
      `profile packageName ${JSON.stringify(input.packageName)} is not an npm package name`,
      "it must match the name field of the plugin's package.json",
    );
  }
  if (typeof input.defaultProfile !== "string") {
    return invalid("profile defaultProfile is required", "no implicit default is applied");
  }
  const defaultProfile = parseProfileName(input.defaultProfile);
  if (!defaultProfile.ok) return defaultProfile;

  const clientEntry = input.clientEntry ?? "lib/client.js";
  if (!RELATIVE_POSIX_PATH_RE.test(clientEntry)) {
    return invalid(
      `clientEntry ${JSON.stringify(clientEntry)} must be a relative /-separated path inside the package`,
    );
  }

  if (input.pluginCacheDir !== undefined && !DIR_NAME_RE.test(input.pluginCacheDir)) {
    return invalid(
      `pluginCacheDir ${JSON.stringify(input.pluginCacheDir)} must be a single directory name`,
      "it is joined under the instance working directory, not an absolute path",
    );
  }
  if (input.pluginSettingsDir !== undefined && !DIR_NAME_RE.test(input.pluginSettingsDir)) {
    return invalid(
      `pluginSettingsDir ${JSON.stringify(input.pluginSettingsDir)} must be a single directory name`,
      "it is joined under the redirected home directory, not an absolute path",
    );
  }

  if (input.bundledSkills !== undefined && input.bundledSkills !== false) {
    const skills = input.bundledSkills;
    if (!RELATIVE_POSIX_PATH_RE.test(skills.dir)) {
      return invalid(`bundledSkills.dir ${JSON.stringify(skills.dir)} must be a relative /-separated path`);
    }
    if (!Number.isInteger(skills.expected) || skills.expected < 0) {
      return invalid(`bundledSkills.expected must be a non-negative integer, got ${String(skills.expected)}`);
    }
  }

  if (input.model !== undefined && input.model !== false) {
    const model = input.model;
    for (const field of ["provider", "model", "apiKeyEnv"] as const) {
      const value = model[field];
      if (typeof value !== "string" || value.length === 0) {
        return invalid(`model.${field} must be a non-empty string`);
      }
    }
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      return invalid("model.contextWindow must be a positive integer");
    }
    if (model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      return invalid("model.maxTokens must be a positive integer");
    }
  }

  if (input.build !== undefined) {
    if (typeof input.build.command !== "string" || input.build.command.trim().length === 0) {
      return invalid("build.command must be a non-empty shell command");
    }
    if (input.build.timeoutMs !== undefined && (!Number.isInteger(input.build.timeoutMs) || input.build.timeoutMs <= 0)) {
      return invalid("build.timeoutMs must be a positive integer");
    }
  }

  if (input.checks !== undefined) {
    for (const check of input.checks) {
      const id = parseCheckId(String(check.id));
      if (!id.ok) return id;
      if (typeof check.title !== "string" || check.title.trim().length === 0) {
        return invalid(`check ${check.id} needs a title`);
      }
      if (typeof check.run !== "function") {
        return invalid(`check ${check.id} needs a run function`);
      }
    }
  }

  const workspaceBackends = input.workspaceBackends ?? [];
  for (const backend of workspaceBackends) {
    if (typeof backend !== "string" || backend.length === 0) {
      return invalid("workspaceBackends entries must be non-empty strings");
    }
  }

  const instanceEnvAllowlist = input.instanceEnvAllowlist ?? [];
  for (const name of instanceEnvAllowlist) {
    if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return invalid(`instanceEnvAllowlist entry ${JSON.stringify(name)} is not an environment variable name`);
    }
  }

  const profile: VerificationProfile = {
    id: input.id,
    packageName: input.packageName,
    defaultProfile: defaultProfile.value,
    clientEntry,
    ...(input.pluginCacheDir === undefined ? {} : { pluginCacheDir: input.pluginCacheDir }),
    ...(input.pluginSettingsDir === undefined ? {} : { pluginSettingsDir: input.pluginSettingsDir }),
    bundledSkills: input.bundledSkills === false || input.bundledSkills === undefined
      ? (input.bundledSkills ?? false)
      : { dir: input.bundledSkills.dir, expected: input.bundledSkills.expected },
    model: input.model === false || input.model === undefined ? false : { ...input.model },
    workspaceBackends: [...workspaceBackends],
    ...(input.build === undefined
      ? {}
      : { build: { command: input.build.command, timeoutMs: input.build.timeoutMs ?? 20 * 60_000 } }),
    instanceEnvAllowlist: [...instanceEnvAllowlist],
    ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
    checks: [...(input.checks ?? [])],
  };

  return ok(Object.freeze(profile));
}

/** Resolve the profile a command should run against. */
export function resolveProfile(
  profile: VerificationProfile,
  override: string | undefined,
): Result<ProfileName> {
  if (override === undefined) return ok(profile.defaultProfile);
  return parseProfileName(override);
}

/** True when the model section was declared (i.e. the run should configure it). */
export function hasModel(profile: VerificationProfile): boolean {
  return profile.model !== false;
}

/** True when the plugin ships bundled skills the run must find registered. */
export function hasBundledSkills(profile: VerificationProfile): boolean {
  return profile.bundledSkills !== false && profile.bundledSkills.expected > 0;
}
