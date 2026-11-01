/**
 * Read-only discovery of what lives under one work root.
 *
 * Cleanup is the only command that deletes, so the scan is deliberately boring:
 * it classifies, measures, and stops there. Two rules shape the whole file.
 *
 * 1. **Ownership is read from the published layout, not guessed from names.**
 *    `runs/`, `isolation/`, `instances/`, `batches/`, `candidates/` and
 *    `archive/` are the containers this tool creates. Only their direct children
 *    are candidates for deletion; every other child of the work root is
 *    `unknown` and is reported, never removed. A directory the tool cannot name
 *    is a directory the tool does not own.
 * 2. **A path is only "inside" after realpath agrees.** Each entry is resolved
 *    through `realPath` and compared with the resolved work root, so a symlink or
 *    junction cannot make a scan of `runs/` point at a user's documents. Entries
 *    that resolve outside (or cannot be resolved) carry a `problem` and the
 *    planner keeps them report-only.
 *
 * Symbolic links are never deleted even when their target is inside the work
 * root: `fs.remove` would remove the link itself, but the measurement of what
 * that link exposes is ambiguous, and "ambiguous" is not a reason to delete.
 * `archive/` is read as evidence, never as trash: its children are reported as
 * archived and the planner keeps them regardless of retention flags.
 */
import type { DirEntry, FileKind, FsPort } from "../../contracts/ports";
import { formatFailure } from "../../contracts/result";
import { measureTree } from "../fs-utils";
import { isInsidePath, joinFsPath, samePath } from "../paths";

/** The ownership classes cleanup reports. Unknown is a class, not an error. */
export type CleanupCategory = "batch" | "home" | "temp" | "candidate" | "unknown";

/** One entry that could be kept, deleted, or only reported. */
export interface CleanupScannedEntry {
  /** Absolute path as built from the work root; never used as an identity key. */
  readonly path: string;
  /** `/`-separated path below the work root, e.g. `runs/self-check-2026...`. */
  readonly relativePath: string;
  readonly category: CleanupCategory;
  /** True only for children of `archive/`; the planner never deletes them. */
  readonly archived: boolean;
  /** Taken from the directory listing, so a symlink stays a symlink. */
  readonly kind: FileKind;
  readonly mtimeMs: number | null;
  readonly bytes: number;
  readonly files: number;
  readonly directories: number;
  /** Resolved path when resolution succeeded; `null` otherwise. */
  readonly realPath: string | null;
  /** True only when the resolved path is strictly below the resolved work root. */
  readonly insideWorkRoot: boolean;
  /** Why this entry must not be deleted, joined with `; `, or `null`. */
  readonly problem: string | null;
}

/** The whole scan, including root-level failures that make the report partial. */
export interface CleanupScan {
  readonly workRoot: string;
  /** False when the work root does not exist: an empty scan, not an error. */
  readonly exists: boolean;
  readonly realWorkRoot: string | null;
  readonly entries: readonly CleanupScannedEntry[];
  /** Problems reading the work root itself; per-entry problems live on the entry. */
  readonly problems: readonly string[];
}

interface KnownRoot {
  readonly category: Exclude<CleanupCategory, "unknown">;
  readonly archived: boolean;
}

/**
 * The work-root layout this build knows. A new container must be added here in
 * the same change that starts writing it; otherwise its children are reported as
 * unknown and survive cleanup, which is the intended failure mode.
 */
const KNOWN_ROOTS = new Map<string, KnownRoot>([
  ["runs", { category: "temp", archived: false }],
  ["isolation", { category: "temp", archived: false }],
  ["instances", { category: "home", archived: false }],
  ["batches", { category: "batch", archived: false }],
  ["candidates", { category: "candidate", archived: false }],
  ["archive", { category: "batch", archived: true }],
]);

function byName(left: DirEntry, right: DirEntry): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

/** Describe one direct child; never follows a symlink and never recurses by itself. */
async function describeEntry(
  fs: FsPort,
  path: string,
  relativePath: string,
  listed: DirEntry,
  category: CleanupCategory,
  archived: boolean,
  realWorkRoot: string | null,
): Promise<CleanupScannedEntry> {
  const issues: string[] = [];
  const kind = listed.kind;
  let mtimeMs: number | null = null;
  let bytes = 0;
  let files = 0;
  let directories = 0;

  const stat = await fs.stat(path);
  if (stat.ok) {
    mtimeMs = stat.value.mtimeMs;
    if (kind === "file") {
      bytes = stat.value.size;
      files = 1;
    }
  } else {
    issues.push(`cannot stat: ${formatFailure(stat.error)}`);
  }

  if (kind === "directory") {
    const measured = await measureTree(fs, path);
    if (measured.ok) {
      files = measured.value.files;
      directories = measured.value.directories;
      bytes = measured.value.bytes;
    } else {
      issues.push(`cannot measure tree: ${formatFailure(measured.error)}`);
    }
  }

  if (kind === "symlink") {
    issues.push("symbolic link: its target is not verified, so it is never deleted");
  } else if (kind === "other") {
    issues.push("not a regular file or directory: never deleted");
  }

  let realPath: string | null = null;
  let insideWorkRoot = false;
  if (kind === "file" || kind === "directory") {
    const resolved = await fs.realPath(path);
    if (!resolved.ok) {
      issues.push(`cannot resolve real path: ${formatFailure(resolved.error)}`);
    } else if (realWorkRoot === null) {
      issues.push("work root has no resolved path, so containment cannot be verified");
    } else {
      realPath = resolved.value;
      insideWorkRoot = isInsidePath(resolved.value, realWorkRoot) && !samePath(resolved.value, realWorkRoot);
      if (!insideWorkRoot) issues.push(`resolves outside the work root: ${resolved.value}`);
    }
  }

  return {
    path,
    relativePath,
    category,
    archived,
    kind,
    mtimeMs,
    bytes,
    files,
    directories,
    realPath,
    insideWorkRoot,
    problem: issues.length === 0 ? null : issues.join("; "),
  };
}

/**
 * List the work root, classify its direct children, and measure each one.
 *
 * A missing work root is `exists: false` with no entries: cleanup on a fresh
 * checkout must succeed and touch nothing. Unreadable containers are recorded in
 * `problems` instead of throwing, so the command can still report the entries it
 * did see and exit non-zero.
 */
export async function scanWorkRoot(fs: FsPort, workRoot: string): Promise<CleanupScan> {
  if (!(await fs.exists(workRoot))) {
    return { workRoot, exists: false, realWorkRoot: null, entries: [], problems: [] };
  }

  const rootStat = await fs.stat(workRoot);
  if (!rootStat.ok) {
    return {
      workRoot,
      exists: true,
      realWorkRoot: null,
      entries: [],
      problems: [`cannot stat work root: ${formatFailure(rootStat.error)}`],
    };
  }
  if (rootStat.value.kind !== "directory") {
    return {
      workRoot,
      exists: true,
      realWorkRoot: null,
      entries: [],
      problems: [`work root is a ${rootStat.value.kind}, not a directory`],
    };
  }

  const resolvedRoot = await fs.realPath(workRoot);
  const realWorkRoot = resolvedRoot.ok ? resolvedRoot.value : null;
  const problems: string[] = [];
  if (!resolvedRoot.ok) {
    problems.push(`cannot resolve work root: ${formatFailure(resolvedRoot.error)}`);
  }

  const listed = await fs.list(workRoot);
  if (!listed.ok) {
    problems.push(`cannot list work root: ${formatFailure(listed.error)}`);
    return { workRoot, exists: true, realWorkRoot, entries: [], problems };
  }

  const entries: CleanupScannedEntry[] = [];
  for (const child of [...listed.value].sort(byName)) {
    const childPath = joinFsPath(workRoot, child.name);
    const known = KNOWN_ROOTS.get(child.name);

    if (known === undefined) {
      entries.push(await describeEntry(fs, childPath, child.name, child, "unknown", false, realWorkRoot));
      continue;
    }

    if (child.kind !== "directory") {
      // A known name that is not a directory is not a container this build
      // created. Report it; do not reinterpret it as a deletable unit.
      const described = await describeEntry(fs, childPath, child.name, child, "unknown", false, realWorkRoot);
      const knownRootProblem = `known root ${child.name} is a ${child.kind}, not a directory`;
      entries.push({
        ...described,
        problem: described.problem === null ? knownRootProblem : `${described.problem}; ${knownRootProblem}`,
      });
      continue;
    }

    const nested = await fs.list(childPath);
    if (!nested.ok) {
      problems.push(`cannot list ${child.name}: ${formatFailure(nested.error)}`);
      continue;
    }
    for (const item of [...nested.value].sort(byName)) {
      const itemPath = joinFsPath(childPath, item.name);
      entries.push(
        await describeEntry(
          fs,
          itemPath,
          `${child.name}/${item.name}`,
          item,
          known.category,
          known.archived,
          realWorkRoot,
        ),
      );
    }
  }

  return { workRoot, exists: true, realWorkRoot, entries, problems };
}
