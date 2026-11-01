/**
 * Per-run directories: the unit evidence and reports are filed under.
 *
 * The id is derived from the start time in the local clock, so a person reading
 * `.scratch/verify/runs/` sees when each run happened without opening a file. Two
 * runs that start in the same millisecond get `-2`, `-3`; a run never overwrites
 * another run's report, for the same reason evidence never overwrites evidence.
 */
import type { FsPort } from "../contracts/ports";
import { err, failure, ok, type Result } from "../contracts/result";
import { joinFsPath } from "../runtime/paths";

/** The directories one command invocation owns. */
export interface PreparedRunDirectory {
  readonly runId: string;
  readonly runDir: string;
  /** Where evidence items go; created lazily by the evidence store. */
  readonly evidenceDir: string;
}

export interface PrepareRunDirectoryOptions {
  readonly fs: FsPort;
  readonly workRoot: string;
  /** Command name, so a work root holding several commands stays readable. */
  readonly command: string;
  /** Start timestamp; `clock.iso()` output, local offset included. */
  readonly startedAt: string;
}

/** Turn an ISO timestamp (or any label) into one safe path segment. */
export function toRunIdSegment(value: string): string {
  const cleaned = value.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length === 0 ? "run" : cleaned;
}

/**
 * Create `<workRoot>/runs/<runId>/`, choosing the first unused ordinal.
 *
 * Failing to create the directory is a real error: without it there is nowhere to
 * put the report, and the caller must not pretend the run was recorded.
 */
export async function planRunDirectory(
  options: PrepareRunDirectoryOptions,
): Promise<Result<PreparedRunDirectory>> {
  const { fs, workRoot, command, startedAt } = options;
  const runsRoot = joinFsPath(workRoot, "runs");
  const baseId = `${toRunIdSegment(command)}-${toRunIdSegment(startedAt)}`;
  for (let ordinal = 1; ordinal <= 999; ordinal += 1) {
    const runId = ordinal === 1 ? baseId : `${baseId}-${ordinal}`;
    const runDir = joinFsPath(runsRoot, runId);
    if (await fs.exists(runDir)) continue;
    return ok({ runId, runDir, evidenceDir: joinFsPath(runDir, "evidence") });
  }
  return err(
    failure("conflict", `could not find a free run directory under ${runsRoot}`, "clean the work root or pass --work-root"),
  );
}

export async function prepareRunDirectory(
  options: PrepareRunDirectoryOptions,
): Promise<Result<PreparedRunDirectory>> {
  const { fs, workRoot } = options;
  const planned = await planRunDirectory(options);
  if (!planned.ok) return planned;
  const runsRoot = joinFsPath(workRoot, "runs");
  const madeRoot = await fs.makeDir(runsRoot);
  if (!madeRoot.ok) return madeRoot;
  const made = await fs.makeDir(planned.value.runDir);
  if (!made.ok) return made;
  return ok(planned.value);
}
