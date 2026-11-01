/**
 * One fake machine for the `model` command, plus the patch-layer texts the tests
 * mutate one rule at a time.
 *
 * Everything is in-process: a FakeFs holds the profile patch, a FakeEnv holds the
 * credential reference (never a real value), and the declaration loader returns a
 * fixture instead of importing plugin code. The canary string exists so a test can
 * prove the command never echoes a credential value, not to simulate a real one.
 */
import type { Ports } from "../../contracts/ports";
import { ok } from "../../contracts/result";
import type { ModelSelection, VerificationProfile } from "../../contracts/verification-profile";
import type { DeclarationLoadResult, VerificationDeclaration } from "../../declaration/loader";
import type { RuntimeFacts } from "../../runtime/types";
import { FakeClock, FakeEnv, FakeFs } from "./fake-fs";
import { declarationFixture, declarationLoader, buildProfile } from "./fake-machine";
import { makePorts } from "./fake-ports";

export const MODEL_CWD = "C:\\fake\\repo";
export const MODEL_DSH_HOME = "C:\\fake-dsh-home";
export const MODEL_PROFILE = "desktop";
export const MODEL_PROFILE_DIR = `${MODEL_DSH_HOME}\\profiles\\${MODEL_PROFILE}`;
export const MODEL_PATCH_PATH = `${MODEL_PROFILE_DIR}\\cordis.patch.yml`;

export const MODEL_PROVIDER = "minimax-cn";
export const MODEL_ID = "Minimax-M3.1-Flash";
export const MODEL_KEY_ENV = "MINIMAX_CN_API_KEY";
/** A value the command may *use* but must never print. */
export const MODEL_SECRET_CANARY = "fixture-model-credential-value-must-not-leak";

export const MODEL_SELECTION: ModelSelection = {
  provider: MODEL_PROVIDER,
  model: MODEL_ID,
  apiKeyEnv: MODEL_KEY_ENV,
};

/** The profile with every rule satisfied; `--fix` must not touch it. */
export function conformingPatch(): string {
  return [
    "# hand-written patch — comments must survive edits",
    "- id: theme-pack",
    '  name: "@fixture/theme-pack"',
    "  config:",
    "    mode: dark",
    "",
    "# the default model entry",
    "- id: agent-default-model",
    "  name: agent-default-model",
    "  config:",
    `    provider: ${MODEL_PROVIDER}`,
    `    model: ${MODEL_ID}`,
    "",
    "# the pi-ai provider entry",
    "- id: llm-pi-ai",
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    "  config:",
    "    providers:",
    `      ${MODEL_PROVIDER}:`,
    `        apiKeyEnv: ${MODEL_KEY_ENV}`,
    "        models:",
    `          - id: ${MODEL_ID}`,
    "            name: MiniMax M3.1 Flash",
    "",
    "# reference parties repeat the id verbatim",
    "- id: vision-router",
    "  name: dsh-vision-router",
    "  config:",
    "    providers:",
    `      - provider: ${MODEL_PROVIDER}`,
    `        model: ${MODEL_ID} # keep this comment`,
    "",
  ].join("\n");
}

/** Wrong default model id, wrong credential reference name, wrong reference id. */
export function mismatchedPatch(): string {
  return [
    "# hand-written patch — comments must survive edits",
    "- id: theme-pack",
    '  name: "@fixture/theme-pack"',
    "  config:",
    "    mode: dark",
    "",
    "- id: agent-default-model",
    "  name: agent-default-model",
    "  config:",
    `    provider: ${MODEL_PROVIDER}`,
    "    model: M3.1-Flash",
    "",
    "- id: llm-pi-ai",
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    "  config:",
    "    providers:",
    `      ${MODEL_PROVIDER}:`,
    "        apiKeyEnv: WRONG_KEY_ENV",
    "        models:",
    `          - id: ${MODEL_ID}`,
    "            name: MiniMax M3.1 Flash",
    "",
    "- id: vision-router",
    "  name: dsh-vision-router",
    "  config:",
    "    providers:",
    `      - provider: ${MODEL_PROVIDER}`,
    "        model: M3.1-Flash # keep this comment",
    "",
  ].join("\n");
}

/** Everything conforms except provider.<p>.apiKeyEnv is absent. */
export function missingApiKeyEnvPatch(): string {
  return [
    "# hand-written patch — comments must survive edits",
    "- id: theme-pack",
    '  name: "@fixture/theme-pack"',
    "  config:",
    "    mode: dark",
    "",
    "- id: agent-default-model",
    "  name: agent-default-model",
    "  config:",
    `    provider: ${MODEL_PROVIDER}`,
    `    model: ${MODEL_ID}`,
    "",
    "- id: llm-pi-ai",
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    "  config:",
    "    providers:",
    `      ${MODEL_PROVIDER}:`,
    "        models:",
    `          - id: ${MODEL_ID}`,
    "            name: MiniMax M3.1 Flash",
    "",
    "# reference parties repeat the id verbatim",
    "- id: vision-router",
    "  name: dsh-vision-router",
    "  config:",
    "    providers:",
    `      - provider: ${MODEL_PROVIDER}`,
    `        model: ${MODEL_ID}`,
    "",
  ].join("\n");
}

/** The patch has no llm-pi-ai entry at all: the one thing --fix must refuse to invent. */
export function missingProviderEntryPatch(): string {
  return [
    "# hand-written patch — comments must survive edits",
    "- id: theme-pack",
    '  name: "@fixture/theme-pack"',
    "  config:",
    "    mode: dark",
    "",
    "- id: agent-default-model",
    "  name: agent-default-model",
    "  config:",
    `    provider: ${MODEL_PROVIDER}`,
    `    model: ${MODEL_ID}`,
    "",
    "- id: vision-router",
    "  name: dsh-vision-router",
    "  config:",
    "    providers:",
    `      - provider: ${MODEL_PROVIDER}`,
    `        model: ${MODEL_ID}`,
    "",
  ].join("\n");
}

/** The patch has no agent-default-model entry: also refused, never created. */
export function missingDefaultEntryPatch(): string {
  return [
    "# hand-written patch — comments must survive edits",
    "- id: llm-pi-ai",
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    "  config:",
    "    providers:",
    `      ${MODEL_PROVIDER}:`,
    `        apiKeyEnv: ${MODEL_KEY_ENV}`,
    "        models:",
    `          - id: ${MODEL_ID}`,
    "            name: MiniMax M3.1 Flash",
    "",
    "- id: vision-router",
    "  name: dsh-vision-router",
    "  config:",
    "    providers:",
    `      - provider: ${MODEL_PROVIDER}`,
    `        model: ${MODEL_ID}`,
    "",
  ].join("\n");
}

export interface ModelFixtureOptions {
  /** Patch text; `null` leaves the file absent so the read itself is blocked. */
  readonly patch?: string | null;
  readonly profileName?: string;
  readonly model?: ModelSelection | false;
  /** Environment overrides on top of the default credential canary. */
  readonly envValues?: Readonly<Record<string, string>>;
  /** Seed `<dshHome>/.credentials.yaml` with this text. */
  readonly credentials?: string;
  /** Profile manifest override (unused by the command, present for realism). */
  readonly packageJson?: unknown;
}

export interface ModelFixture {
  readonly fs: FakeFs;
  readonly env: FakeEnv;
  readonly clock: FakeClock;
  readonly ports: Ports;
  readonly runtime: RuntimeFacts;
  readonly profile: VerificationProfile;
  readonly declaration: VerificationDeclaration;
  readonly loadDeclaration: () => Promise<DeclarationLoadResult>;
  readonly paths: {
    readonly cwd: string;
    readonly dshHome: string;
    readonly profileName: string;
    readonly profileDir: string;
    readonly patchPath: string;
  };
}

/** Build one complete fake machine for the `model` command. */
export function createModelFixture(options: ModelFixtureOptions = {}): ModelFixture {
  const profileName = options.profileName ?? MODEL_PROFILE;
  const cwd = MODEL_CWD;
  const dshHome = MODEL_DSH_HOME;
  const profileDir = `${dshHome}\\profiles\\${profileName}`;
  const patchPath = `${profileDir}\\cordis.patch.yml`;

  const fs = new FakeFs(cwd);
  fs.seedJson(`${profileDir}\\package.json`, options.packageJson ?? { name: profileName, version: "0.0.1" });
  const patch = options.patch === undefined ? conformingPatch() : options.patch;
  if (patch !== null) fs.seedFile(patchPath, patch);
  if (options.credentials !== undefined) fs.seedFile(`${dshHome}\\.credentials.yaml`, options.credentials);

  const env = new FakeEnv({
    values: {
      DSH_HOME: dshHome,
      [MODEL_KEY_ENV]: MODEL_SECRET_CANARY,
      ...(options.envValues ?? {}),
    },
    cwd,
    home: "C:\\Users\\fixture",
  });
  const clock = new FakeClock();
  const ports = makePorts({ fs, clock, env });

  const profile = buildProfile({
    packageName: "fixture-plugin",
    defaultProfile: profileName,
    model: options.model === undefined ? MODEL_SELECTION : options.model,
  });
  const declaration = declarationFixture({ profile });

  return {
    fs,
    env,
    clock,
    ports,
    runtime: { nodeVersion: "24.19.0", readFileSlice: null },
    profile,
    declaration,
    loadDeclaration: declarationLoader(ok(declaration)),
    paths: { cwd, dshHome, profileName, profileDir, patchPath },
  };
}
