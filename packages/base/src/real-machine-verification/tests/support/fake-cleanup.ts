/**
 * A deterministic filesystem for cleanup tests.
 *
 * `FakeFs` reports `mtimeMs: 0` for everything, which makes "keep the newest N"
 * untestable. This subclass adds per-path modification times and lets a test
 * script realpath resolutions (an entry that escapes the work root) and remove
 * failures. Every other rule — parent directories, recursive removal, writes
 * recording — is inherited unchanged, so the command runs the same code path as
 * it does against the real filesystem.
 */
import type { FileStat } from "../../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../../contracts/result";
import { FakeFs } from "./fake-fs";

export class FakeCleanupFs extends FakeFs {
  private readonly mtimes = new Map<string, number>();
  private readonly resolvedPaths = new Map<string, Result<string>>();
  private readonly removeFailures = new Map<string, Failure>();

  /** Give one seeded path a deterministic mtime. */
  setMtime(path: string, mtimeMs: number): void {
    this.mtimes.set(this.resolve(path), mtimeMs);
  }

  /** Make `realPath(path)` report another location, e.g. an escaping symlink. */
  setRealPath(path: string, target: string): void {
    this.resolvedPaths.set(this.resolve(path), ok(target));
  }

  /** Make `realPath(path)` fail without changing the entry's existence. */
  failRealPath(path: string, message = "simulated realpath failure"): void {
    this.resolvedPaths.set(this.resolve(path), err(failure("io", message)));
  }

  /** Make `remove(path)` fail without removing anything. */
  failRemove(path: string, message = "simulated remove failure"): void {
    this.removeFailures.set(this.resolve(path), failure("io", message));
  }

  /** Normalized paths passed to `remove`, in order. */
  removeCalls(): string[] {
    return this.writes.filter((write) => write.op === "remove").map((write) => write.path);
  }

  override async stat(path: string): Promise<Result<FileStat>> {
    const base = await super.stat(path);
    if (!base.ok) return base;
    const mtime = this.mtimes.get(this.resolve(path));
    return mtime === undefined ? base : ok({ ...base.value, mtimeMs: mtime });
  }

  override async realPath(path: string): Promise<Result<string>> {
    const scripted = this.resolvedPaths.get(this.resolve(path));
    return scripted ?? super.realPath(path);
  }

  override async remove(
    path: string,
    options: { readonly recursive?: boolean } = {},
  ): Promise<Result<void>> {
    const scripted = this.removeFailures.get(this.resolve(path));
    if (scripted !== undefined) return err(scripted);
    return super.remove(path, options);
  }
}