/**
 * Evidence contract: what an evidence item *is*, independent of where it is stored.
 *
 * The rule this file encodes is the one a real run learned the hard way: evidence
 * is content-addressed and immutable. A file is identified by its sha256, never by
 * a timestamp, so re-running a batch can not silently replace the artifact a
 * previous report quoted.
 */
import type { EvidencePath, Sha256Hex } from "./branding";

/** What kind of observation a piece of evidence records. */
export type EvidenceKind = "text" | "json" | "screenshot" | "log-slice" | "command" | "file";

/** One recorded artifact inside `<root>/<batch>/evidence/files/`. */
export interface EvidenceItem {
  readonly kind: EvidenceKind;
  /** Path relative to the evidence root, `/`-separated on every platform. */
  readonly path: EvidencePath;
  readonly bytes: number;
  readonly sha256: Sha256Hex;
  readonly capturedAt: string;
  readonly note?: string;
}

/** A manifest item: same identity as `EvidenceItem`, no duplicated `kind`. */
export interface EvidenceManifestItem {
  readonly kind: EvidenceKind;
  readonly path: EvidencePath;
  readonly bytes: number;
  readonly sha256: Sha256Hex;
  readonly capturedAt: string;
  readonly note?: string;
}

/** Lightweight reference carried by checks, so a check can point at its proof. */
export interface EvidenceItemRef {
  readonly path: EvidencePath;
  readonly sha256: Sha256Hex;
  readonly kind: EvidenceKind;
}

/** A probe or check that could not run, and why. */
export interface BlockedReason {
  readonly code: "adapter-missing" | "prerequisite-missing" | "platform-unsupported";
  readonly message: string;
  readonly hint?: string;
}

/** The `evidence.json` shape. `candidate` is injected by the command layer only. */
export interface EvidenceManifest {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly batch: {
    readonly name: string;
    readonly dir: string;
    readonly root: string;
  };
  readonly meta: Readonly<Record<string, string>>;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly checks: readonly unknown[];
  readonly items: readonly EvidenceManifestItem[];
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly candidate?: Readonly<Record<string, unknown>>;
}

/** Filename stem rules: no separators, no `..`, no control characters. */
export const EVIDENCE_STEM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** Normalize a relative path to `/` separators and reject escapes. */
export function isSafeEvidencePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
