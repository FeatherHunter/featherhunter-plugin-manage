/**
 * The command port: run an external program, never through a shell string.
 *
 * Three details make this the single place command execution is decided:
 *
 * - `.cmd`/`.bat` on Windows cannot be spawned directly; they go through
 *   `ComSpec /d /s /c`, which is the documented Windows behaviour and the one
 *   that keeps a wrapper like `dsh.cmd` callable.
 * - Output is kept as a bounded tail. A failing command can print megabytes, and
 *   a report needs the last screen, not the whole log.
 * - A timeout is data: the process is killed and `timedOut` says so, so a caller
 *   never mistakes a killed clock for a clean non-zero exit.
 */
import { spawn } from "node:child_process";

import type { CommandOutcome, CommandPort, CommandRequest, PlatformName } from "../../contracts/ports";
import { err, failure, ok, type Result } from "../../contracts/result";

/** Default per-stream budget: enough for a stack trace, small enough to buffer. */
const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

/** Collect a stream while keeping only its tail. */
class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly limit: number) {}

  append(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      this.size -= dropped === undefined ? 0 : dropped.length;
    }
  }

  text(): string {
    if (this.size > this.limit) return Buffer.concat(this.chunks).subarray(-this.limit).toString("utf8");
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export interface CommandPortOptions {
  /** Injected so the Windows branching can be tested on another OS. */
  readonly platform?: PlatformName;
  /** `ComSpec` for `.cmd`/`.bat` wrappers; defaults to the environment's. */
  readonly comspec?: string;
}

/** Quote one argument for a `cmd.exe /c` command line. */
function quoteForCmd(argument: string): string {
  if (!/[\s"&|<>^]/.test(argument)) return argument;
  return `"${argument.replace(/"/g, '""')}"`;
}

export function createCommandPort(options: CommandPortOptions = {}): CommandPort {
  const platform = options.platform ?? (process.platform as PlatformName);
  const comspec = options.comspec ?? process.env["ComSpec"] ?? "cmd.exe";

  return {
    async run(request: CommandRequest): Promise<Result<CommandOutcome>> {
      const argv = [...request.argv];
      const executable = argv[0];
      if (executable === undefined || executable.length === 0) {
        return err(failure("invalid-input", "a command needs at least one argv entry"));
      }

      const isWindowsScript = platform === "win32" && /\.(cmd|bat)$/i.test(executable);
      const file = isWindowsScript ? comspec : executable;
      const args = isWindowsScript ? ["/d", "/s", "/c", argv.map(quoteForCmd).join(" ")] : argv.slice(1);
      const startedAt = Date.now();
      const maxBuffer = request.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
      const cwd = request.cwd ?? process.cwd();
      const environment = request.env === undefined ? process.env : { ...request.env };

      return await new Promise<Result<CommandOutcome>>((resolve) => {
        let settled = false;
        const settle = (value: Result<CommandOutcome>): void => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        let child;
        try {
          child = spawn(file, args, {
            cwd,
            env: environment,
            windowsHide: true,
            ...(isWindowsScript ? { windowsVerbatimArguments: true } : {}),
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch (error) {
          settle(
            err(
              failure(
                "io",
                `could not start ${executable}: ${error instanceof Error ? error.message : String(error)}`,
                "check the path or add the program to PATH",
                { argv },
              ),
            ),
          );
          return;
        }

        const stdout = new TailBuffer(maxBuffer);
        const stderr = new TailBuffer(maxBuffer);
        let timedOut = false;
        let timedOutTimer: NodeJS.Timeout | null = null;

        child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
        child.on("error", (error) => {
          if (timedOutTimer !== null) clearTimeout(timedOutTimer);
          settle(
            err(
              failure(
                "io",
                `could not run ${executable}: ${error.message}`,
                "the executable may not exist or may not be executable",
                { argv },
              ),
            ),
          );
        });
        child.on("close", (code, signal) => {
          if (timedOutTimer !== null) clearTimeout(timedOutTimer);
          settle(
            ok({
              argv,
              cwd,
              exitCode: code,
              signal,
              stdout: stdout.text(),
              stderr: stderr.text(),
              durationMs: Date.now() - startedAt,
              timedOut,
            }),
          );
        });

        if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
          timedOutTimer = setTimeout(() => {
            timedOut = true;
            child.kill();
          }, request.timeoutMs);
        }
        child.stdin.end(request.stdin ?? "");
      });
    },
  };
}
