import type { Lang, Manifest } from "../core/types";

/** Shared options for the README block renderers. */
export interface BlockRenderOptions {
  /** Manifest to render from; defaults to the packaged baseline manifest. */
  manifest?: Manifest;
  /** Published package version, used for precise CDN URLs. */
  version?: string;
  /** Target language of the generated block. */
  lang?: Lang;
  /** CDN base URL override (tests / mirrors). */
  cdnBase?: string;
}

/** Marker names of the four managed README blocks. */
export type BlockName = "contact" | "star-history" | "thanks" | "more";

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

/** Options for the README writer (ticket 08). */
export interface ReadmeSyncOptions {
  /** Repository roots to update. */
  roots: string[];
  /** Report drift without writing. */
  check?: boolean;
  /** Rewrite every managed block, even unchanged ones. */
  all?: boolean;
  dryRun?: boolean;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}
