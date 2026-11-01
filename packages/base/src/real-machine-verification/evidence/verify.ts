/**
 * Verification of an evidence archive against its own SHA256SUMS.txt.
 *
 * The only trustworthy statement about an archive is "these bytes, in this
 * layout, hash to what the summary says". So verification is a recomputation,
 * not a trust exercise, and it reports four kinds of disagreement separately
 * because they mean different things:
 *
 * - `modified` — a listed file exists but hashes differently (tampering or
 *   corruption; the archive is no longer reproducible).
 * - `missing` — a listed file is gone.
 * - `extra` — a file exists in the archive that the summary does not list
 *   (something was dropped in after archiving).
 * - `malformed` — a summary line that is not `<sha256>  <path>`, or a path that
 *   violates the archive layout, or a duplicate. Format rot is reported even
 *   when every listed hash happens to check out.
 *
 * `notes/` and the root `SHA256SUMS.txt` are archive metadata: they are never
 * listed in the summary and never count as extra. Notes are returned separately
 * so a caller can render them without treating them as evidence.
 */

import { SHA256_RE, type Sha256Hex } from "../contracts/branding";
import type { FsPort } from "../contracts/ports";
import { err, failure, ok, type Result } from "../contracts/result";
import { walkFiles } from "../runtime/fs-utils";
import { joinFsPath } from "../runtime/paths";
import {
  ARCHIVE_NOTES_DIRNAME,
  SHA256SUMS_FILENAME,
  isRecordableEvidencePath,
  isReservedArchivePath,
} from "./paths";

/** The four ways an archive can disagree with its summary. */
export type EvidenceArchiveIssueKind = "modified" | "missing" | "extra" | "malformed";

/** One disagreement, shaped for both human lines and `--json`. */
export interface EvidenceArchiveIssue {
  readonly kind: EvidenceArchiveIssueKind;
  /** Archive-relative path, when the issue is about a file. */
  readonly path?: string;
  /** 1-based line number in SHA256SUMS.txt, for `malformed`. */
  readonly line?: number;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
  readonly hint?: string;
}

/** One accepted line of SHA256SUMS.txt. */
export interface Sha256SumsEntry {
  readonly path: string;
  readonly sha256: Sha256Hex;
  readonly line: number;
}

/** Parse result: usable entries plus format problems found along the way. */
export interface Sha256SumsParseResult {
  readonly entries: readonly Sha256SumsEntry[];
  readonly issues: readonly EvidenceArchiveIssue[];
}

function malformedIssue(lineNumber: number, detail: string, hint?: string): EvidenceArchiveIssue {
  return {
    kind: "malformed",
    line: lineNumber,
    message: `${SHA256SUMS_FILENAME} 第 ${lineNumber} 行格式不合法：${detail}`,
    ...(hint === undefined ? {} : { hint }),
  };
}

/**
 * Parse SHA256SUMS.txt strictly.
 *
 * The writer (see `renderSha256Sums`) terminates every line with `\n`, so a
 * well-formed file ends with exactly one newline; that final empty element is
 * dropped here. A missing final newline is tolerated (the last line is still
 * complete), but any other blank line is malformed. `\r` before the newline is
 * tolerated so a CRLF-transferred archive still verifies.
 */
export function parseSha256Sums(text: string): Sha256SumsParseResult {
  const entries: Sha256SumsEntry[] = [];
  const issues: EvidenceArchiveIssue[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      issues.push(malformedIssue(lineNumber, "空行", "摘要文件只允许文件末尾的一个换行；中间不能有空行"));
      return;
    }
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (match === null) {
      issues.push(
        malformedIssue(
          lineNumber,
          "应为 '<sha256>  <相对路径>'（64 位小写十六进制 + 两个空格 + 路径）",
          "手改摘要文件会让归档失去可校验性；恢复原件后重跑 archive",
        ),
      );
      return;
    }
    const sha256 = match[1] as Sha256Hex;
    const path = match[2] as string;
    if (path !== path.trim() || path.includes("\t")) {
      issues.push(malformedIssue(lineNumber, `路径含首尾空白或制表符：${JSON.stringify(path)}`));
      return;
    }
    if (!isRecordableEvidencePath(path) || isReservedArchivePath(path)) {
      issues.push(
        malformedIssue(
          lineNumber,
          `路径不合法或使用了归档保留路径：${path}`,
          "摘要只能列出归档根下的普通文件；SHA256SUMS.txt 与 notes/ 不参与摘要",
        ),
      );
      return;
    }
    if (seen.has(path)) {
      issues.push(malformedIssue(lineNumber, `路径重复：${path}`, "每个文件在 SHA256SUMS.txt 中只能出现一次"));
      return;
    }
    seen.add(path);
    entries.push({ path, sha256, line: lineNumber });
  });
  return { entries, issues };
}

/** Parsed-and-recomputed view of one archive. */
export interface EvidenceArchiveVerification {
  readonly directory: string;
  readonly sumsPath: string;
  /** How many listed entries were present and readable (modulo missing/malformed). */
  readonly checked: number;
  readonly ok: boolean;
  readonly issues: readonly EvidenceArchiveIssue[];
  readonly counts: Readonly<Record<EvidenceArchiveIssueKind, number>>;
  /** `notes/**` files, sorted; corrections, never evidence. */
  readonly annotations: readonly string[];
}

/** Inputs of `verifyEvidenceArchive`. */
export interface VerifyEvidenceArchiveOptions {
  readonly fs: FsPort;
  readonly directory: string;
}

function joinArchivePath(root: string, relativePath: string): string {
  return relativePath.split("/").reduce((current, segment) => joinFsPath(current, segment), root);
}

/**
 * Recompute every hash in the archive and report the four issue classes.
 * `err` is reserved for "cannot verify at all" (no directory, no summary file).
 */
export async function verifyEvidenceArchive(
  options: VerifyEvidenceArchiveOptions,
): Promise<Result<EvidenceArchiveVerification>> {
  const { fs, directory } = options;
  if (directory.length === 0) {
    return err(failure("invalid-input", "归档目录为空", "请传入归档目录（dsh-verify evidence verify --dir <dir>）"));
  }
  const directoryStat = await fs.stat(directory);
  if (!directoryStat.ok) {
    return err(failure("not-found", `归档目录不存在：${directory}`, "先运行 dsh-verify evidence archive", { directory }));
  }
  if (directoryStat.value.kind !== "directory") {
    return err(failure("invalid-input", `归档路径不是目录：${directory}`, "verify 只接受归档目录", { directory }));
  }
  const sumsPath = joinFsPath(directory, SHA256SUMS_FILENAME);
  const sumsText = await fs.readText(sumsPath);
  if (!sumsText.ok) {
    return err(
      failure(
        "not-found",
        `归档缺少 ${SHA256SUMS_FILENAME}：${directory}`,
        "verify 只校验由 archive 写出的归档；摘要文件是校验基准",
        { directory, sumsPath },
      ),
    );
  }
  const parsed = parseSha256Sums(sumsText.value);
  const issues: EvidenceArchiveIssue[] = [...parsed.issues];
  let checked = 0;
  for (const entry of parsed.entries) {
    const absolutePath = joinArchivePath(directory, entry.path);
    const fileStat = await fs.stat(absolutePath);
    if (!fileStat.ok) {
      issues.push({
        kind: "missing",
        path: entry.path,
        expected: entry.sha256,
        message: `摘要列出的文件缺失：${entry.path}`,
        hint: "归档应保持不变；如果这是有意的更正，应恢复原件并用 notes/ 写旁注",
      });
      continue;
    }
    if (fileStat.value.kind !== "file") {
      issues.push({
        kind: "modified",
        path: entry.path,
        expected: entry.sha256,
        message: `摘要列出的路径不是普通文件：${entry.path}`,
        hint: "归档内该路径被目录/链接替换了",
      });
      continue;
    }
    const hashed = await fs.hashFile(absolutePath);
    if (!hashed.ok) {
      issues.push({
        kind: "modified",
        path: entry.path,
        expected: entry.sha256,
        message: `无法读取摘要列出的文件：${entry.path}`,
      });
      continue;
    }
    checked += 1;
    if (hashed.value !== entry.sha256) {
      issues.push({
        kind: "modified",
        path: entry.path,
        expected: entry.sha256,
        actual: hashed.value,
        message: `文件内容与摘要不符：${entry.path}`,
        hint: "归档不可变；若这是有意更正，请恢复原件并在 notes/ 写旁注",
      });
    }
  }
  const walked = await walkFiles(fs, directory);
  if (!walked.ok) return walked;
  const listedPaths = new Set(parsed.entries.map((entry) => entry.path));
  const annotations: string[] = [];
  for (const entry of walked.value) {
    if (entry.kind === "directory") continue;
    if (entry.relativePath === SHA256SUMS_FILENAME) continue;
    if (listedPaths.has(entry.relativePath)) continue;
    if (entry.relativePath === ARCHIVE_NOTES_DIRNAME || entry.relativePath.startsWith(`${ARCHIVE_NOTES_DIRNAME}/`)) {
      if (entry.relativePath !== ARCHIVE_NOTES_DIRNAME) annotations.push(entry.relativePath);
      continue;
    }
    issues.push({
      kind: "extra",
      path: entry.relativePath,
      message: `归档里有摘要未列出的文件：${entry.relativePath}`,
      hint: "归档不可变；新文件应写进 notes/ 或用新的归档目录",
    });
  }
  const counts: Record<EvidenceArchiveIssueKind, number> = { modified: 0, missing: 0, extra: 0, malformed: 0 };
  for (const issue of issues) counts[issue.kind] += 1;
  return ok({
    directory,
    sumsPath,
    checked,
    ok: issues.length === 0,
    issues,
    counts,
    annotations: annotations.sort(),
  });
}
