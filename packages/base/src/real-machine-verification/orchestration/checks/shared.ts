/**
 * Small helpers shared by the built-in checks.
 *
 * Nothing here decides a status; the checks do. These helpers only keep the
 * "record a JSON snapshot of what I observed" step from being repeated five
 * times with slightly different failure handling.
 */
import type { EvidenceItemRef } from "../../contracts/evidence-contract";
import type { FsPort } from "../../contracts/ports";
import type { Failure, Result } from "../../contracts/result";
import type { EvidenceStore } from "../../evidence/store";

/** Record one JSON evidence item and return the reference a check carries. */
export async function recordEvidence(
  store: EvidenceStore,
  name: string,
  value: Record<string, unknown>,
  note: string,
  warn: (message: string) => void,
): Promise<readonly EvidenceItemRef[]> {
  const written = await store.recordJson(name, value, { note });
  if (!written.ok) {
    warn(`could not record evidence "${name}": ${written.error.message}`);
    return [];
  }
  return [{ path: written.value.path, sha256: written.value.sha256, kind: written.value.kind }];
}

/** A JSON object (not an array) from a port read, or `null`. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A non-empty string field, or `null`. */
export function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read a manifest file and insist it is a JSON object. */
export async function readJsonRecord(
  fs: FsPort,
  path: string,
): Promise<Result<Record<string, unknown>, Failure>> {
  const raw = await fs.readJson(path);
  if (!raw.ok) return raw;
  const record = asRecord(raw.value);
  if (record === null) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: `${path} is not a JSON object`,
        hint: "the file is corrupt; reinstall or regenerate it",
      },
    };
  }
  return { ok: true, value: record };
}
