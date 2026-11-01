/**
 * Doubles for the launch/stop tests: a scripted process port, a scripted HTTP host
 * and one fixture that is a complete machine.
 *
 * The launch path is the one place in this tool where "the fake was wrong" would be
 * expensive: a test that only checks the shape of the plan could pass while the
 * real command spawns the wrong executable or writes the record before readiness.
 * So the fakes record the exact `SpawnRequest` and every HTTP request; the
 * assertions compare them against the plan value item by item.
 */
import type { HttpPort, HttpRequest, HttpResponse, KillOutcome, Ports, ProcessPort, SpawnRequest, SpawnedProcess } from "../../contracts/ports";
import { err, ok, type Failure, type Result } from "../../contracts/result";
import {
  buildProfile,
  declarationFixture,
  type DeclarationFixtureOptions,
} from "./fake-machine";
import { FakeClock, FakeEnv, FakeFs } from "./fake-fs";
import { makePorts } from "./fake-ports";
import type { ModelSelection } from "../../contracts/verification-profile";
import type { VerificationProfile } from "../../contracts/verification-profile";
import type { RuntimeFacts } from "../../runtime/types";
import type { VerificationDeclaration } from "../../declaration/loader";

/** The 43-character access token used by every fixture readiness line. */
export const FIXTURE_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

/** The readiness line a real host prints once the web server is listening. */
export function readyLine(port = 53211, token = FIXTURE_TOKEN): string {
  return `dsh web: http://127.0.0.1:${port}/?token=${token}\n`;
}

/* ------------------------------------------------------------------- process */

export interface ScriptedProcessOptions {
  readonly pid?: number;
  /** Runs after the spawn is recorded; a test can seed the captured log files here. */
  readonly onSpawn?: (request: SpawnRequest) => void;
  readonly spawnFailure?: Failure;
  /** Override liveness; by default a spawned pid stays alive until killed. */
  readonly alive?: (pid: number) => boolean;
  /** Override the kill outcome; by default the pid is removed and reported killed. */
  readonly kill?: (pid: number) => KillOutcome;
}

/** A `ProcessPort` that records spawns and kills and simulates liveness. */
export class ScriptedProcess implements ProcessPort {
  readonly spawns: SpawnRequest[] = [];
  readonly kills: { readonly pid: number; readonly timeoutMs: number | undefined }[] = [];
  readonly pid: number;
  private readonly started = new Set<number>();
  private readonly options: ScriptedProcessOptions;

  constructor(options: ScriptedProcessOptions = {}) {
    this.options = options;
    this.pid = options.pid ?? 4242;
  }

  async spawnDetached(request: SpawnRequest): Promise<Result<SpawnedProcess>> {
    this.spawns.push(request);
    if (this.options.spawnFailure !== undefined) return err(this.options.spawnFailure);
    this.started.add(this.pid);
    this.options.onSpawn?.(request);
    return ok({ pid: this.pid, stdoutPath: request.stdoutPath, stderrPath: request.stderrPath });
  }

  isAlive(pid: number): boolean {
    if (this.options.alive !== undefined) return this.options.alive(pid);
    return this.started.has(pid);
  }

  async killTree(pid: number, options: { readonly timeoutMs?: number } = {}): Promise<Result<KillOutcome>> {
    this.kills.push({ pid, timeoutMs: options.timeoutMs });
    const outcome = this.options.kill?.(pid) ?? { killed: true, alreadyGone: false };
    if (outcome.killed) this.started.delete(pid);
    return ok(outcome);
  }
}

/* ---------------------------------------------------------------------- http */

export type HttpScript = (
  request: HttpRequest,
) => Result<HttpResponse> | Promise<Result<HttpResponse>>;

/** A scripted `HttpPort` that records every request it serves. */
export class ScriptedHttp implements HttpPort {
  readonly requests: HttpRequest[] = [];
  private readonly script: HttpScript;

  constructor(script: HttpScript) {
    this.script = script;
  }

  async request(request: HttpRequest): Promise<Result<HttpResponse>> {
    this.requests.push(request);
    return this.script(request);
  }
}

/** The `/connect?token=…` response: a redirect plus the auth cookie. */
export function connectResponse(options: {
  readonly status?: number;
  readonly cookie?: string;
  readonly location?: string;
} = {}): HttpResponse {
  return {
    status: options.status ?? 302,
    headers: { location: options.location ?? "./api/remote.mux" },
    setCookie: [options.cookie ?? "dsh-auth-fixture=fixture-cookie; Path=/; HttpOnly"],
    body: "",
  };
}

/** A JSON HTTP response, as `HttpResponse` represents it. */
export function jsonResponse(value: unknown, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, setCookie: [], body: JSON.stringify(value) };
}

/** A host RPC envelope for a successful call. */
export function rpcEnvelope(value: unknown, rpcId = "fixture-rpc"): HttpResponse {
  return jsonResponse({ type: "server-response", rpcId, result: { ok: true, value } });
}

/** A host RPC envelope for a rejected call. */
export function rpcFailureEnvelope(message: string, code: string | null = null): HttpResponse {
  return jsonResponse({
    type: "server-response",
    rpcId: "fixture-rpc",
    result: { ok: false, error: { message, ...(code === null ? {} : { code }) } },
  });
}

/** One `pluginInventory/list` entry. */
export interface FixtureInventoryEntry {
  readonly entryId: string;
  readonly enabled: boolean;
  readonly fiberPhase: string | null;
  readonly moduleName?: string | null;
}

/** A `pluginInventory/list` value with the given entries. */
export function inventoryOf(entries: readonly FixtureInventoryEntry[]): unknown {
  return {
    managementAvailable: true,
    entries: entries.map((entry) => ({
      entryId: entry.entryId,
      moduleName: entry.moduleName ?? entry.entryId,
      enabled: entry.enabled,
      fiberPhase: entry.fiberPhase,
    })),
  };
}

/** The healthy inventory: every enabled entry is active, disabled entries are null. */
export function allActiveInventory(): unknown {
  return inventoryOf([
    { entryId: "extension/core", enabled: true, fiberPhase: "active" },
    { entryId: "extension/fixture-plugin", enabled: true, fiberPhase: "active" },
    { entryId: "extension/disabled", enabled: false, fiberPhase: null },
  ]);
}

/**
 * A host HTTP script: `/connect` returns the redirect, every RPC returns the given
 * inventory value. Tests that need a different behaviour build their own script.
 */
export function hostHttp(options: { readonly inventory?: unknown } = {}): ScriptedHttp {
  return new ScriptedHttp((request) => {
    if (request.url.includes("/connect?")) return ok(connectResponse());
    return ok(rpcEnvelope(options.inventory ?? allActiveInventory()));
  });
}

/* ------------------------------------------------------------------- fixture */

export const LAUNCH_CWD = "C:\\fake\\repo";
export const LAUNCH_DSH_HOME = "C:\\fake-dsh-home";
export const LAUNCH_PROFILE = "web";
export const LAUNCH_WORK_ROOT = "C:\\fake-work";
export const LAUNCH_EXE = "C:\\Harness\\DeepSeek Harness.exe";
export const LAUNCH_ASAR = "C:\\Harness\\resources\\app.asar";

export interface LaunchFixtureOptions {
  /** `false` (the default) declares no model, exactly like the smoke repo. */
  readonly model?: ModelSelection | false;
  /** Declared plugin cache directory; its copied `logs` are removed by copyProfile. */
  readonly pluginCacheDir?: string;
  readonly instanceEnvAllowlist?: readonly string[];
  readonly envValues?: Readonly<Record<string, string>>;
  /** Seed the real home's `.credentials.yaml` (a canary value the tests must never leak). */
  readonly realCredentials?: string;
  /** Seed the batch home's `.credentials.yaml` after planning; rarely needed. */
  readonly process?: ScriptedProcess;
  readonly http?: HttpPort;
  readonly workRoot?: string;
  /** Extra flat files inside the source profile, to make the copy measurable. */
  readonly profileFiles?: Readonly<Record<string, string>>;
  readonly profilePresent?: boolean;
  readonly declaration?: VerificationDeclaration;
}

export interface LaunchFixture {
  readonly fs: FakeFs;
  readonly env: FakeEnv;
  readonly clock: FakeClock;
  readonly ports: Ports;
  readonly runtime: RuntimeFacts;
  readonly process: ScriptedProcess;
  readonly http: HttpPort;
  readonly profile: VerificationProfile;
  readonly declaration: VerificationDeclaration;
  readonly paths: {
    readonly cwd: string;
    readonly dshHome: string;
    readonly profileName: string;
    readonly profileDir: string;
    readonly exe: string;
    readonly asar: string;
    readonly workRoot: string;
  };
}

/** Build one complete fake machine: runtime installed, profile present, host healthy. */
export function createLaunchFixture(options: LaunchFixtureOptions = {}): LaunchFixture {
  const cwd = LAUNCH_CWD;
  const dshHome = LAUNCH_DSH_HOME;
  const workRoot = options.workRoot ?? LAUNCH_WORK_ROOT;
  const profileDir = `${dshHome}\\profiles\\${LAUNCH_PROFILE}`;

  const fs = new FakeFs(cwd);
  fs.seedFile(LAUNCH_EXE, "fake executable");
  fs.seedFile(LAUNCH_ASAR, "fake asar bytes");
  if (options.profilePresent !== false) {
    fs.seedJson(`${profileDir}\\package.json`, { name: LAUNCH_PROFILE, version: "0.0.1" });
    fs.seedJson(`${profileDir}\\storages\\workspace.json`, { unit: { name: "workspace", version: 2 } });
    for (const [name, content] of Object.entries(options.profileFiles ?? {})) fs.seedFile(`${profileDir}\\${name}`, content);
  }
  if (options.realCredentials !== undefined) fs.seedFile(`${dshHome}\\.credentials.yaml`, options.realCredentials);

  const envValues: Record<string, string> = { DSH_HOME: dshHome, DSH_EXE: LAUNCH_EXE, ...(options.envValues ?? {}) };
  const env = new FakeEnv({ values: envValues, cwd, home: "C:\\Users\\fixture" });
  const clock = new FakeClock();
  const process = options.process ?? new ScriptedProcess({ pid: 4242, onSpawn: (request) => fs.seedFile(request.stdoutPath, readyLine()) });
  const http = options.http ?? hostHttp();
  const ports = makePorts({ fs, clock, env, process, http });

  const profile = buildProfile({
    packageName: "fixture-plugin",
    defaultProfile: LAUNCH_PROFILE,
    clientEntry: "lib/client.js",
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.pluginCacheDir === undefined ? {} : { pluginCacheDir: options.pluginCacheDir }),
    ...(options.instanceEnvAllowlist === undefined ? {} : { instanceEnvAllowlist: options.instanceEnvAllowlist }),
  });
  const declaration = options.declaration ?? declarationFixture({ profile });

  return {
    fs,
    env,
    clock,
    ports,
    runtime: { nodeVersion: "24.19.0", readFileSlice: null },
    process,
    http,
    profile,
    declaration,
    paths: { cwd, dshHome, profileName: LAUNCH_PROFILE, profileDir, exe: LAUNCH_EXE, asar: LAUNCH_ASAR, workRoot },
  };
}

/** A loader that always returns this fixture's declaration. */
export function fixtureLoader(fixture: LaunchFixture): () => Promise<{ readonly ok: true; readonly value: VerificationDeclaration }> {
  return async () => ok(fixture.declaration) as unknown as Promise<{ readonly ok: true; readonly value: VerificationDeclaration }>;
}

/** Unused type reference kept meaningful for `DeclarationFixtureOptions` consumers. */
export type { DeclarationFixtureOptions };
