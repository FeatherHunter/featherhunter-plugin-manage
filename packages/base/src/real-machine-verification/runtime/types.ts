/**
 * The runtime context: what every impure module receives.
 *
 * The rule this shape enforces: a runtime function takes `RuntimeEnv` and plain
 * values, returns `Result`, and never reaches for `process` or `fs` directly.
 * That is what lets an end-to-end gate replace the ports with a fake machine and
 * still exercise the same code path the operator runs.
 */
import type { Ports } from "../contracts/ports";

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
