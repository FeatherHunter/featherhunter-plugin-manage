/**
 * The isolation-probe fixture: one fake machine where a real child process is
 * simulated by a command handler.
 *
 * The handler does exactly what the probe script does on a real machine — resolve
 * its home from the child environment, write the marker under
 * `<home>/.dsh/<pluginSettingsDir>/settings.yaml`, read it back and print one
 * JSON line — so the probe's parsing, fingerprinting and failure attribution run
 * unmodified. Breaking one assumption at a time (ignore the redirect, fail the
 * write, write to the real file) is how the tests prove each check turns red for
 * the reason it claims.
 */
import type { Sha256Hex } from "../../contracts/branding";
import { sha256Text } from "../../contracts/identity";
import type { CommandOutcome, CommandRequest, Ports } from "../../contracts/ports";
import { ok, type Result } from "../../contracts/result";
import type { VerificationProfile, VerificationProfileInput } from "../../contracts/verification-profile";
import type { DeclarationLoadResult, LoadDeclarationOptions, VerificationDeclaration } from "../../declaration/loader";
import { PROBE_MARKER_CONTENT } from "../../runtime/dsh/isolation";
import { joinFsPath } from "../../runtime/paths";
import type { RuntimeFacts } from "../../runtime/types";
import { declarationFixture, declarationLoader, buildProfile } from "./fake-machine";
import { FakeClock, FakeEnv, FakeFs } from "./fake-fs";
import { FakeCommand, makePorts } from "./fake-ports";

/** A fake secret that must never appear in a report, evidence file or stream. */
export const ISOLATION_CANARY = "sk-canary-do-not-leak-9f2c1b";

const textEncoder = new TextEncoder();

export interface FakeIsolationChildOptions {
  readonly fs: FakeFs;
  readonly realHome: string;
  readonly pluginSettingsDir: string;
  /** Counter-example: resolve the real home instead of the redirect passed in the env. */
  readonly ignoreRedirect?: boolean;
  /** The bytes the child writes; defaults to the fixed probe marker. */
  readonly content?: string;
  /** The write itself fails (directory not creatable, disk full, ...). */
  readonly writeFails?: boolean;
  /** The read-back returns different bytes than the write. */
  readonly readBackFails?: boolean;
  readonly exitCode?: number;
  readonly stderr?: string;
  /** Override the reported home without touching where the marker is written. */
  readonly homeOverride?: string;
  /** Override where the marker is written; used to simulate damage to the real file. */
  readonly markerOverride?: string;
}

/**
 * A command handler that behaves like the probe child.
 *
 * It resolves its home from `request.env` exactly as `os.homedir()` would under
 * the redirect, so the runtime's environment building is exercised, not stubbed.
 */
export function createFakeIsolationChild(options: FakeIsolationChildOptions): FakeCommand {
  const content = options.content ?? PROBE_MARKER_CONTENT;
  return new FakeCommand((request: CommandRequest): Result<CommandOutcome> => {
    const env = request.env ?? {};
    const home =
      options.homeOverride ??
      (options.ignoreRedirect === true
        ? options.realHome
        : (env["USERPROFILE"] ?? env["HOME"] ?? options.realHome));
    const markerPath =
      options.markerOverride ?? joinFsPath(home, ".dsh", options.pluginSettingsDir, "settings.yaml");

    let wrote = false;
    let readBack = false;
    let bytes = 0;
    let sha256: Sha256Hex | null = null;
    if (options.writeFails !== true) {
      options.fs.seedFile(markerPath, content);
      wrote = true;
      const back = options.readBackFails === true ? `${content}tampered` : content;
      readBack = back === content;
      bytes = textEncoder.encode(back).byteLength;
      sha256 = sha256Text(back);
    }

    const stdout = `${JSON.stringify({ home, markerPath, wrote, readBack, bytes, sha256 })}\n`;
    return ok({
      argv: request.argv,
      cwd: request.cwd ?? "",
      exitCode: options.exitCode ?? 0,
      signal: null,
      stdout,
      stderr: options.stderr ?? "",
      durationMs: 5,
      timedOut: false,
    });
  });
}

export interface IsolationFixtureOptions {
  readonly cwd?: string;
  readonly workRoot?: string;
  readonly realHome?: string;
  readonly dshHome?: string;
  /** `null` simulates a declaration that does not declare the field. */
  readonly pluginSettingsDir?: string | null;
  readonly profileOverrides?: Partial<VerificationProfileInput>;
  readonly realSettingsPresent?: boolean;
  readonly realSettingsContent?: string;
  readonly envValues?: Readonly<Record<string, string>>;
  readonly child?: Omit<FakeIsolationChildOptions, "fs" | "realHome" | "pluginSettingsDir">;
  /** Counter-example: the child writes its marker over the plugin's real settings file. */
  readonly childWritesToRealSettings?: boolean;
  /** Simulate a declaration that fails to load. */
  readonly declarationResult?: DeclarationLoadResult;
}

export interface IsolationFixturePaths {
  readonly cwd: string;
  readonly workRoot: string;
  readonly realHome: string;
  readonly dshHome: string;
  readonly pluginSettingsDir: string | null;
  readonly realSettingsPath: string | null;
  readonly realSettingsContent: string;
}

export interface IsolationFixture {
  readonly fs: FakeFs;
  readonly env: FakeEnv;
  readonly clock: FakeClock;
  readonly ports: Ports;
  readonly runtime: RuntimeFacts;
  readonly profile: VerificationProfile;
  readonly command: FakeCommand;
  readonly declaration: VerificationDeclaration;
  readonly loadDeclaration: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
  readonly paths: IsolationFixturePaths;
}

const DEFAULT_REAL_SETTINGS = `model:
  provider: fixture
  apiKey: ${ISOLATION_CANARY}
`;

/** Build one isolation machine with a single assumption overridable per test. */
export function createIsolationFixture(options: IsolationFixtureOptions = {}): IsolationFixture {
  const cwd = options.cwd ?? "C:\\fixture-repo";
  const workRoot = options.workRoot ?? "C:\\Temp\\verify-work";
  const realHome = options.realHome ?? "C:\\Users\\fixture";
  const dshHome = options.dshHome ?? "C:\\fake-dsh-home";
  const pluginSettingsDir = options.pluginSettingsDir === undefined ? "fixtureskillsdeck" : options.pluginSettingsDir;
  const realSettingsContent = options.realSettingsContent ?? DEFAULT_REAL_SETTINGS;

  const fs = new FakeFs(cwd);
  const env = new FakeEnv({
    values: { DSH_HOME: dshHome, UNRELATED_SECRET: "hunter2", ...(options.envValues ?? {}) },
    home: realHome,
    cwd,
  });
  const clock = new FakeClock();

  const realSettingsPath =
    pluginSettingsDir === null ? null : joinFsPath(realHome, ".dsh", pluginSettingsDir, "settings.yaml");
  if (options.realSettingsPresent !== false && realSettingsPath !== null) {
    fs.seedFile(realSettingsPath, realSettingsContent);
  }

  const command = createFakeIsolationChild({
    fs,
    realHome,
    pluginSettingsDir: pluginSettingsDir ?? "unused",
    ...(options.child ?? {}),
    ...(options.childWritesToRealSettings === true && realSettingsPath !== null
      ? { markerOverride: realSettingsPath }
      : {}),
  });
  const ports = makePorts({ fs, clock, env, command });

  const profile = buildProfile({
    defaultProfile: "web",
    ...(pluginSettingsDir === null ? {} : { pluginSettingsDir }),
    ...(options.profileOverrides ?? {}),
  });
  const declaration = declarationFixture({ path: joinFsPath(cwd, "verify", "profile.ts"), profile });
  const loadDeclaration = declarationLoader(options.declarationResult ?? ok(declaration));

  return {
    fs,
    env,
    clock,
    ports,
    runtime: { nodeVersion: "24.19.0", readFileSlice: null },
    profile,
    command,
    declaration,
    loadDeclaration,
    paths: { cwd, workRoot, realHome, dshHome, pluginSettingsDir, realSettingsPath, realSettingsContent },
  };
}

/** Probe roots created under the work root, one per isolation run. */
export function isolationProbeRoots(fs: FakeFs, workRoot: string): readonly string[] {
  return fs.children(joinFsPath(workRoot, "isolation"));
}

/** The single probe root of a run, or an error when the count is not one. */
export function onlyProbeRoot(fs: FakeFs, workRoot: string): string {
  const roots = isolationProbeRoots(fs, workRoot);
  const first = roots[0];
  if (roots.length !== 1 || first === undefined) {
    throw new Error(`expected one isolation probe under ${workRoot}, found ${roots.length}`);
  }
  // FakeFs returns normalized ('/'-separated) paths; rebuild the root in the work
  // root's own style so tests can compare it against the paths the runtime records.
  const runId = first.slice(first.lastIndexOf("/") + 1);
  return joinFsPath(workRoot, "isolation", runId);
}

/** The redirected home and marker path a probe root implies. */
export function probePathsFor(probeRoot: string, pluginSettingsDir: string): {
  readonly redirectedHome: string;
  readonly workdir: string;
  readonly markerPath: string;
} {
  const redirectedHome = joinFsPath(probeRoot, "userprofile");
  return {
    redirectedHome,
    workdir: joinFsPath(probeRoot, "workdir"),
    markerPath: joinFsPath(redirectedHome, ".dsh", pluginSettingsDir, "settings.yaml"),
  };
}
