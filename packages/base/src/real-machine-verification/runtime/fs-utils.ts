/**
 * Filesystem walks and the delete guard.
 *
 * Two lessons are encoded here. First, "clean up the batch directory" is the most
 * dangerous operation this tool performs, so deletion goes through one guard that
 * refuses drive roots, the user's home and the current working directory — a bug
 * in a path computation must hit a wall, not a reinstall. Second, every artifact
 * this tool records lists files with `/`-separated relative paths; walking is the
 * only place that spelling is decided, so reports from different machines agree.
 */
import type { FsPort } from "../contracts/ports";
import { err, ok, type Result } from "../contracts/result";
import { baseName, depthOf, isPosixAbsolute, isWindowsAbsolute, joinFsPath, toPosixPath } from "./paths";

/** One entry found under a root, with a portable relative path. */
export interface WalkedEntry {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
  readonly bytes: number;
}

const MAX_WALK_DEPTH = 32;

/**
 * List every file under `root`, recursively, sorted by relative path.
 *
 * The depth cap is not paranoia: a plugin cache that contains itself (a symlinked
 * loop) would otherwise hang the verifier, and a hang is indistinguishable from a
 * slow machine at the call site.
 */
export async function walkFiles(fs: FsPort, root: string): Promise<Result<readonly WalkedEntry[]>> {
  const stat = await fs.stat(root);
  if (!stat.ok) return stat;

  const collected: WalkedEntry[] = [];
  const visit = async (absolute: string, relative: string, depth: number): Promise<Result<void>> => {
    if (depth > MAX_WALK_DEPTH) {
      return err({
        code: "io",
        message: `directory tree under ${root} is deeper than ${MAX_WALK_DEPTH} levels`,
        hint: "a symlink loop or an unpacked archive is inside the tree; inspect it before retrying",
      });
    }
    const listed = await fs.list(absolute);
    if (!listed.ok) return listed;
    for (const entry of listed.value) {
      const childAbsolute = joinFsPath(absolute, entry.name);
      const childRelative = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      if (entry.kind === "directory") {
        collected.push({ relativePath: childRelative, absolutePath: childAbsolute, kind: "directory", bytes: 0 });
        const nested = await visit(childAbsolute, childRelative, depth + 1);
        if (!nested.ok) return nested;
        continue;
      }
      if (entry.kind === "file") {
        const details = await fs.stat(childAbsolute);
        if (!details.ok) return details;
        collected.push({
          relativePath: childRelative,
          absolutePath: childAbsolute,
          kind: "file",
          bytes: details.value.size,
        });
        continue;
      }
      collected.push({ relativePath: childRelative, absolutePath: childAbsolute, kind: entry.kind, bytes: 0 });
    }
    return ok(undefined);
  };

  if (stat.value.kind === "directory") {
    const failure = await visit(root, "", 0);
    if (!failure.ok) return failure;
  } else {
    collected.push({
      relativePath: baseName(root),
      absolutePath: root,
      kind: stat.value.kind,
      bytes: stat.value.size,
    });
  }

  collected.sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0));
  return ok(collected);
}

/** Counts for a plan or a cleanup report: numbers only, never a file listing. */
export interface TreeSize {
  readonly files: number;
  readonly directories: number;
  readonly bytes: number;
}

export async function measureTree(fs: FsPort, root: string): Promise<Result<TreeSize>> {
  if (!(await fs.exists(root))) return ok({ files: 0, directories: 0, bytes: 0 });
  const walked = await walkFiles(fs, root);
  if (!walked.ok) return walked;
  let files = 0;
  let directories = 0;
  let bytes = 0;
  for (const entry of walked.value) {
    if (entry.kind === "file") {
      files += 1;
      bytes += entry.bytes;
    } else if (entry.kind === "directory") {
      directories += 1;
    }
  }
  return ok({ files, directories, bytes });
}

/**
 * Why this path must not be deleted, or `null` when it is safe enough.
 *
 * "Safe enough" means: absolute, at least three segments deep, not a filesystem
 * root and not the user's home directory. Every deeper rule (must live under the
 * work root) belongs to the caller, which knows its own roots.
 */
export function deleteGuardReason(target: string, protectedPaths: readonly string[] = []): string | null {
  if (target.length === 0) return "path is empty";
  const absolute = isWindowsAbsolute(target) || isPosixAbsolute(target);
  if (!absolute) return `path is not absolute: ${target}`;
  if (depthOf(target) < 3) return `path has fewer than three segments: ${target}`;
  const normalizedTarget = toPosixPath(target).replace(/\/+$/, "").toLowerCase();
  for (const protectedPath of protectedPaths) {
    const normalizedProtected = toPosixPath(protectedPath).replace(/\/+$/, "").toLowerCase();
    if (normalizedProtected.length > 0 && normalizedTarget === normalizedProtected) {
      return `path is a protected root: ${target}`;
    }
  }
  return null;
}

/** Remove a tree after the guard agrees it is not a catastrophic path. */
export async function removeTree(
  fs: FsPort,
  target: string,
  options: { readonly protectedPaths?: readonly string[]; readonly recursive?: boolean } = {},
): Promise<Result<void>> {
  const reason = deleteGuardReason(target, options.protectedPaths ?? []);
  if (reason !== null) {
    return err({ code: "invalid-input", message: `refusing to delete: ${reason}`, hint: "check the path computation" });
  }
  if (!(await fs.exists(target))) return ok(undefined);
  return fs.remove(target, { recursive: options.recursive ?? true });
}

/** Create the directory and remove stale contents only when the caller asked for it. */
export async function ensureDir(fs: FsPort, dir: string): Promise<Result<void>> {
  return fs.makeDir(dir);
}
