/**
 * Fake machine for the `concurrent` tests: everything `launch` needs, but with a
 * process port that hands every spawn its own pid *and* its own port, so N
 * instances look isolated exactly like real ones would.
 *
 * The process fake is the interesting part:
 * - spawn index i gets pid `basePid + i` and port `basePort + i` (overridable),
 *   and the ready line is seeded into that spawn's stdout file, so the real
 *   readiness parser runs unchanged;
 * - `spawnFailures` makes one spawn fail without consuming a pid, mirroring a host
 *   that exits before printing its token URL;
 * - `stubbornPids` stay alive through `killTree`, which is how a cleanup test gets
 *   a survivor to report instead of trusting the kill request.
 */
import type {
  KillOutcome,
  Ports,
  ProcessPort,
  SpawnRequest,
  SpawnedProcess,
} from "../../contracts/ports";
import { err, ok, type Failure, type Result } from "../../contracts/result";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import {
  createLaunchFixture,
  hostHttp,
  readyLine,
  type LaunchFixture,
  type LaunchFixtureOptions,
  type ScriptedHttp,
} from "./fake-launch";
import { makePorts } from "./fake-ports";

/** What one successful spawn looked like. */
export interface SpawnedInstance {
  readonly index: number;
  readonly pid: number;
  readonly port: number;
}

/** One `killTree` call, in the order it happened. */
export interface RecordedKill {
  readonly pid: number;
  readonly timeoutMs: number | undefined;
}

export interface MultiScriptedProcessOptions {
  /** Pid of the first spawn; later spawns increment it. */
  readonly basePid?: number;
  /** Port of the first spawn; later spawns increment it. */
  readonly basePort?: number;
  /** Spawn index (0-based) → the failure `spawnDetached` should return. */
  readonly spawnFailures?: Readonly<Record<number, Failure>>;
  /** Pids `killTree` must not kill, so cleanup can report a survivor. */
  readonly stubbornPids?: readonly number[];
  /** Explicit port per spawn index, to force a collision on purpose. */
  readonly portFor?: (index: number) => number;
  /**
   * Called synchronously inside the spawn, after the pid/port are chosen. The
   * callback sees *its own* spawn record, so concurrent spawns cannot cross wires.
   */
  readonly onSpawn?: (request: SpawnRequest, instance: SpawnedInstance) => void;
}

/** A process port that treats every spawn as a new isolated instance. */
export class MultiScriptedProcess implements ProcessPort {
  readonly spawns: SpawnRequest[] = [];
  readonly kills: RecordedKill[] = [];
  readonly started: SpawnedInstance[] = [];
  private readonly live = new Set<number>();
  private readonly options: MultiScriptedProcessOptions;

  constructor(options: MultiScriptedProcessOptions = {}) {
    this.options = options;
  }

  async spawnDetached(request: SpawnRequest): Promise<Result<SpawnedProcess>> {
    const index = this.spawns.length;
    this.spawns.push(request);
    const failure = this.options.spawnFailures?.[index];
    if (failure !== undefined) return err(failure);
    const pid = (this.options.basePid ?? 4242) + index;
    const port = this.options.portFor?.(index) ?? (this.options.basePort ?? 53211) + index;
    this.live.add(pid);
    const instance: SpawnedInstance = { index, pid, port };
    this.started.push(instance);
    this.options.onSpawn?.(request, instance);
    return ok({ pid, stdoutPath: request.stdoutPath, stderrPath: request.stderrPath });
  }

  isAlive(pid: number): boolean {
    return this.live.has(pid);
  }

  async killTree(pid: number, options: { readonly timeoutMs?: number } = {}): Promise<Result<KillOutcome>> {
    this.kills.push({ pid, timeoutMs: options.timeoutMs });
    if (this.options.stubbornPids?.includes(pid) === true) {
      return ok({ killed: false, alreadyGone: false });
    }
    const wasAlive = this.live.delete(pid);
    return ok({ killed: wasAlive, alreadyGone: !wasAlive });
  }
}

export interface ConcurrentFixtureOptions {
  /**
   * The declared plugin cache directory. The string `null` declares *no* cache
   * directory, which is a different fact from "not passed" and must be explicit.
   */
  readonly pluginCacheDir?: string | null;
  readonly profilePresent?: boolean;
  readonly declaration?: LaunchFixture["declaration"];
  readonly realCredentials?: string;
  readonly workRoot?: string;
  readonly basePid?: number;
  readonly basePort?: number;
  readonly spawnFailures?: Readonly<Record<number, Failure>>;
  readonly stubbornPids?: readonly number[];
  readonly portFor?: (index: number) => number;
}

/** The launch fixture plus the multi-instance process fake the tests inspect. */
export interface ConcurrentFixture {
  readonly fs: LaunchFixture["fs"];
  readonly env: LaunchFixture["env"];
  readonly clock: LaunchFixture["clock"];
  readonly runtime: LaunchFixture["runtime"];
  readonly profile: LaunchFixture["profile"];
  readonly declaration: LaunchFixture["declaration"];
  readonly paths: LaunchFixture["paths"];
  readonly ports: Ports;
  readonly http: ScriptedHttp;
  readonly multi: MultiScriptedProcess;
}

/** Build one fake machine that can host N isolated instances. */
export function createConcurrentFixture(options: ConcurrentFixtureOptions = {}): ConcurrentFixture {
  const declaredCacheDir = options.pluginCacheDir === null ? undefined : (options.pluginCacheDir ?? ".dsh-plugin-cache");
  const http = hostHttp();
  const launchOptions: LaunchFixtureOptions = {
    http,
    ...(declaredCacheDir === undefined ? {} : { pluginCacheDir: declaredCacheDir }),
    ...(options.profilePresent === undefined ? {} : { profilePresent: options.profilePresent }),
    ...(options.declaration === undefined ? {} : { declaration: options.declaration }),
    ...(options.realCredentials === undefined ? {} : { realCredentials: options.realCredentials }),
    ...(options.workRoot === undefined ? {} : { workRoot: options.workRoot }),
  };
  const base = createLaunchFixture(launchOptions);
  // The real startInstance reads the ready line from the spawned stdout file; seed
  // it from inside the spawn so each instance's file carries its own port.
  const multi = new MultiScriptedProcess({
    ...(options.basePid === undefined ? {} : { basePid: options.basePid }),
    ...(options.basePort === undefined ? {} : { basePort: options.basePort }),
    ...(options.spawnFailures === undefined ? {} : { spawnFailures: options.spawnFailures }),
    ...(options.stubbornPids === undefined ? {} : { stubbornPids: options.stubbornPids }),
    ...(options.portFor === undefined ? {} : { portFor: options.portFor }),
    onSpawn: (request: SpawnRequest, instance: SpawnedInstance): void => {
      base.fs.seedFile(request.stdoutPath, readyLine(instance.port));
    },
  });
  const ports = makePorts({
    fs: base.fs,
    clock: base.clock,
    env: base.env,
    process: multi,
    http,
  });
  return {
    fs: base.fs,
    env: base.env,
    clock: base.clock,
    runtime: base.runtime,
    profile: base.profile,
    declaration: base.declaration,
    paths: base.paths,
    ports,
    http,
    multi,
  };
}

/** A `loadDeclaration` replacement returning this fixture's declaration. */
export function concurrentLoader(
  fixture: ConcurrentFixture,
): (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult> {
  return async (): Promise<DeclarationLoadResult> =>
    ok(fixture.declaration) as unknown as DeclarationLoadResult;
}

/**
 * Seed an additional profile directory, for the `--profiles` tests.
 *
 * The files mirror what `createLaunchFixture` seeds for the base profile: a valid
 * profile manifest and a workspace storage.
 */
export function seedProfile(fixture: ConcurrentFixture, name: string): void {
  const dir = `${fixture.paths.dshHome}\\profiles\\${name}`;
  fixture.fs.seedJson(`${dir}\\package.json`, { name, version: "0.0.1" });
  fixture.fs.seedJson(`${dir}\\storages\\workspace.json`, { unit: { name: "workspace", version: 2 } });
}
