/**
 * Immutable archival of one batch's evidence directory.
 *
 * Archiving is a copy, never a move, and an archive directory is never written
 * again after it is finished: a later correction goes into `notes/` as a
 * sidecar, because the report that quoted the archive must keep matching it.
 * That is why the destination name gets an ordinal when two archives happen in
 * the same second (`<batch>-<stamp>`, then `<batch>-<stamp>-2`, ...) instead of
 * reusing or replacing a directory.
 *
 * SHA256SUMS.txt is written for the copied files, not for the source files; the
 * copies are re-hashed and compared before the checksum list is written, so a
 * checksum list can never describe bytes the archive does not contain.
 */

import { parseBatchName, type Sha256Hex } from "../contracts/branding";
import { digestOfFiles, sha256Text } from "../contracts/identity";
import type { ClockPort, FsPort } from "../contracts/ports";
import { err, failure, ok, type Result } from "../contracts/result";
import { walkFiles, type WalkedEntry } from "../runtime/fs-utils";
import { joinFsPath } from "../runtime/paths";
import {
  ARCHIVE_NOTES_DIRNAME,
  MAX_EVIDENCE_ORDINAL,
  SHA256SUMS_FILENAME,
  archiveDirectoryBaseName,
  isRecordableEvidencePath,
  isReservedArchivePath,
  renderSha256Sums,
  withOrdinal,
} from "./paths";

/** One file as it exists inside the finished archive. */
export interface ArchivedEvidenceFile {
  /** Path relative to the archive root, `/`-separated. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256Hex;
}

/** Result of a successful archive. Everything a caller needs to report it. */
export interface EvidenceArchiveResult {
  readonly directory: string;
  readonly batchName: string;
  readonly batchDir: string;
  readonly createdAt: string;
  readonly files: readonly ArchivedEvidenceFile[];
  readonly sumsPath: string;
  readonly sumsSha256: Sha256Hex;
  /** Digest of the archived file set, computed with `digestOfFiles`'s wire format. */
  readonly fileDigest: Sha256Hex;
  readonly copied: {
    readonly files: number;
    readonly bytes: number;
  };
}

/** Inputs of `archiveEvidence`; all paths are absolute and already normalized by the caller layer. */
export interface ArchiveEvidenceOptions {
  readonly fs: FsPort;
  readonly clock: ClockPort;
  /** Batch directory (the whole tree below it is archived). */
  readonly batchDir: string;
  readonly batchName: string;
  readonly archiveRoot: string;
}

function joinRelativePath(root: string, relativePath: string): string {
  return relativePath.split("/").reduce((current, segment) => joinFsPath(current, segment), root);
}

/** Everything archive decides before it writes: source files and destination. */
export interface EvidenceArchivePlan {
  readonly batchName: string;
  readonly batchDir: string;
  readonly archiveRoot: string;
  readonly createdAt: string;
  readonly baseName: string;
  readonly directory: string;
  readonly entries: readonly WalkedEntry[];
  readonly files: readonly ArchivedEvidenceFile[];
  readonly copied: {
    readonly files: number;
    readonly bytes: number;
  };
  readonly fileDigest: Sha256Hex;
}

/**
 * Hash the batch and choose the archive directory without creating either.
 *
 * `--dry-run` prints this plan; `archiveEvidence` writes exactly this plan.
 */
export async function planEvidenceArchive(
  options: ArchiveEvidenceOptions,
): Promise<Result<EvidenceArchivePlan>> {
  const { fs, clock, batchDir, archiveRoot } = options;
  const batchName = parseBatchName(options.batchName);
  if (!batchName.ok) return batchName;
  if (batchDir.length === 0) {
    return err(failure("invalid-input", "批次目录为空", "请传入批次目录（<workRoot>/batches/<批次名>）"));
  }
  if (archiveRoot.length === 0) {
    return err(failure("invalid-input", "归档根目录为空", "请传入归档根目录（默认 <workRoot>/evidence-archive）"));
  }
  const batchStat = await fs.stat(batchDir);
  if (!batchStat.ok) {
    return err(
      failure("not-found", `批次目录不存在：${batchDir}`, "先运行证据采集（dsh-verify evidence add）再归档", {
        batchDir,
      }),
    );
  }
  if (batchStat.value.kind !== "directory") {
    return err(failure("invalid-input", `批次路径不是目录：${batchDir}`, "archive 只接受批次目录", { batchDir }));
  }
  const walked = await walkFiles(fs, batchDir);
  if (!walked.ok) return walked;
  const entries = walked.value;
  const files: ArchivedEvidenceFile[] = [];
  for (const entry of entries) {
    if (entry.kind === "directory") continue;
    if (entry.kind !== "file") {
      return err(
        failure(
          "invalid-input",
          `批次目录含不支持的文件类型：${entry.relativePath}`,
          "归档只接受普通文件与目录；符号链接请先物化为真实文件",
          { path: entry.relativePath },
        ),
      );
    }
    if (!isRecordableEvidencePath(entry.relativePath) || isReservedArchivePath(entry.relativePath)) {
      return err(
        failure(
          "invalid-input",
          `批次目录含保留或非法路径：${entry.relativePath}`,
          "SHA256SUMS.txt 与 notes/ 是归档元数据，不能出现在批次目录中",
          { path: entry.relativePath },
        ),
      );
    }
    const hashed = await fs.hashFile(entry.absolutePath);
    if (!hashed.ok) return hashed;
    files.push({ path: entry.relativePath, bytes: entry.bytes, sha256: hashed.value });
  }
  const createdAt = clock.iso();
  const baseName = archiveDirectoryBaseName(batchName.value, createdAt);
  let directory = "";
  for (let ordinal = 1; ordinal <= MAX_EVIDENCE_ORDINAL; ordinal += 1) {
    const candidate = joinFsPath(archiveRoot, ordinal === 1 ? baseName : `${baseName}-${ordinal}`);
    if (await fs.exists(candidate)) continue;
    directory = candidate;
    break;
  }
  if (directory === "") {
    return err(
      failure(
        "conflict",
        `归档目录序号已用尽：${baseName}`,
        "同一秒内已归档 999 次；等待下一秒或用 --archive-root 换一个归档根",
        { archiveRoot, baseName },
      ),
    );
  }
  const digest = digestOfFiles(files.map((file) => ({ path: file.path, size: file.bytes, sha256: file.sha256 })));
  if (!digest.ok) return digest;
  return ok({
    batchName: batchName.value,
    batchDir,
    archiveRoot,
    createdAt,
    baseName,
    directory,
    entries,
    files,
    copied: {
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
    },
    fileDigest: digest.value,
  });
}

/**
 * Copy `batchDir` into the planned archive directory and write a path-sorted
 * SHA256SUMS.txt for the copied files.
 */
export async function archiveEvidence(options: ArchiveEvidenceOptions): Promise<Result<EvidenceArchiveResult>> {
  const { fs } = options;
  const planned = await planEvidenceArchive(options);
  if (!planned.ok) return planned;
  const plan = planned.value;
  const directory = plan.directory;
  const createdRoot = await fs.makeDir(plan.archiveRoot);
  if (!createdRoot.ok) return createdRoot;
  const madeDirectory = await fs.makeDir(directory);
  if (!madeDirectory.ok) return madeDirectory;
  const entries = plan.entries;
  const files = plan.files;
  const discardPartial = async (): Promise<void> => {
    await fs.remove(directory, { recursive: true });
  };
  const sourceSha = new Map(files.map((file) => [file.path, file.sha256]));
  // walkFiles sorts parents before children, so one pass creates every directory
  // before the files that need it.
  for (const entry of entries) {
    const targetPath = joinRelativePath(directory, entry.relativePath);
    if (entry.kind === "directory") {
      const made = await fs.makeDir(targetPath);
      if (!made.ok) {
        await discardPartial();
        return made;
      }
      continue;
    }
    const copied = await fs.copy(entry.absolutePath, targetPath, { recursive: false });
    if (!copied.ok) {
      await discardPartial();
      return copied;
    }
    const copiedHash = await fs.hashFile(targetPath);
    if (!copiedHash.ok) {
      await discardPartial();
      return copiedHash;
    }
    const expected = sourceSha.get(entry.relativePath);
    if (copiedHash.value !== expected) {
      await discardPartial();
      return err(
        failure(
          "io",
          `归档复制后哈希不一致：${entry.relativePath}`,
          "源文件在复制过程中被改动，或文件系统不可靠；请重试归档",
          { path: entry.relativePath, expected, actual: copiedHash.value },
        ),
      );
    }
  }
  const sums = renderSha256Sums(files.map((file) => ({ path: file.path, sha256: file.sha256 })));
  if (!sums.ok) {
    await discardPartial();
    return sums;
  }
  const sumsPath = joinFsPath(directory, SHA256SUMS_FILENAME);
  const writtenSums = await fs.writeText(sumsPath, sums.value);
  if (!writtenSums.ok) {
    await discardPartial();
    return writtenSums;
  }
  return ok({
    directory,
    batchName: plan.batchName,
    batchDir: plan.batchDir,
    createdAt: plan.createdAt,
    files,
    sumsPath,
    sumsSha256: sha256Text(sums.value),
    fileDigest: plan.fileDigest,
    copied: plan.copied,
  });
}

/** Inputs of `writeArchiveNote`. */
export interface WriteArchiveNoteOptions {
  readonly fs: FsPort;
  readonly clock: ClockPort;
  /** The archive directory (must already contain SHA256SUMS.txt). */
  readonly archiveDir: string;
  readonly note: string;
  readonly author?: string;
}

/** Result of writing a sidecar note; `path` is archive-relative. */
export interface WrittenArchiveNote {
  readonly path: string;
  readonly absolutePath: string;
  readonly sha256: Sha256Hex;
  readonly content: string;
}

function renderArchiveNoteContent(note: string, author: string | undefined, recordedAt: string): string {
  return (
    [
      "# 证据归档旁注",
      "",
      `- 记录时间: ${recordedAt}`,
      `- 作者: ${author ?? "unspecified"}`,
      "",
      "## 说明",
      "",
      note,
      "",
      "> 旁注是对归档的补充说明，不改动归档原件；原件哈希见 ../SHA256SUMS.txt。",
      "",
    ].join("\n")
  );
}

/**
 * Add a correction as a sidecar file under `notes/`.
 *
 * The originals in the archive stay byte-identical; that is the whole point.
 * Returns a failure when the directory is not a valid archive, so a note can
 * never be mistaken for evidence in a random directory.
 */
export async function writeArchiveNote(
  options: WriteArchiveNoteOptions,
): Promise<Result<WrittenArchiveNote>> {
  const { fs, clock, archiveDir } = options;
  if (archiveDir.length === 0) {
    return err(failure("invalid-input", "归档目录为空", "请传入归档目录"));
  }
  if (options.note.trim().length === 0) {
    return err(failure("invalid-input", "旁注内容为空", "旁注至少要写清楚更正了什么"));
  }
  const sumsPath = joinFsPath(archiveDir, SHA256SUMS_FILENAME);
  if (!(await fs.exists(sumsPath))) {
    return err(
      failure(
        "prerequisite",
        `不是有效的证据归档：${archiveDir}`,
        "旁注只能写在已归档且带 SHA256SUMS.txt 的目录里；归档本身不可修改",
        { archiveDir },
      ),
    );
  }
  const notesDir = joinFsPath(archiveDir, ARCHIVE_NOTES_DIRNAME);
  const made = await fs.makeDir(notesDir);
  if (!made.ok) return made;
  const recordedAt = clock.iso();
  const baseName = `${archiveDirectoryBaseName("note", recordedAt)}.md`;
  let fileName = "";
  for (let ordinal = 1; ordinal <= MAX_EVIDENCE_ORDINAL; ordinal += 1) {
    const candidate = withOrdinal(baseName, ordinal);
    if (await fs.exists(joinFsPath(notesDir, candidate))) continue;
    fileName = candidate;
    break;
  }
  if (fileName === "") {
    return err(
      failure("conflict", "旁注序号已用尽", "同一秒内已写 999 条旁注；等待下一秒再写", { archiveDir }),
    );
  }
  const content = renderArchiveNoteContent(options.note, options.author, recordedAt);
  const absolutePath = joinFsPath(notesDir, fileName);
  const written = await fs.writeText(absolutePath, content);
  if (!written.ok) return written;
  return ok({
    path: `${ARCHIVE_NOTES_DIRNAME}/${fileName}`,
    absolutePath,
    sha256: sha256Text(content),
    content,
  });
}
