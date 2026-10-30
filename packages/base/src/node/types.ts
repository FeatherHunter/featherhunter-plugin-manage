import type { Lang, Manifest } from "../core/types";

/**
 * Heading form of a rendered block. Most repositories use an HTML <h2>
 * heading; ilife (and the prompt MORE block) use a Markdown `##` heading.
 */
export type HeadingVariant = "html-heading" | "markdown-heading";

/** One contribution number inside a thanks data file. */
export interface ThanksEntry {
  /** Issue / pull / discussion number. */
  n: number;
  /** ISO timestamp of the contribution. */
  at?: string;
  /** For comments: the thread the comment belongs to. */
  thread?: "issue" | "pr";
}

/** One author record inside a thanks data file. */
export interface ThanksAuthor {
  issues?: ThanksEntry[];
  prs?: ThanksEntry[];
  discussions?: ThanksEntry[];
  comments?: ThanksEntry[];
  /** ISO timestamp of the last activity, used as the ranking tie-breaker. */
  lastActive?: string;
}

/**
 * Data needed to render the thanks table.
 *
 * The repositories keep this in docs/thanks-data.json (written by their own
 * generators); the renderer never fetches anything.
 */
export interface ThanksData {
  /** Owner/repo used to build the contribution links, e.g. FeatherHunter/dsh-im-companion. */
  repo: string;
  authors: Record<string, ThanksAuthor>;
}

/** Data needed to render the star-history block. */
export interface StarHistoryData {
  /** Owner/repo of the chart assets, e.g. FeatherHunter/dsh-mattpocock-skills-deck. */
  repo: string;
  /** Minute-level version query string (YYYYMMDDHHmm) appended to every image URL. */
  version: string;
  /** Branch that publishes docs/; defaults to `main`. */
  branch?: string;
  /** Dark-mode chart path; defaults to `docs/star-history-dark.svg`. */
  darkPath?: string;
  /** Light-mode chart path; defaults to `docs/star-history-light.svg`. */
  lightPath?: string;
  /** Image alt text; defaults to `Star History Chart`. */
  alt?: string;
  /** Optional link to a standalone chart page (deck). */
  pageUrl?: string;
  /** Optional rendered image width (im uses 720). */
  width?: number;
  /** Optional caption rendered as a `<sub>` note under the chart (im). */
  note?: string;
}

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
  /** Star-history data; the block is skipped when absent. */
  starHistory?: StarHistoryData;
  /** Thanks table data; the block is skipped when absent. */
  thanks?: ThanksData;
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
  /** Star-history data; the block is skipped when absent. */
  starHistory?: StarHistoryData;
  /** Thanks table data; the block is skipped when absent. */
  thanks?: ThanksData;
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
