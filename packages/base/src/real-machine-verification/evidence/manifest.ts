/**
 * Reading and writing `evidence.json`, the batch-level evidence manifest.
 *
 * Two rules from the spec shape this file:
 *
 * - The manifest is immutable once written for a path: adding more evidence
 *   appends items, it never replaces the ones already recorded. A path that is
 *   already in the manifest keeps its sha256 for life; new content for the same
 *   logical artifact must be stored under a new (ordinal) file name.
 * - `candidate` is injected by the command layer from the batch record. It is a
 *   reserved key: `extra` is flattened first and skipped for every reserved key,
 *   and `candidate` is written last, so no extra field can shadow it. Re-merging
 *   a manifest also refuses to change an existing candidate.
 *
 * The file is written to a temporary name and moved into place because a
 * half-written manifest parses as neither the old nor the new one.
 */

import { SHA256_RE, parseBatchName } from "../contracts/branding";
import {
  type EvidenceKind,
  type EvidenceManifest,
  type EvidenceManifestItem,
} from "../contracts/evidence-contract";
import { SCHEMA_VERSION, canonicalJson, sha256Text } from "../contracts/identity";
import type { FsPort } from "../contracts/ports";
import { err, failure, ok, type Result } from "../contracts/result";
import { joinFsPath, samePath } from "../runtime/paths";

/** Canonical file name of the evidence manifest inside the evidence package. */
export const EVIDENCE_MANIFEST_FILENAME = "evidence.json";

/** Keys owned by the command layer; extras may never write them. */
const RESERVED_MANIFEST_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "generatedAt",
  "batch",
  "meta",
  "summary",
  "checks",
  "items",
  "candidate",
]);

/** One check conclusion recorded by `evidence add --check <id>=pass|fail`. */
export interface EvidenceCheckLine {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly recordedAt: string;
}

/** Everything needed to build (or merge into) a manifest. */
export interface BuildEvidenceManifestInput {
  readonly generatedAt: string;
  readonly batch: EvidenceManifest["batch"];
  readonly meta: Readonly<Record<string, string>>;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly checks: readonly EvidenceCheckLine[];
  readonly items: readonly EvidenceManifestItem[];
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly candidate?: Readonly<Record<string, unknown>>;
}

/**
 * Assemble a manifest with a stable field order: contract fields first, then
 * extra fields (reserved keys skipped), then the command-layer `candidate`
 * last so it is authoritative by construction.
 */
export function buildEvidenceManifest(input: BuildEvidenceManifestInput): EvidenceManifest {
  const manifest: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    batch: input.batch,
    meta: { ...input.meta },
    summary: { ...input.summary },
    checks: [...input.checks],
    items: [...input.items],
  };
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (!RESERVED_MANIFEST_KEYS.has(key)) manifest[key] = value;
  }
  if (input.candidate !== undefined) manifest.candidate = input.candidate;
  return manifest as unknown as EvidenceManifest;
}

interface PlainRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

const EVIDENCE_KINDS: ReadonlySet<string> = new Set(["text", "json", "screenshot", "log-slice", "command", "file"]);

function isEvidenceManifestItem(value: unknown): value is EvidenceManifestItem {
  if (!isRecord(value)) return false;
  if (typeof value.kind !== "string" || !EVIDENCE_KINDS.has(value.kind)) return false;
  if (typeof value.path !== "string" || !isRecordablePath(value.path)) return false;
  if (typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 0) return false;
  if (typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256)) return false;
  if (typeof value.capturedAt !== "string" || value.capturedAt.length === 0) return false;
  if (value.note !== undefined && typeof value.note !== "string") return false;
  return true;
}

function isRecordablePath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function invalidManifest(detail: string): Result<never> {
  return err(
    failure(
      "invalid-input",
      `证据清单格式不合法：${detail}`,
      "evidence.json 必须由 dsh-verify evidence add 写出；手工编辑或截断会导致校验失败",
    ),
  );
}

/**
 * Validate an arbitrary JSON value as an `EvidenceManifest`.
 *
 * Unknown top-level keys are allowed (they are the `extra` channel); everything
 * the rest of the code reads is checked so a corrupt manifest fails at the
 * boundary instead of deep inside report rendering.
 */
export function validateEvidenceManifest(value: unknown): Result<EvidenceManifest> {
  if (!isRecord(value)) return invalidManifest("顶层不是一个 JSON 对象");
  if (value.schemaVersion !== SCHEMA_VERSION) return invalidManifest(`schemaVersion 应为 ${SCHEMA_VERSION}`);
  if (typeof value.generatedAt !== "string" || value.generatedAt.length === 0) return invalidManifest("generatedAt 缺失");
  if (!isRecord(value.batch)) return invalidManifest("缺少 batch 段");
  if (typeof value.batch.name !== "string" || value.batch.name.length === 0) return invalidManifest("batch.name 缺失");
  const batchName = parseBatchName(value.batch.name);
  if (!batchName.ok) return invalidManifest(`batch.name 不合法：${value.batch.name}`);
  if (typeof value.batch.dir !== "string" || value.batch.dir.length === 0) return invalidManifest("batch.dir 缺失");
  if (typeof value.batch.root !== "string" || value.batch.root.length === 0) return invalidManifest("batch.root 缺失");
  if (!isStringRecord(value.meta)) return invalidManifest("meta 必须是字符串映射");
  if (!isRecord(value.summary)) return invalidManifest("summary 必须是对象");
  if (!Array.isArray(value.checks)) return invalidManifest("checks 必须是数组");
  if (!Array.isArray(value.items)) return invalidManifest("items 必须是数组");
  const badItem = value.items.findIndex((item) => !isEvidenceManifestItem(item));
  if (badItem >= 0) return invalidManifest(`items[${badItem}] 不是合法的证据项`);
  if (value.candidate !== undefined && !isRecord(value.candidate)) return invalidManifest("candidate 必须是对象");
  if (value.extra !== undefined && !isRecord(value.extra)) return invalidManifest("extra 必须是对象");
  return ok(value as unknown as EvidenceManifest);
}

/** A manifest read back from disk, with the bytes that were hashed. */
export interface LoadedEvidenceManifest {
  readonly manifest: EvidenceManifest;
  readonly manifestPath: string;
  readonly content: string;
  readonly manifestSha256: string;
}

/** Read and validate `evidence.json`; `ok(null)` when the batch has none yet. */
export async function loadEvidenceManifest(
  fs: FsPort,
  evidenceRoot: string,
): Promise<Result<LoadedEvidenceManifest | null>> {
  const manifestPath = joinFsPath(evidenceRoot, EVIDENCE_MANIFEST_FILENAME);
  if (!(await fs.exists(manifestPath))) return ok(null);
  const content = await fs.readText(manifestPath);
  if (!content.ok) return content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.value);
  } catch {
    return err(
      failure(
        "invalid-input",
        `证据清单不是合法 JSON：${manifestPath}`,
        "文件可能被截断或手工改坏；重新收集证据可以生成新清单",
        { manifestPath },
      ),
    );
  }
  const validated = validateEvidenceManifest(parsed);
  if (!validated.ok) return validated;
  return ok({
    manifest: validated.value,
    manifestPath,
    content: content.value,
    manifestSha256: sha256Text(content.value),
  });
}

/** Extra top-level fields of a manifest (everything the contract does not own). */
function extraFieldsOf(manifest: EvidenceManifest): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest as unknown as Record<string, unknown>)) {
    if (!RESERVED_MANIFEST_KEYS.has(key)) extra[key] = value;
  }
  return extra;
}

/**
 * Merge a new observation into an existing manifest.
 *
 * Items are appended, never replaced: the same path with the same sha256 is a
 * duplicate (kept once), the same path with a different hash is a conflict the
 * caller must resolve with a new file name. The candidate is sticky — it can be
 * introduced, but never changed by a later add.
 */
export function mergeEvidenceManifest(
  existing: EvidenceManifest,
  input: BuildEvidenceManifestInput,
): Result<EvidenceManifest> {
  if (existing.batch.name !== input.batch.name) {
    return err(
      failure(
        "invalid-input",
        `证据清单属于批次 ${existing.batch.name}，不能合并批次 ${input.batch.name} 的证据`,
        "一个 evidence.json 只能描述一个批次",
      ),
    );
  }
  if (!samePath(existing.batch.dir, input.batch.dir)) {
    return err(
      failure(
        "invalid-input",
        `证据清单的批次目录不一致：${existing.batch.dir} / ${input.batch.dir}`,
        "一个 evidence.json 只能描述一个批次目录",
      ),
    );
  }
  if (
    existing.candidate !== undefined &&
    input.candidate !== undefined &&
    canonicalJson(existing.candidate) !== canonicalJson(input.candidate)
  ) {
    return err(
      failure(
        "identity-mismatch",
        "候选身份与已记录的证据清单不一致",
        "候选身份只能由命令层从批次记录注入；已写下的 candidate 不能被后续 add 或 --extra 改写",
      ),
    );
  }
  const candidate = input.candidate ?? existing.candidate;
  const itemsByPath = new Map<string, EvidenceManifestItem>();
  for (const item of existing.items) itemsByPath.set(item.path, item);
  for (const item of input.items) {
    const recorded = itemsByPath.get(item.path);
    if (recorded !== undefined) {
      if (recorded.sha256 !== item.sha256 || recorded.bytes !== item.bytes) {
        return err(
          failure(
            "conflict",
            `同一路径的证据内容不同：${item.path}`,
            "证据文件不可覆盖；新证据应该使用带序号的另一个文件名",
            { path: item.path, recordedSha256: recorded.sha256, incomingSha256: item.sha256 },
          ),
        );
      }
      continue;
    }
    itemsByPath.set(item.path, item);
  }
  return ok(
    buildEvidenceManifest({
      generatedAt: input.generatedAt,
      batch: existing.batch,
      meta: { ...existing.meta, ...input.meta },
      summary: { ...existing.summary, ...input.summary },
      checks: [...(existing.checks as readonly EvidenceCheckLine[]), ...input.checks],
      items: [...itemsByPath.values()],
      extra: { ...extraFieldsOf(existing), ...(input.extra ?? {}) },
      ...(candidate === undefined ? {} : { candidate }),
    }),
  );
}

/** Options for writing `evidence.json`. */
export interface WriteEvidenceManifestOptions {
  readonly fs: FsPort;
  readonly evidenceRoot: string;
  readonly manifest: EvidenceManifest;
  /** Allow replacing an existing manifest (only for the merge path, never a fresh package). */
  readonly replace?: boolean;
}

/** Result of a successful manifest write. */
export interface WrittenEvidenceManifest {
  readonly manifest: EvidenceManifest;
  readonly manifestPath: string;
  readonly content: string;
  readonly manifestSha256: string;
}

/** Write `evidence.json` atomically (temporary file, then move). */
export async function writeEvidenceManifest(
  options: WriteEvidenceManifestOptions,
): Promise<Result<WrittenEvidenceManifest>> {
  const { fs, evidenceRoot, manifest } = options;
  const manifestPath = joinFsPath(evidenceRoot, EVIDENCE_MANIFEST_FILENAME);
  const made = await fs.makeDir(evidenceRoot);
  if (!made.ok) return made;
  const alreadyExists = await fs.exists(manifestPath);
  if (alreadyExists && options.replace !== true) {
    return err(
      failure(
        "conflict",
        `证据清单已存在：${manifestPath}`,
        "证据包不可覆盖；如需重新收集，请开一个新批次目录",
        { manifestPath },
      ),
    );
  }
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const temporaryPath = joinFsPath(evidenceRoot, `.${EVIDENCE_MANIFEST_FILENAME}.${process.pid}.tmp`);
  const written = await fs.writeText(temporaryPath, content);
  if (!written.ok) return written;
  const moved = await fs.move(temporaryPath, manifestPath);
  if (!moved.ok) {
    await fs.remove(temporaryPath, { recursive: false });
    return moved;
  }
  return ok({ manifest, manifestPath, content, manifestSha256: sha256Text(content) });
}
