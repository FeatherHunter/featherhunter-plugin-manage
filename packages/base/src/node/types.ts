import type { Lang, Manifest } from "../core/types";

/**
 * Heading form of a rendered block. Most repositories use an HTML <h2>
 * heading; ilife (and the prompt MORE block) use a Markdown `##` heading.
 */
export type HeadingVariant = "html-heading" | "markdown-heading";

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
  /** Heading form override; renderers default to their repository convention. */
  variant?: HeadingVariant;
  /** Plugin id of the repository being rendered; the MORE block excludes it. */
  selfId?: string;
  /** Heading text override, used to keep a historical heading wording. */
  headingText?: string;
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
  /** `init` may insert missing marker pairs; `sync` only rewrites marked text. */
  command?: "init" | "sync";
  /** Report drift without writing. */
  check?: boolean;
  /** Process every target root and keep going after per-file errors. */
  all?: boolean;
  dryRun?: boolean;
  /** Manifest to render from; defaults to the packaged baseline manifest. */
  manifest?: Manifest;
  /** Published package version, used for precise CDN URLs. */
  version?: string;
  /** CDN base URL override (tests / mirrors). */
  cdnBase?: string;
  /** Target language override; detected from the README when omitted. */
  lang?: Lang;
  /** Heading form override; detected from the README when omitted. */
  variant?: HeadingVariant;
  /** Plugin id of the repository being rendered; the MORE block excludes it. */
  selfId?: string;
  /** Heading text override; detected from the README when omitted. */
  headingText?: string;
  /** README path relative to each root; default `README.md`. */
  readme?: string;
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
