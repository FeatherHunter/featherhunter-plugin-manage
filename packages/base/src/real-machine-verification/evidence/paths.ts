/**
 * Path containment for evidence collection.
 *
 * Why this file exists: evidence is the one part of a verification run that
 * writes files whose *names* come from outside — a scenario, a profile or a CLI
 * flag chooses them — and a batch directory is frequently supplied on a command
 * line. Turning such a name into a path and deciding whether that path is
 * allowed are the same decision, so they live in one function here instead of
 * being re-derived (and eventually re-derived wrongly) at every call site.
 *
 * The rule enforced: a target is allowed only when it is *relative* and, after
 * normalization, still resolves below the root. Absolute paths are rejected
 * rather than re-anchored, because `path.resolve(root, "/etc/passwd")` silently
 * discards the root — a check that "resolves fine" would still be an escape.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

import { isSafeEvidencePath } from "../contracts/evidence-contract";
import { failure, err, ok, type Result } from "../contracts/result";

/** Cross-platform "this looks absolute" test, so a Windows path is refused on POSIX too. */
function looksAbsolute(value: string): boolean {
  return (
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//")
  );
}

/**
 * True when `target` (absolute, or resolved against `root` when relative) sits
 * below `root`. `root` itself counts as inside: callers that need a strict child
 * reject equality themselves.
 */
export function isWithinPath(root: string, target: string): boolean {
  const rootAbs = resolve(root);
  const targetAbs = resolve(rootAbs, target);
  const rel = relative(rootAbs, targetAbs);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

/**
 * Resolve a caller-supplied relative target below `root`, or explain why it was
 * refused. Rejecting the input is the point: a collector that "just sanitizes"
 * a traversal attempt hides the fact that a caller tried to write outside the
 * batch, and the resulting evidence package is worth less than a loud failure.
 */
export function assertWithin(root: string, target: string): Result<string> {
  if (typeof target !== "string" || target.length === 0) {
    return err(
      failure("invalid-input", "目标路径不能为空", "证据文件名必须是一个相对路径，例如 files/screenshot.png"),
    );
  }
  if (looksAbsolute(target)) {
    return err(
      failure(
        "invalid-input",
        `拒绝绝对路径：${JSON.stringify(target)}`,
        "证据文件必须写在批次目录内；绝对路径会绕过根目录约束",
        { target },
      ),
    );
  }
  if (target === "." || target === "..") {
    return err(failure("invalid-input", `拒绝路径 ${JSON.stringify(target)}`, "该路径无法指向一个证据文件"));
  }
  const resolved = resolve(root, target);
  if (!isWithinPath(root, resolved)) {
    return err(
      failure(
        "invalid-input",
        `路径越界：${JSON.stringify(target)}`,
        "路径解析后落在根目录之外（通常来自 ../ 或指向目录外的链接），已拒绝写入",
        { target },
      ),
    );
  }
  return ok(resolved);
}

/** Normalize a platform path to the `/`-separated form stored in evidence paths. */
export function toPosixPath(value: string): string {
  return value.split("\\").join("/");
}

/**
 * File name for the nth attempt at a requested name: `note.txt` -> `note-2.txt`.
 * The extension is preserved so a reader can still open the artifact.
 */
export function withOrdinal(name: string, ordinal: number): string {
  if (ordinal <= 1) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? "" : name.slice(dot);
  return `${stem}-${ordinal}${ext}`;
}

/** Validate the `/`-separated relative path of a recorded item. */
export function isRecordableEvidencePath(value: string): boolean {
  return isSafeEvidencePath(value) && !value.includes("\\");
}
