/**
 * The remaining ports: process, HTTP, command, screen, browser, and the aggregate.
 *
 * None of these fakes performs the real side effect. The self-check may only use
 * the screen and command ports, but the aggregate must be complete, so every slot
 * gets a value that fails honestly rather than throwing `undefined is not a function`.
 */
import type {
  BrowserProbeFactory,
  CommandOutcome,
  CommandPort,
  CommandRequest,
  HttpPort,
  HttpRequest,
  HttpResponse,
  KillOutcome,
  Ports,
  ProcessPort,
  ScreenInfo,
  ScreenPort,
  SpawnedProcess,
  SpawnRequest,
} from "../../contracts/ports";
import { err, failure, ok, type Result } from "../../contracts/result";
import { FakeClock, FakeEnv, FakeFs } from "./fake-fs";

/** Records command requests and returns the scripted result (default: exit 0). */
export class FakeCommand implements CommandPort {
  readonly requests: CommandRequest[] = [];
  private readonly handler: (request: CommandRequest) => Result<CommandOutcome>;

  constructor(handler?: (request: CommandRequest) => Result<CommandOutcome>) {
    this.handler =
      handler ??
      ((request) =>
        ok({
          argv: request.argv,
          cwd: request.cwd ?? "",
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          durationMs: 0,
          timedOut: false,
        }));
  }

  async run(request: CommandRequest): Promise<Result<CommandOutcome>> {
    this.requests.push(request);
    return this.handler(request);
  }
}

export class FakeProcess implements ProcessPort {
  private readonly running: boolean;

  constructor(running = false) {
    this.running = running;
  }

  async spawnDetached(request: SpawnRequest): Promise<Result<SpawnedProcess>> {
    return err(failure("unsupported", `the fake process port does not start processes (${request.argv.join(" ")})`));
  }

  isAlive(): boolean {
    return this.running;
  }

  async killTree(): Promise<Result<KillOutcome>> {
    return ok({ killed: false, alreadyGone: true });
  }
}

export class FakeHttp implements HttpPort {
  readonly requests: HttpRequest[] = [];
  private readonly response: Result<HttpResponse>;

  constructor(response?: Result<HttpResponse>) {
    this.response = response ?? err(failure("unsupported", "the fake HTTP port makes no requests"));
  }

  async request(request: HttpRequest): Promise<Result<HttpResponse>> {
    this.requests.push(request);
    return this.response;
  }
}

/** A chosen display list (or a chosen failure); the self-check never needs a real screen. */
export class FakeScreen implements ScreenPort {
  private readonly result: Result<readonly ScreenInfo[]>;

  constructor(result?: Result<readonly ScreenInfo[]>) {
    this.result = result ?? ok([{ id: "primary", primary: true, width: 1920, height: 1080 }]);
  }

  async screens(): Promise<Result<readonly ScreenInfo[]>> {
    return this.result;
  }
}

/** A browser factory is never needed by the self-check; this one always errors. */
export function createFakeBrowser(): BrowserProbeFactory {
  return {
    async launch() {
      return err(failure("unsupported", "the fake browser factory cannot launch"));
    },
  };
}

export interface FakePortsOptions {
  readonly fs?: Ports["fs"];
  readonly clock?: Ports["clock"];
  readonly env?: Ports["env"];
  readonly command?: Ports["command"];
  readonly process?: Ports["process"];
  readonly http?: Ports["http"];
  readonly screen?: Ports["screen"];
  readonly browser?: BrowserProbeFactory | null;
}

/** Build a complete `Ports` from fakes, overriding only what a test cares about. */
export function makePorts(options: FakePortsOptions = {}): Ports {
  return {
    fs: options.fs ?? new FakeFs(),
    clock: options.clock ?? new FakeClock(),
    env: options.env ?? new FakeEnv(),
    command: options.command ?? new FakeCommand(),
    process: options.process ?? new FakeProcess(),
    http: options.http ?? new FakeHttp(),
    screen: options.screen ?? new FakeScreen(),
    browser: options.browser ?? null,
  };
}
