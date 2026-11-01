/**
 * The self-check fixture: one machine, one declaration, four green checks.
 *
 * A test starts from `createFixture()` and breaks exactly one assumption, so the
 * status it asserts is attributable. The asar builder mirrors the byte layout of a
 * real Electron archive (measured on the developer's install), which is what keeps
 * the `dsh-runtime` check's parsing honest rather than mocked away.
 */
import type { Sha256Hex } from "../../contracts/branding";
import { sha256Text } from "../../contracts/identity";
import type { ScreenInfo } from "../../contracts/ports";
import { ok, type Result } from "../../contracts/result";
import {
  parseVerificationProfile,
  type CustomCheck,
  type VerificationProfile,
  type VerificationProfileInput,
} from "../../contracts/verification-profile";
import {
  NODE_MIN_FOR_TYPESCRIPT,
  type DeclarationImport,
  type DeclarationLoadResult,
  type VerificationDeclaration,
} from "../../declaration/loader";
import type { RuntimeFacts } from "../../runtime/types";
import { ASAR_CLI_ENTRY } from "../../runtime/dsh/asar";
import { FakeClock, FakeEnv, FakeFs, fakePath } from "./fake-fs";
import { FakeScreen, makePorts } from "./fake-ports";
import type { Ports } from "../../contracts/ports";

const textEncoder = new TextEncoder();

/* --------------------------------------------------------------------- asar */

/**
 * Build bytes with the same layout Electron's asar uses, as measured on the real
 * install: `u32 @0 = 4`, `u32 @4 = headerBytes`, `u32 @8 = payload`, `u32 @12 =
 * jsonLength`, the JSON tree at `@16`, and `dataOffset = 8 + headerBytes`.
 */
export function buildFakeAsarBytes(entries?: Readonly<Record<string, string>>): Uint8Array {
  const contents = entries ?? { [ASAR_CLI_ENTRY]: "// fake DSH host CLI\n" };
  const tree: { files: Record<string, unknown> } = { files: {} };
  let entryOffset = 1000;
  for (const [entryPath, text] of Object.entries(contents)) {
    const segments = entryPath.split("/");
    let cursor = tree.files;
    for (const segment of segments.slice(0, -1)) {
      const node = cursor[segment];
      if (typeof node !== "object" || node === null) cursor[segment] = { files: {} };
      cursor = (cursor[segment] as { files: Record<string, unknown> }).files;
    }
    const name = segments[segments.length - 1] ?? entryPath;
    cursor[name] = {
      size: textEncoder.encode(text).byteLength,
      offset: String(entryOffset),
      integrity: { hash: sha256Text(text) },
    };
    entryOffset += text.length + 1;
  }
  const json = textEncoder.encode(JSON.stringify(tree));
  const paddedLength = Math.ceil(json.length / 8) * 8;
  const headerBytes = 8 + paddedLength;
  const dataOffset = 8 + headerBytes;
  const buffer = new Uint8Array(dataOffset);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 4, true);
  view.setUint32(4, headerBytes, true);
  view.setUint32(8, headerBytes - 4, true);
  view.setUint32(12, json.length, true);
  buffer.set(json, 16);
  return buffer;
}

/** A `ReadFileSlice` over a fake filesystem, mirroring the real slice reader. */
export function createFakeReadFileSlice(fs: FakeFs): NonNullable<RuntimeFacts["readFileSlice"]> {
  return async (path, offset, length) => {
    const bytes = await fs.readBytes(path);
    if (!bytes.ok) return bytes;
    return ok(bytes.value.subarray(offset, Math.min(offset + length, bytes.value.byteLength)));
  };
}

/* ------------------------------------------------------------------ profiles */

/** A valid declaration input; override any field the test cares about. */
export function buildProfileInput(overrides: Partial<VerificationProfileInput> = {}): VerificationProfileInput {
  return {
    id: "fixture",
    packageName: "fixture-plugin",
    defaultProfile: "web",
    clientEntry: "lib/client.js",
    ...overrides,
  };
}

export function buildProfile(overrides: Partial<VerificationProfileInput> = {}): VerificationProfile {
  const parsed = parseVerificationProfile(buildProfileInput(overrides));
  if (!parsed.ok) throw new Error(`fixture profile is invalid: ${parsed.error.message}`);
  return parsed.value;
}

export interface DeclarationFixtureOptions {
  readonly path?: string;
  readonly kind?: "ts" | "js";
  readonly exportName?: string;
  readonly requiredNode?: string;
  readonly profile?: VerificationProfile;
}

/** A declaration that loaded successfully, for tests about the checks, not the loader. */
export function declarationFixture(options: DeclarationFixtureOptions = {}): VerificationDeclaration {
  return {
    path: options.path ?? "C:\\fixture-repo\\verify\\profile.ts",
    kind: options.kind ?? "ts",
    exportName: options.exportName ?? "default",
    requiredNode: options.requiredNode ?? NODE_MIN_FOR_TYPESCRIPT,
    profile: options.profile ?? buildProfile(),
  };
}

/** A `loadDeclaration` replacement that always returns the same result. */
export function declarationLoader(
  result: DeclarationLoadResult = ok(declarationFixture()),
): () => Promise<DeclarationLoadResult> {
  return async () => result;
}

/** Import function that hands back the given module regardless of specifier. */
export function fakeDeclarationImport(module: unknown): DeclarationImport {
  return async () => module;
}

/** A custom-check fixture that returns the observation the test wants. */
export function customCheckFixture(
  run: CustomCheck["run"],
  overrides: Partial<CustomCheck> = {},
): CustomCheck {
  return { id: "fixture-custom" as CustomCheck["id"], title: "a fixture check", run, ...overrides };
}

/* ------------------------------------------------------------------ fixture */

export interface FixtureOptions {
  readonly cwd?: string;
  readonly dshHome?: string;
  readonly nodeVersion?: string;
  readonly localVersion?: string | null;
  readonly localName?: string | null;
  readonly installedVersion?: string;
  readonly declareDependency?: boolean;
  readonly clientEntryPresent?: boolean;
  readonly clientEntryContent?: string;
  readonly profilePresent?: boolean;
  readonly profileManifestValid?: boolean;
  readonly dshPresent?: boolean;
  readonly asarPresent?: boolean;
  readonly profileName?: string;
  readonly profileOverrides?: Partial<VerificationProfileInput>;
  readonly screen?: Result<readonly ScreenInfo[]>;
  readonly envValues?: Readonly<Record<string, string>>;
}

const DEFAULT_CLIENT_ENTRY = "console.log('fixture client');\n";

export interface Fixture {
  readonly fs: FakeFs;
  readonly env: FakeEnv;
  readonly clock: FakeClock;
  readonly ports: Ports;
  readonly readFileSlice: NonNullable<RuntimeFacts["readFileSlice"]>;
  readonly runtime: RuntimeFacts;
  /** Roots the checks read or write; tests compare reports against these. */
  readonly paths: {
    readonly cwd: string;
    readonly dshHome: string;
    readonly profileName: string;
    readonly profileDir: string;
    readonly packageDir: string;
    readonly clientEntryPath: string;
    readonly clientEntryContent: string;
    readonly clientEntrySha256: Sha256Hex;
    readonly exe: string;
    readonly asar: string;
    readonly packageName: string;
    readonly installedVersion: string;
    readonly localVersion: string;
    readonly workRoot: string;
  };
  readonly profile: VerificationProfile;
}

/** Build the all-green machine, with one assumption at a time overridable. */
export function createFixture(options: FixtureOptions = {}): Fixture {
  const cwd = options.cwd ?? "C:\\fixture-repo";
  const dshHome = options.dshHome ?? "C:\\fake-dsh-home";
  const profileName = options.profileName ?? "web";
  const packageName = options.profileOverrides?.packageName ?? "fixture-plugin";
  const installedVersion = options.installedVersion ?? "1.2.3";
  const localVersion = options.localVersion === undefined ? "1.2.3" : (options.localVersion ?? "");
  const localName = options.localName === undefined ? packageName : (options.localName ?? "");
  const clientEntryContent = options.clientEntryContent ?? DEFAULT_CLIENT_ENTRY;
  const exe = "C:\\Harness\\DeepSeek Harness.exe";
  const asar = "C:\\Harness\\resources\\app.asar";
  const workRoot = "C:\\Temp\\verify-work";
  const profileDir = `${dshHome}\\profiles\\${profileName}`;
  const packageDir = `${profileDir}\\node_modules\\${packageName}`;
  const clientEntryPath = `${packageDir}\\lib\\client.js`;

  const fs = new FakeFs(cwd);
  const envValues: Record<string, string> = { DSH_HOME: dshHome, ...(options.envValues ?? {}) };
  if (options.dshPresent !== false) envValues["DSH_EXE"] = exe;
  const env = new FakeEnv({ values: envValues, cwd, home: "C:\\Users\\fixture" });
  const clock = new FakeClock();
  const screen = options.screen ?? ok([{ id: "primary", primary: true, width: 1920, height: 1080 }]);
  const ports = makePorts({ fs, clock, env, screen: new FakeScreen(screen) });
  const readFileSlice = createFakeReadFileSlice(fs);
  const runtime: RuntimeFacts = { nodeVersion: options.nodeVersion ?? "24.19.0", readFileSlice };

  if (localVersion.length > 0 || localName.length > 0) {
    fs.seedJson(`${cwd}\\package.json`, {
      name: localName.length > 0 ? localName : undefined,
      version: localVersion.length > 0 ? localVersion : undefined,
    });
  }
  if (options.profilePresent !== false) {
    fs.seedJson(
      `${profileDir}\\package.json`,
      options.profileManifestValid === false
        ? "{ this is not json"
        : {
            name: profileName,
            version: "0.0.1",
            dependencies: options.declareDependency === false ? {} : { [packageName]: installedVersion },
          },
    );
  }
  fs.seedJson(`${packageDir}\\package.json`, { name: packageName, version: installedVersion });
  if (options.clientEntryPresent !== false) fs.seedFile(clientEntryPath, clientEntryContent);
  if (options.dshPresent !== false) fs.seedFile(exe, "fake executable");
  if (options.asarPresent !== false) fs.seedFile(asar, buildFakeAsarBytes());

  return {
    fs,
    env,
    clock,
    ports,
    readFileSlice,
    runtime,
    paths: {
      cwd,
      dshHome,
      profileName,
      profileDir,
      packageDir,
      clientEntryPath,
      clientEntryContent,
      clientEntrySha256: sha256Text(clientEntryContent),
      exe,
      asar,
      packageName,
      installedVersion,
      localVersion,
      workRoot,
    },
    profile: buildProfile({ packageName, defaultProfile: profileName, ...(options.profileOverrides ?? {}) }),
  };
}

/** The declaration a passing fixture would have loaded. */
export function fixtureDeclaration(fixture: Fixture): VerificationDeclaration {
  return declarationFixture({ path: `${fixture.paths.cwd}\\verify\\profile.ts`, profile: fixture.profile });
}

/* ------------------------------------------------------------- run artifacts */

export interface WrittenRun {
  readonly runDir: string;
  readonly content: string;
  readonly sha256: Sha256Hex;
  readonly evidenceFiles: readonly string[];
}

/** Read the single run written under a work root, including its sibling hash file. */
export function readRunDirectory(fs: FakeFs, workRoot: string): WrittenRun {
  const runsRoot = `${workRoot}/runs`;
  const runs = fs.children(runsRoot);
  if (runs.length !== 1) throw new Error(`expected one run under ${runsRoot}, found ${runs.length}`);
  const runDir = runs[0] ?? "";
  const content = fs.readFileSync(`${runDir}/run.json`);
  const hashFile = fs.readFileSync(`${runDir}/run.json.sha256`);
  const sha256 = hashFile.trim().split(/\s+/)[0] ?? "";
  return {
    runDir,
    content,
    sha256: sha256 as Sha256Hex,
    evidenceFiles: fs.children(`${runDir}/evidence`),
  };
}

/** Every evidence file under a run as text, so a test can scan for secrets. */
export function readEvidenceText(fs: FakeFs, workRoot: string): string {
  const run = readRunDirectory(fs, workRoot);
  return run.evidenceFiles.map((file) => fs.readFileSync(file)).join("\n");
}

export { fakePath };
