/**
 * The cleanup plan and its execution.
 *
 * Planning is a pure function of a scan, retention numbers and a clock: it says
 * what *would* happen and why, and nothing in it calls the filesystem. Execution
 * is the only half that deletes, and it re-checks every planned path before each
 * removal instead of trusting the plan:
 *
 * - the shared delete guard must agree (`deleteGuardReason`), so a path that
 *   became a drive root, the user's home, the cwd or too shallow between plan
 *   and execute is refused;
 * - the path and the work root are resolved again, and the entry must still be
 *   strictly inside the resolved root;
 * - anything that resolved outside during the scan was already marked report-only.
 *
 * The split matters for the command's contract: `--yes` turns execution on, but
 * it cannot turn a report-only entry into a deletion. Unknown categories,
 * archived evidence, symbolic links and entries whose real path escaped the work
 * root all stay report-only no matter which flags were passed.
 */
import type { ClockPort, FileKind, FsPort, Ports } from "../contracts/ports";
import { err, failure, formatFailure, ok, type Result } from "../contracts/result";
import type { CleanupCategory, CleanupScan, CleanupScannedEntry } from "../runtime/dsh/cleanup-scan";
import { deleteGuardReason } from "../runtime/fs-utils";
import { isInsidePath, samePath } from "../runtime/paths";

/** How many entries each class keeps, and whether candidate packages are deletable. */
export interface CleanupRetention {
  readonly batches: number;
  readonly homes: number;
  readonly includePkg: boolean;
}

/** What the planner decided for one entry. */
export type CleanupAction = "keep" | "delete" | "report";

export interface CleanupPlanEntry {
  readonly path: string;
  readonly relativePath: string;
  readonly category: CleanupCategory;
  readonly archived: boolean;
  readonly kind: FileKind;
  /** Local ISO spelling, or `null` when the scan could not stat the entry. */
  readonly mtime: string | null;
  readonly mtimeMs: number | null;
  readonly bytes: number;
  readonly files: number;
  readonly directories: number;
  /** 1 = newest within its class; `null` when the entry was never ranked. */
  readonly rank: number | null;
  readonly action: CleanupAction;
  readonly reason: string;
  readonly unsafe: boolean;
}

export interface CleanupSummary {
  readonly entries: number;
  readonly keep: number;
  readonly delete: number;
  readonly report: number;
  readonly unsafe: number;
}

export interface CleanupPlan {
  readonly workRoot: string;
  readonly realWorkRoot: string | null;
  readonly retention: CleanupRetention;
  readonly entries: readonly CleanupPlanEntry[];
  readonly problems: readonly string[];
  readonly summary: CleanupSummary;
}

/** What the filesystem guard needs to know; passed from the environment port. */
export interface CleanupGuardContext {
  readonly homeDir: string;
  readonly cwd: string;
  readonly tmpDir: string;
}

const GUARD_HINT = "choose a dedicated work root such as <repo>/.scratch/verify";

/**
 * Refuse a work root that must never be cleaned, before anything is listed.
 *
 * The textual guard catches drive roots, shallow paths and equality with home,
 * cwd or tmp. The resolved path is then checked the same way, and compared with
 * the resolved protected directories, because `--work-root C:\\link` can point at
 * the user's home while spelling something else.
 */
export async function guardCleanupRoot(
  fs: FsPort,
  workRoot: string,
  context: CleanupGuardContext,
): Promise<Result<{ readonly realWorkRoot: string | null }>> {
  const protectedPaths = [context.homeDir, context.cwd, context.tmpDir];
  const textual = deleteGuardReason(workRoot, protectedPaths);
  if (textual !== null) {
    return err(failure("invalid-input", `refusing to clean ${workRoot}: ${textual}`, GUARD_HINT));
  }

  const resolved = await fs.realPath(workRoot);
  if (!resolved.ok) {
    if (await fs.exists(workRoot)) {
      return err(
        failure(
          "io",
          `refusing to clean ${workRoot}: cannot resolve its real path: ${formatFailure(resolved.error)}`,
          GUARD_HINT,
        ),
      );
    }
    // A missing work root has nothing to delete; the command reports that state.
    return ok({ realWorkRoot: null });
  }

  const resolvedReason = deleteGuardReason(resolved.value, protectedPaths);
  if (resolvedReason !== null) {
    return err(
      failure(
        "invalid-input",
        `refusing to clean ${workRoot}: resolves to ${resolved.value} (${resolvedReason})`,
        GUARD_HINT,
      ),
    );
  }

  for (const protectedPath of protectedPaths) {
    const protectedReal = await fs.realPath(protectedPath);
    if (protectedReal.ok && samePath(resolved.value, protectedReal.value)) {
      return err(
        failure(
          "invalid-input",
          `refusing to clean ${workRoot}: resolves to the protected directory ${protectedReal.value}`,
          GUARD_HINT,
        ),
      );
    }
  }

  return ok({ realWorkRoot: resolved.value });
}

function planEntry(entry: CleanupScannedEntry, mtime: string | null): Omit<CleanupPlanEntry, "rank" | "action" | "reason"> {
  return {
    path: entry.path,
    relativePath: entry.relativePath,
    category: entry.category,
    archived: entry.archived,
    kind: entry.kind,
    mtime,
    mtimeMs: entry.mtimeMs,
    bytes: entry.bytes,
    files: entry.files,
    directories: entry.directories,
    unsafe: entry.problem !== null,
  };
}

/** Rank eligible entries newest-first; ties are broken by relative path. */
function rankEligible(entries: readonly CleanupScannedEntry[]): {
  readonly ranks: ReadonlyMap<string, number>;
  readonly counts: ReadonlyMap<CleanupCategory, number>;
} {
  const ranks = new Map<string, number>();
  const counts = new Map<CleanupCategory, number>();
  for (const category of ["batch", "home", "temp", "candidate"] as const) {
    const eligible = entries
      .filter((entry) => entry.category === category && !entry.archived && entry.problem === null)
      .sort((left, right) => {
        const byAge = (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0);
        if (byAge !== 0) return byAge;
        return left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0;
      });
    eligible.forEach((entry, index) => ranks.set(entry.path, index + 1));
    counts.set(category, eligible.length);
  }
  return { ranks, counts };
}

function retainedEntry(
  entry: Omit<CleanupPlanEntry, "rank" | "action" | "reason">,
  rank: number,
  count: number,
  keep: number,
  flag: string,
): CleanupPlanEntry {
  if (rank <= keep) {
    return { ...entry, rank, action: "keep", reason: `rank ${rank} of ${count} is within ${flag} ${keep}` };
  }
  return { ...entry, rank, action: "delete", reason: `rank ${rank} of ${count} exceeds ${flag} ${keep}` };
}

/**
 * Decide keep / delete / report for every scanned entry.
 *
 * Order matters: archive, unknown and unsafe checks come before retention, so a
 * retention number can never make one of those deletable. Candidate packages are
 * ranked (the report shows which is newest) but only become deletable when
 * `includePkg` is true.
 */
export function planCleanup(
  scan: CleanupScan,
  retention: CleanupRetention,
  clock: ClockPort,
): CleanupPlan {
  const { ranks, counts } = rankEligible(scan.entries);
  const entries = scan.entries.map((entry): CleanupPlanEntry => {
    const base = planEntry(entry, entry.mtimeMs === null ? null : clock.iso(entry.mtimeMs));

    if (entry.category === "unknown") {
      return { ...base, rank: null, action: "report", reason: "unknown entry; never deleted" };
    }
    if (entry.archived) {
      return { ...base, rank: null, action: "keep", reason: "archived evidence is immutable" };
    }
    if (entry.problem !== null) {
      return { ...base, rank: null, action: "report", reason: `not deleted: ${entry.problem}` };
    }

    const rank = ranks.get(entry.path) ?? null;
    if (rank === null) {
      // Defensive: an eligible entry always receives a rank above. Reporting is
      // the safe answer if that invariant ever changes.
      return { ...base, rank: null, action: "report", reason: "not ranked; never deleted" };
    }
    const count = counts.get(entry.category) ?? 0;

    switch (entry.category) {
      case "batch":
        return retainedEntry(base, rank, count, retention.batches, "--keep-batches");
      case "home":
        return retainedEntry(base, rank, count, retention.homes, "--keep-homes");
      case "temp":
        return { ...base, rank, action: "delete", reason: "temporary artifacts are not retained" };
      case "candidate":
        if (!retention.includePkg) {
          return {
            ...base,
            rank,
            action: "report",
            reason: "candidate packages are report-only; pass --include-pkg to delete",
          };
        }
        return {
          ...base,
          rank,
          action: "delete",
          reason: "--include-pkg was passed; candidate packages are not retained",
        };
      default:
        return { ...base, rank: null, action: "report", reason: "unknown entry; never deleted" };
    }
  });

  return {
    workRoot: scan.workRoot,
    realWorkRoot: scan.realWorkRoot,
    retention,
    entries,
    problems: scan.problems,
    summary: {
      entries: entries.length,
      keep: entries.filter((entry) => entry.action === "keep").length,
      delete: entries.filter((entry) => entry.action === "delete").length,
      report: entries.filter((entry) => entry.action === "report").length,
      unsafe: entries.filter((entry) => entry.unsafe).length,
    },
  };
}

export interface CleanupRemovedEntry {
  readonly path: string;
  readonly relativePath: string;
  readonly bytes: number;
}

export interface CleanupFailedEntry {
  readonly path: string;
  readonly relativePath: string;
  readonly error: string;
}

export interface CleanupExecution {
  readonly removed: readonly CleanupRemovedEntry[];
  readonly failed: readonly CleanupFailedEntry[];
  readonly freedBytes: number;
}

/**
 * Delete the entries the plan marked `delete`, re-verifying each one.
 *
 * Failures are collected, not thrown: one stubborn entry must not leave the
 * remaining deletable entries behind. The caller turns any failure into exit 1.
 */
export async function executeCleanup(
  plan: CleanupPlan,
  ports: Ports,
  protectedPaths: readonly string[],
): Promise<CleanupExecution> {
  const removed: CleanupRemovedEntry[] = [];
  const failed: CleanupFailedEntry[] = [];
  let freedBytes = 0;

  for (const entry of plan.entries) {
    if (entry.action !== "delete" || entry.unsafe) continue;

    const refusal = deleteGuardReason(entry.path, [...protectedPaths, plan.workRoot]);
    if (refusal !== null) {
      failed.push({ path: entry.path, relativePath: entry.relativePath, error: `refusing to delete: ${refusal}` });
      continue;
    }
    if (plan.realWorkRoot === null) {
      failed.push({
        path: entry.path,
        relativePath: entry.relativePath,
        error: "work root has no resolved path; refusing to delete",
      });
      continue;
    }

    const resolved = await ports.fs.realPath(entry.path);
    if (!resolved.ok) {
      failed.push({ path: entry.path, relativePath: entry.relativePath, error: formatFailure(resolved.error) });
      continue;
    }
    if (!isInsidePath(resolved.value, plan.realWorkRoot) || samePath(resolved.value, plan.realWorkRoot)) {
      failed.push({
        path: entry.path,
        relativePath: entry.relativePath,
        error: `refusing to delete: ${resolved.value} is outside the work root ${plan.realWorkRoot}`,
      });
      continue;
    }

    const deletion = await ports.fs.remove(entry.path, { recursive: true });
    if (!deletion.ok) {
      failed.push({ path: entry.path, relativePath: entry.relativePath, error: formatFailure(deletion.error) });
      continue;
    }
    removed.push({ path: entry.path, relativePath: entry.relativePath, bytes: entry.bytes });
    freedBytes += entry.bytes;
  }

  return { removed, failed, freedBytes };
}
