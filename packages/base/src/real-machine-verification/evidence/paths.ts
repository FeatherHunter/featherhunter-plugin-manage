/**
 * Path and name rules for evidence files and archives.
 *
 * Why this file exists: evidence is the one part of a verification run whose
 * file names come from outside — a scenario, a profile, a CLI flag, or the
 * filesystem the evidence was copied from. Turning such a name into a path and
 * deciding whether that path is allowed are the same decision, so they live
 * here instead of being re-derived (and eventually re-derived differently) at
 * every call site.
 *
 * Two policies are written down here rather than at the call sites:
 *
 * - SHA256SUMS.txt is a wire format: one line per file, `<sha256>  <path>`
 *   (exactly two spaces), sorted by path using the platform-independent UTF-16
 *   code-unit order `Array.prototype.sort` uses, `/`-separated paths relative
 *   to the archive root, and *every line ends with `\n`* — including the last
 *   one. An archive with no files has a zero-byte SHA256SUMS.txt. `sha256sum
 *   -c` accepts both spellings, but the bytes are only reproducible if the
 *   trailing newline is decided once, here.
 * - Archive metadata names are reserved: `SHA256SUMS.txt` at the archive root
 *   and the `notes/` directory are not evidence and never appear in the digest.
 */

import { SHA256_RE } from "../contracts/branding";
import { isSafeEvidencePath } from "../contracts/evidence-contract";
import { err, failure, ok, type Result } from "../contracts/result";
import { isWindowsAbsolute, joinFsPath, toPosixPath as convertToPosixPath } from "../runtime/paths";

/** Directory name of the evidence package inside a batch directory. */
export const EVIDENCE_DIRNAME = "evidence";
/** Directory name of the evidence payload files inside the evidence package. */
export const EVIDENCE_FILES_DIRNAME = "files";
/** File name of the checksum list at an archive root. */
export const SHA256SUMS_FILENAME = "SHA256SUMS.txt";
/** Directory name of archive annotations (corrections live here, never in the originals). */
export const ARCHIVE_NOTES_DIRNAME = "notes";
/** Default archive root directory, relative to the work root. */
export const DEFAULT_ARCHIVE_ROOT_DIRNAME = "evidence-archive";
/** Line terminator of SHA256SUMS.txt; written after every line, including the last. */
export const SHA256SUMS_LINE_TERMINATOR = "\n";
/** Highest ordinal suffix used when a name is already taken. */
export const MAX_EVIDENCE_ORDINAL = 999;

const WINDOWS_ABSOLUTE_PREFIX = /^[A-Za-z]:[\\/]/;
const UNC_PREFIX = "\\\\";

/** True when `value` is absolute in either Windows or POSIX style. */
function looksAbsolute(value: string): boolean {
  return (
    WINDOWS_ABSOLUTE_PREFIX.test(value) ||
    value.startsWith(UNC_PREFIX) ||
    value.startsWith("//") ||
    value.startsWith("/")
  );
}

interface NormalizedPath {
  readonly rooted: boolean;
  readonly segments: readonly string[];
}

/**
 * Normalize a path into rootedness + segments without touching the filesystem.
 * `..` is applied to the preceding segment (never above the drive/root), which
 * is what a filesystem would do; this is the containment check, not a resolver.
 */
function normalizePath(value: string): NormalizedPath {
  const posix = convertToPosixPath(value);
  const head = posix.split("/")[0] ?? "";
  const driveFloor = /^[A-Za-z]:$/.test(head) ? 1 : 0;
  const segments: string[] = [];
  for (const raw of posix.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      if (segments.length > driveFloor) segments.pop();
      continue;
    }
    segments.push(raw);
  }
  return {
    rooted: posix.startsWith("/") || driveFloor === 1 || posix.startsWith("//"),
    segments,
  };
}

/**
 * True when `target` resolves inside `root` (or is `root` itself).
 * Used as a second line of defense after explicit `..` rejection.
 */
export function isWithinPath(root: string, target: string): boolean {
  if (root.length === 0 || target.length === 0) return false;
  const resolved = looksAbsolute(target) ? target : joinFsPath(root, target);
  const parent = normalizePath(root);
  const child = normalizePath(resolved);
  if (parent.rooted !== child.rooted) return false;
  const foldCase = isWindowsAbsolute(root) || isWindowsAbsolute(resolved);
  const parentSegments = parent.segments.map((segment) => (foldCase ? segment.toLowerCase() : segment));
  const childSegments = child.segments.map((segment) => (foldCase ? segment.toLowerCase() : segment));
  if (childSegments.length < parentSegments.length) return false;
  return parentSegments.every((segment, index) => childSegments[index] === segment);
}

/**
 * Turn a caller-supplied relative path into an absolute path under `root`, or
 * explain why it is not allowed. Never touches the filesystem.
 */
export function assertWithin(root: string, target: string): Result<string> {
  if (typeof target !== "string" || target.length === 0) {
    return err(
      failure("invalid-input", "目标路径不能为空", "证据文件名必须是一个相对路径，例如 files/screenshot.png"),
    );
  }
  if (looksAbsolute(target)) {
    return err(
      failure("invalid-input", `拒绝绝对路径：${target}`, "证据文件必须写在批次目录内；绝对路径会绕过根目录约束"),
    );
  }
  const segments = convertToPosixPath(target)
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return err(failure("invalid-input", `拒绝路径 ${target}`, "该路径无法指向一个证据文件"));
  }
  const resolved = joinFsPath(root, target);
  if (!isWithinPath(root, resolved)) {
    return err(
      failure(
        "invalid-input",
        `路径越界：${target}`,
        "路径解析后落在根目录之外（通常来自 ../ 或指向目录外的链接），已拒绝写入",
      ),
    );
  }
  return ok(resolved);
}

/** Convert Windows separators to `/` (evidence paths are always wire-style). */
export function toPosixPath(value: string): string {
  return value.split("\\").join("/");
}

/**
 * Insert an ordinal suffix before the extension: `note.txt` → `note-2.txt`.
 * Ordinal 1 is the bare name, which keeps the first file in a batch tidy.
 */
export function withOrdinal(name: string, ordinal: number): string {
  if (ordinal <= 1) return name;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}-${ordinal}`;
  return `${name.slice(0, dot)}-${ordinal}${name.slice(dot)}`;
}

/** True when `value` may be stored as an evidence path (safe and `/`-separated). */
export function isRecordableEvidencePath(value: string): boolean {
  return isSafeEvidencePath(value) && !value.includes("\\");
}

/** True for archive metadata paths that never join the digest. */
export function isReservedArchivePath(path: string): boolean {
  return (
    path === SHA256SUMS_FILENAME ||
    path === ARCHIVE_NOTES_DIRNAME ||
    path.startsWith(`${ARCHIVE_NOTES_DIRNAME}/`)
  );
}

/** Evidence path of a payload file, relative to the evidence package root. */
export function evidenceFilesRelativePath(fileName: string): string {
  return `${EVIDENCE_FILES_DIRNAME}/${fileName}`;
}

/**
 * Turn an arbitrary source file name into a name that is safe to store under
 * `files/`. The result always starts with an alphanumeric character, keeps a
 * short extension, and drops path parts so a source outside the batch cannot
 * smuggle a directory in.
 */
export function sanitizeEvidenceFileName(fileName: string): string {
  const posix = convertToPosixPath(fileName);
  const base = posix.slice(posix.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < base.length - 1;
  const rawStem = hasExtension ? base.slice(0, dot) : base;
  const rawExtension = hasExtension ? base.slice(dot + 1) : "";
  const stem = toSafeStem(rawStem);
  const extension = rawExtension.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  return extension.length === 0 ? stem : `${stem}.${extension}`;
}

function toSafeStem(raw: string): string {
  let cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 96);
  if (cleaned.length === 0) cleaned = "evidence";
  if (!/^[A-Za-z0-9]/.test(cleaned)) cleaned = `evidence-${cleaned}`.slice(0, 96);
  return cleaned;
}

/** One entry of SHA256SUMS.txt, before rendering. */
export interface Sha256SumEntry {
  readonly path: string;
  readonly sha256: string;
}

/**
 * Render SHA256SUMS.txt exactly as the format policy above describes:
 * path-sorted, `<sha256>  <path>` per line, every line `\n`-terminated, and a
 * zero-byte file when there is nothing to list.
 */
export function renderSha256Sums(entries: readonly Sha256SumEntry[]): Result<string> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!SHA256_RE.test(entry.sha256)) {
      return err(
        failure(
          "invalid-input",
          `摘要条目含非法的 sha256：${entry.path}`,
          "SHA256SUMS.txt 只接受 64 位小写十六进制摘要",
        ),
      );
    }
    if (!isRecordableEvidencePath(entry.path)) {
      return err(
        failure(
          "invalid-input",
          `摘要条目路径不合法：${entry.path}`,
          "摘要中的路径必须是以 / 分隔、落在归档根内的相对路径",
        ),
      );
    }
    if (isReservedArchivePath(entry.path)) {
      return err(
        failure(
          "invalid-input",
          `摘要条目使用了归档保留路径：${entry.path}`,
          "SHA256SUMS.txt 与 notes/ 是归档元数据，不参与摘要",
        ),
      );
    }
    if (seen.has(entry.path)) {
      return err(failure("invalid-input", `摘要条目路径重复：${entry.path}`, "每个文件在 SHA256SUMS.txt 中只能出现一次"));
    }
    seen.add(entry.path);
  }
  const sorted = [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return ok(sorted.map((entry) => `${entry.sha256}  ${entry.path}${SHA256SUMS_LINE_TERMINATOR}`).join(""));
}

/**
 * Directory name of a new archive: `<batchName>-<timestamp>`, with the
 * timestamp reduced to a path-safe segment using the same character rule as run
 * ids in orchestration/run-directory.ts. Collisions inside one second are
 * resolved by appending `-2`, `-3`, ... (see archive.ts).
 */
export function archiveDirectoryBaseName(batchName: string, isoTimestamp: string): string {
  const stamp = isoTimestamp
    .replace(/[^0-9A-Za-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${batchName}-${stamp.length === 0 ? "archive" : stamp}`;
}
