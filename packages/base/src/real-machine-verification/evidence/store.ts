/**
 * Minimal evidence store: immutable files under one run's evidence directory.
 *
 * The capability's promise is "another machine can re-check this", which needs two
 * properties here and no more:
 *
 * - every item carries its sha256, so a reader can verify the bytes without
 *   trusting the report;
 * - a name is never reused. A second `environment` snapshot in the same run
 *   becomes `environment-2.json`, so a report that points at `environment.json`
 *   keeps pointing at the bytes it was written for.
 *
 * Archives, manifests and cross-batch verification are a later ticket's job
 * (ticket 07); this store deliberately does not grow a manifest format yet.
 */
import type { EvidenceItem, EvidenceItemRef, EvidenceKind } from "../contracts/evidence-contract";
import { EVIDENCE_STEM_RE, isSafeEvidencePath } from "../contracts/evidence-contract";
import { asEvidencePath } from "../contracts/branding";
import { sha256Text } from "../contracts/identity";
import type { ClockPort, FsPort } from "../contracts/ports";
import { err, failure, ok, type Result } from "../contracts/result";
import { joinFsPath, toPosixPath } from "../runtime/paths";

/** Extensions the store appends; text and JSON are the only shapes a check emits. */
const TEXT_EXTENSION = ".txt";
const JSON_EXTENSION = ".json";

/** Room for 999 items with the same stem; reaching the limit is a bug, not a case. */
const MAX_ORDINAL = 999;

export interface EvidenceRecordOptions {
  /** Overrides the default kind for `recordText` (e.g. `command` or `log-slice`). */
  readonly kind?: EvidenceKind;
  /** Human sentence stored in the item, mirroring the check's `detail`. */
  readonly note?: string;
  /** Overrides the clock; tests pin it so `capturedAt` is deterministic. */
  readonly capturedAt?: string;
}

/** Options for adopting a file that was written by someone else (an adapter's screenshot). */
export interface EvidenceFileOptions {
  /** Defaults from the extension: images are `screenshot`, `.json` is `json`, the rest `file`. */
  readonly kind?: EvidenceKind;
  /** Human sentence stored in the item, mirroring the check's `detail`. */
  readonly note?: string;
  /** Overrides the clock; tests pin it so `capturedAt` is deterministic. */
  readonly capturedAt?: string;
}

/** One run's evidence directory, with the items recorded so far. */
export interface EvidenceStore {
  /** Absolute directory the items are written to. */
  readonly root: string;
  /** Items in recording order (a copy, so callers cannot mutate the log). */
  items(): readonly EvidenceItem[];
  recordText(name: string, content: string, options?: EvidenceRecordOptions): Promise<Result<EvidenceItem>>;
  recordJson(name: string, value: unknown, options?: EvidenceRecordOptions): Promise<Result<EvidenceItem>>;
  /**
   * Adopt a file that already exists under `root`, measuring and hashing the
   * bytes on disk. This is how an artifact written by a port (the browser's
   * screenshot) enters the evidence log: a path in a report without a digest is
   * not evidence, because a reader cannot tell whether the bytes changed.
   *
   * The file is not renamed or copied. Adopting the same path twice is
   * idempotent when the bytes still match, and a conflict when they do not — an
   * item path must never refer to two different byte strings.
   */
  recordFile(path: string, options?: EvidenceFileOptions): Promise<Result<EvidenceItem>>;
}

export interface CreateEvidenceStoreOptions {
  readonly fs: FsPort;
  readonly root: string;
  readonly clock: ClockPort;
}

/** Trim the full items down to the references a `CheckResult` carries. */
export function evidenceRefs(items: readonly EvidenceItem[]): readonly EvidenceItemRef[] {
  return items.map((item) => ({ path: item.path, sha256: item.sha256, kind: item.kind }));
}

/** Extensions that identify a screenshot without asking the caller. */
const SCREENSHOT_EXTENSIONS: ReadonlySet<string> = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** The `/`-separated path of `absolute` below `root`, or null when it is outside. */
function relativeToRoot(root: string, absolute: string): string | null {
  const rootPosix = toPosixPath(root).replace(/\/+$/, "");
  const filePosix = toPosixPath(absolute);
  if (filePosix === rootPosix) return null;
  if (!filePosix.startsWith(`${rootPosix}/`)) return null;
  const relative = filePosix.slice(rootPosix.length + 1);
  return isSafeEvidencePath(relative) ? relative : null;
}

/** Name the kind from the extension when the caller did not. */
function kindForExtension(relative: string): EvidenceKind {
  const dot = relative.lastIndexOf(".");
  const extension = dot < 0 ? "" : relative.slice(dot).toLowerCase();
  if (SCREENSHOT_EXTENSIONS.has(extension)) return "screenshot";
  if (extension === ".json") return "json";
  if (extension === ".txt") return "text";
  return "file";
}

/**
 * Create the store for one run.
 *
 * The directory is created lazily on the first recorded item, so a run whose
 * checks only read files leaves no empty evidence directory behind.
 */
export function createEvidenceStore(options: CreateEvidenceStoreOptions): EvidenceStore {
  const { fs, root, clock } = options;
  const recorded: EvidenceItem[] = [];
  const encoder = new TextEncoder();

  async function allocate(stem: string, extension: string): Promise<Result<string>> {
    if (!EVIDENCE_STEM_RE.test(stem)) {
      return err(
        failure(
          "invalid-input",
          `evidence name ${JSON.stringify(stem)} is not a safe file stem`,
          "use letters, digits, dot, dash or underscore",
        ),
      );
    }
    const made = await fs.makeDir(root);
    if (!made.ok) return made;
    for (let ordinal = 1; ordinal <= MAX_ORDINAL; ordinal += 1) {
      const suffix = ordinal === 1 ? "" : `-${ordinal}`;
      const fileName = `${stem}${suffix}${extension}`;
      if (!isSafeEvidencePath(fileName)) continue;
      if (await fs.exists(joinFsPath(root, fileName))) continue;
      return ok(fileName);
    }
    return err(
      failure(
        "conflict",
        `every evidence file name for ${stem}${extension} is taken in ${root}`,
        "record fewer items under one name, or start a new run",
      ),
    );
  }

  async function record(
    stem: string,
    extension: string,
    kind: EvidenceKind,
    content: string,
    recordOptions: EvidenceRecordOptions | undefined,
  ): Promise<Result<EvidenceItem>> {
    const fileName = await allocate(stem, extension);
    if (!fileName.ok) return fileName;
    const absolute = joinFsPath(root, fileName.value);
    const written = await fs.writeText(absolute, content);
    if (!written.ok) return written;
    const item: EvidenceItem = {
      kind: recordOptions?.kind ?? kind,
      path: asEvidencePath(toPosixPath(fileName.value)),
      bytes: encoder.encode(content).byteLength,
      sha256: sha256Text(content),
      capturedAt: recordOptions?.capturedAt ?? clock.iso(),
      ...(recordOptions?.note === undefined ? {} : { note: recordOptions.note }),
    };
    recorded.push(item);
    return ok(item);
  }

  return {
    root,
    items() {
      return [...recorded];
    },
    async recordText(name, content, recordOptions) {
      return record(name, TEXT_EXTENSION, "text", content, recordOptions);
    },
    async recordJson(name, value, recordOptions) {
      return record(name, JSON_EXTENSION, "json", `${JSON.stringify(value, null, 2)}\n`, recordOptions);
    },
    async recordFile(path, fileOptions) {
      const relative = relativeToRoot(root, path);
      if (relative === null) {
        return err(
          failure(
            "invalid-input",
            `evidence file ${path} is outside the evidence root ${root}`,
            "write the artifact under the run evidence directory, then declare it",
          ),
        );
      }
      const existing = recorded.find((item) => item.path === relative);
      if (existing !== undefined) {
        const digest = await fs.hashFile(path);
        if (!digest.ok) return digest;
        if (digest.value === existing.sha256) return ok(existing);
        return err(
          failure(
            "conflict",
            `evidence file ${relative} changed after it was recorded`,
            "evidence is immutable: record the new bytes under a new name, or restore the original",
          ),
        );
      }
      const stat = await fs.stat(path);
      if (!stat.ok) return stat;
      if (stat.value.kind !== "file") {
        return err(
          failure("invalid-input", `evidence path ${relative} is not a regular file`, "declare a file, not a directory"),
        );
      }
      if (stat.value.size <= 0) {
        return err(
          failure("io", `evidence file ${relative} is empty`, "write the artifact before declaring it as evidence"),
        );
      }
      const digest = await fs.hashFile(path);
      if (!digest.ok) return digest;
      const item: EvidenceItem = {
        kind: fileOptions?.kind ?? kindForExtension(relative),
        path: asEvidencePath(relative),
        bytes: stat.value.size,
        sha256: digest.value,
        capturedAt: fileOptions?.capturedAt ?? clock.iso(),
        ...(fileOptions?.note === undefined ? {} : { note: fileOptions.note }),
      };
      recorded.push(item);
      return ok(item);
    },
  };
}
