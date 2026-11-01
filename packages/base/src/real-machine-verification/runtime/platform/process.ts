/**
 * The process port: detached instances and tree kills.
 *
 * The two hard parts of process management on a desktop machine live here:
 *
 * - a launched instance must survive the CLI exiting, so it is spawned detached
 *   with file-backed stdio and unref'd;
 * - killing an instance means killing its whole tree, because a GUI shell forks
 *   helpers. `process.kill(pid)` alone leaves those helpers behind, which is how
 *   a verification run ends up with an instance nobody can see or stop.
 */
import { spawn, execFile } from "node:child_process";
import { closeSync, openSync } from "node:fs";

import type { KillOutcome, ProcessPort, SpawnedProcess, SpawnRequest } from "../../contracts/ports";
import { err, failure, ok, type Result } from "../../contracts/result";

const DEFAULT_KILL_TIMEOUT_MS = 5_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "EPERM";
  }
}

function execFileAsync(file: string, args: readonly string[]): Promise<{ readonly code: number | null }> {
  return new Promise((resolve) => {
    execFile(file, [...args], { windowsHide: true }, (error) => {
      if (error === null) {
        resolve({ code: 0 });
        return;
      }
      resolve({ code: typeof error.code === "number" ? error.code : null });
    });
  });
}

async function waitForDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  return !isAlive(pid);
}

export function createProcessPort(): ProcessPort {
  return {
    async spawnDetached(request: SpawnRequest): Promise<Result<SpawnedProcess>> {
      const executable = request.argv[0];
      if (executable === undefined || executable.length === 0) {
        return err(failure("invalid-input", "a spawned process needs at least one argv entry"));
      }
      let stdoutFd: number | null = null;
      let stderrFd: number | null = null;
      try {
        stdoutFd = openSync(request.stdoutPath, "a");
        stderrFd = openSync(request.stderrPath, "a");
        const child = spawn(executable, request.argv.slice(1), {
          cwd: request.cwd,
          env: { ...request.env },
          detached: request.detached,
          windowsHide: request.windowsHide,
          stdio: ["ignore", stdoutFd, stderrFd],
        });
        if (child.pid === undefined) {
          return err(failure("io", `could not start ${executable}: no pid was assigned`));
        }
        child.unref();
        return ok({ pid: child.pid, stdoutPath: request.stdoutPath, stderrPath: request.stderrPath });
      } catch (error) {
        return err(
          failure(
            "io",
            `could not start ${executable}: ${error instanceof Error ? error.message : String(error)}`,
            "check the executable path",
          ),
        );
      } finally {
        if (stdoutFd !== null) closeSync(stdoutFd);
        if (stderrFd !== null) closeSync(stderrFd);
      }
    },
    isAlive,
    async killTree(pid, killOptions): Promise<Result<KillOutcome>> {
      if (!Number.isInteger(pid) || pid <= 0) {
        return err(failure("invalid-input", `not a process id: ${String(pid)}`));
      }
      const wasAlive = isAlive(pid);
      if (!wasAlive) return ok({ killed: false, alreadyGone: true });
      const timeoutMs = killOptions?.timeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;

      if (process.platform === "win32") {
        const outcome = await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
        const gone = await waitForDeath(pid, timeoutMs);
        if (!gone) {
          return err(
            failure(
              "timeout",
              `process tree ${pid} is still alive after taskkill`,
              "stop it from Task Manager, then rerun cleanup",
              { taskkillExitCode: outcome.code },
            ),
          );
        }
        return ok({ killed: true, alreadyGone: false });
      }

      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // It died between the liveness check and the signal.
        }
      }
      if (await waitForDeath(pid, timeoutMs)) return ok({ killed: true, alreadyGone: false });
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      const gone = await waitForDeath(pid, timeoutMs);
      if (!gone) {
        return err(failure("timeout", `process tree ${pid} survived SIGKILL`, "inspect the process table"));
      }
      return ok({ killed: true, alreadyGone: false });
    },
  };
}
