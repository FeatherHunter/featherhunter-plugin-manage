/**
 * The runtime context: what every impure module receives.
 *
 * The rule this shape enforces: a runtime function takes `RuntimeEnv` and plain
 * values, returns `Result`, and never reaches for `process` or `fs` directly.
 * That is what lets an end-to-end gate replace the ports with a fake machine and
 * still exercise the same code path the operator runs.
 */
import type { Ports } from "../contracts/ports";
import type { Result } from "../contracts/result";

/** Locations the operator decided on, resolved once per command. */
export interface ResolvedPaths {
  /** The developer's real DSH home. Read-only for this tool, by design. */
  readonly realHome: string;
  /** Root for batches, isolated homes and run directories. */
  readonly workRoot: string;
  /** Repository root when the caller could determine it. */
  readonly repoRoot: string | null;
}

/** Ports plus locations plus one progress channel. */
export interface RuntimeEnv {
  readonly ports: Ports;
  readonly paths: ResolvedPaths;
  /**
   * Progress and diagnostics. Always stderr: stdout carries exactly one JSON
   * report, so `--json` output stays machine-readable even on failure.
   */
  readonly note: (message: string) => void;
}

/**
 * Read a bounded byte range from one file.
 *
 * Why this exists next to `FsPort.readBytes`: a DSH install keeps its host code
 * inside a ~180 MB `app.asar`, and the structural fact worth recording (does the
 * archive contain the CLI entry?) is answered by the first few megabytes of that
 * archive. Reading the whole file to answer it would make a read-only check cost
 * a second of I/O and hundreds of megabytes of memory, so archive headers get a
 * narrow, injectable reader instead of a wider filesystem port.
 */
export type ReadFileSlice = (path: string, offset: number, length: number) => Promise<Result<Uint8Array>>;

/**
 * Facts about the runtime that are not effects and therefore not ports.
 *
 * `nodeVersion` decides the `node-version` check; `readFileSlice` lets the
 * `dsh-runtime` check look inside an asar without a second filesystem port. Tests
 * inject both, so no check has to reach for `process` or `fs` itself.
 */
export interface RuntimeFacts {
  readonly nodeVersion: string;
  readonly readFileSlice: ReadFileSlice | null;
}
