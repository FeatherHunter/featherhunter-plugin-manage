/**
 * The `evidence.json` writer.
 *
 * Why the field order is constructed by hand: the manifest is quoted in batch
 * comments and diffed between runs, so the same observations must serialize to
 * the same bytes apart from timestamps. Field order is part of that, and it is
 * also a safety property — `candidate` is the identity the command layer injects
 * (never the caller), so it is written last and cannot be shadowed by an extra
 * field. An evidence package that names the wrong candidate is worse than no
 * package at all, because it looks valid.
 *
 * Why the write is temp-file-then-rename: a half-written manifest is a file that
 * parses as neither old nor new evidence. The rename is the commit point.
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { EvidenceManifest, EvidenceManifestItem } from "../contracts/evidence-contract";
import { SCHEMA_VERSION } from "../contracts/identity";
import { failure, err, ok, type Result } from "../contracts/result";

/** File name of the manifest inside the evidence root. */
export const EVIDENCE_MANIFEST_FILENAME = "evidence.json";

/**
 * Fields the manifest owns. Keys with these names are dropped from `extra`:
 * an "extra" field may add information, never rewrite the record of what ran.
 */
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

/** One collected check line, as persisted in `evidence.json`. */
export interface EvidenceCheckLine {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** ISO-8601 timestamp of when the line was collected. */
  readonly recordedAt: string;
}

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
 * Build the manifest value. `extra` is flattened to the top level (the wire
 * shape the reports read), reserved keys are filtered, and `candidate` is
 * applied after every other write so it is authoritative.
 */
export function buildEvidenceManifest(input: BuildEvidenceManifestInput): EvidenceManifest {
  const ordered: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    batch: input.batch,
    meta: { ...input.meta },
    summary: { ...input.summary },
    checks: [...input.checks],
    items: [...input.items],
  };
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (RESERVED_MANIFEST_KEYS.has(key)) continue;
    ordered[key] = value;
  }
  if (input.candidate !== undefined) ordered.candidate = input.candidate;
  // `extra` is a wire-format extension point; the contract type cannot describe
  // arbitrary top-level fields, so the merge is cast once at this boundary.
  return ordered as unknown as EvidenceManifest;
}

/**
 * Serialize and persist the manifest below `evidenceRoot`. Refuses to replace an
 * existing manifest: re-running a batch must not rewrite the record that a
 * previous report already quoted.
 */
export function writeEvidenceManifest(
  evidenceRoot: string,
  manifest: EvidenceManifest,
): Result<string> {
  const manifestPath = join(evidenceRoot, EVIDENCE_MANIFEST_FILENAME);
  if (existsSync(manifestPath)) {
    return err(
      failure(
        "conflict",
        `证据清单已存在：${manifestPath}`,
        "证据包不可覆盖；如需重新收集，请开一个新批次目录",
        { manifestPath },
      ),
    );
  }
  const tempPath = join(evidenceRoot, `.${EVIDENCE_MANIFEST_FILENAME}.${process.pid}.tmp`);
  try {
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(tempPath, manifestPath);
    return ok(manifestPath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // The temp file is only diagnostic litter; the original error is the one worth reporting.
    }
    return err(
      failure(
        "io",
        `写入证据清单失败：${manifestPath}`,
        error instanceof Error ? error.message : String(error),
        { manifestPath },
      ),
    );
  }
}
