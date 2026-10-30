/**
 * Generic managed-block engine and registry (ticket 08).
 *
 * A README block is defined once in {@link BLOCK_DEFINITIONS}: its marker
 * pair(s), a pure content renderer, the legacy anchor used by `readme:init`
 * and an optional detector that recovers the language / heading variant from
 * the existing text. The engine only ever rewrites the text between the
 * marker pair, never the surrounding README, and refuses to guess when the
 * markers are unpaired, duplicated or the README carries merge-conflict
 * residue.
 *
 * Tickets 09 (MORE) and 10 (star history / thanks) extend this registry — the
 * markers of those blocks are reserved below, only their renderers are still
 * missing.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Lang, Manifest } from "../core/types";
import {
  findSuspiciousLines,
  locateReadmeBlocks,
  parseContactBlock,
} from "./readme-compare";
import { renderContactBlock } from "./renderers";
import type {
  BlockName,
  BlockRenderOptions,
  HeadingVariant,
  ReadmeSyncOptions,
} from "./types";

/** One marker pair managed inside a README. */
export interface BlockMarkerSet {
  /** Language of the segment; unset = the block's default language. */
  lang?: Lang;
  start: string;
  end: string;
}

/** Options handed to a block renderer; `lang` is always resolved. */
export interface BlockRenderContext extends BlockRenderOptions {
  lang: Lang;
}

/** Half-open character range of a legacy (pre-marker) block in a README. */
export interface LegacyBlockSpan {
  start: number;
  end: number;
}

/**
 * One managed README block.
 *
 * Ticket 09/10 only need to fill in `render` (and, when the block is new like
 * the MORE block on ilife, `locateLegacy`) for the reserved entries.
 */
export interface BlockDefinition {
  name: BlockName;
  /** Human-readable name used in CLI diagnostics. */
  label: string;
  /** Marker pairs the engine owns. `thanks` has one pair per language. */
  markers: readonly BlockMarkerSet[];
  /**
   * Render the content between the marker pair. A definition without a
   * renderer is reserved: its markers are validated when present but never
   * rewritten.
   */
  render?: (context: BlockRenderContext) => string;
  /** Locate the pre-marker block extent in a README (used by `readme:init`). */
  locateLegacy?: (markdown: string) => LegacyBlockSpan | null;
  /** Recover the language and heading variant from a current block text. */
  detect?: (raw: string) => { lang?: Lang; variant?: HeadingVariant };
}

/** Marker strings of the four managed README blocks. */
const THANKS_ZH_MARKERS = {
  start: "<!-- THANKS-TABLE-ZH-START -->",
  end: "<!-- THANKS-TABLE-ZH-END -->",
} as const;
const THANKS_EN_MARKERS = {
  start: "<!-- THANKS-TABLE-EN-START -->",
  end: "<!-- THANKS-TABLE-EN-END -->",
} as const;

export const BLOCK_MARKERS = {
  contact: { start: "<!-- CONTACT-START -->", end: "<!-- CONTACT-END -->" },
  more: { start: "<!-- MORE-START -->", end: "<!-- MORE-END -->" },
  starHistory: { start: "<!-- STAR-HISTORY-START -->", end: "<!-- STAR-HISTORY-END -->" },
  thanks: {
    ...THANKS_ZH_MARKERS,
    zh: THANKS_ZH_MARKERS,
    en: THANKS_EN_MARKERS,
  },
} as const;

/**
 * Detect the language and heading form of a legacy contact block.
 *
 * The heading text is the reliable signal: the en fixtures read
 * "Feedback and Contact" while the zh ones read "反馈与联系", and only ilife
 * uses the Markdown `##` heading.
 */
function detectContact(raw: string): { lang?: Lang; variant?: HeadingVariant } {
  const parsed = parseContactBlock(raw);
  const heading = parsed.heading?.text ?? "";
  const lang: Lang = /[A-Za-z]/.test(heading) ? "en" : "zh";
  const variant: HeadingVariant =
    parsed.variant === "markdown-heading" ? "markdown-heading" : "html-heading";
  return { lang, variant };
}

/**
 * Locate the legacy (pre-marker) contact block.
 *
 * The block runs from its heading line through the closing `</div>` of the
 * centred wrapper. Ticket 07's locator cannot be reused here: it ends a block
 * at the next *managed* block start, so a contact block followed only by
 * ordinary headings would swallow the rest of the README.
 */
function locateLegacyContact(markdown: string): LegacyBlockSpan | null {
  const headingPattern =
    /^(?:<h2\b[^\n]*?(?:CONNECT|反馈与联系|Feedback and Contact)[^\n]*?|<sub>\s*CONNECT\s*<\/sub>[^\n]*?|<h2\b[^\n]*?>[^\n]*?(?:反馈与联系|Feedback and Contact)[^\n]*?>|##\s+[^\n]*(?:反馈与联系|Feedback and Contact)[^\n]*)\s*$/im;
  const heading = headingPattern.exec(markdown);
  if (heading === null) return null;
  const start = heading.index;
  const closingDiv = /^[ \t]*<\/div>[ \t]*$/m;
  const rest = markdown.slice(start + heading[0].length);
  const closing = closingDiv.exec(rest);
  if (closing === null) return null;
  return { start, end: start + heading[0].length + closing.index + closing[0].length };
}

/**
 * Registry of the managed README blocks.
 *
 * Order is documentation order, not README order: the engine locates every
 * block by its markers, so block order inside a README never matters.
 */
export const BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  {
    name: "contact",
    label: "contact",
    markers: [{ start: BLOCK_MARKERS.contact.start, end: BLOCK_MARKERS.contact.end }],
    render: (context) => renderContactBlock(context),
    locateLegacy: locateLegacyContact,
    detect: detectContact,
  },
  // Reserved for ticket 09: renderer + legacy anchor for the author-plugins
  // (MORE) block. Marker pair is fixed now so init/sync never invents one.
  {
    name: "more",
    label: "more",
    markers: [{ start: BLOCK_MARKERS.more.start, end: BLOCK_MARKERS.more.end }],
  },
  // Reserved for ticket 10.
  {
    name: "star-history",
    label: "star-history",
    markers: [{ start: BLOCK_MARKERS.starHistory.start, end: BLOCK_MARKERS.starHistory.end }],
  },
  // Reserved for ticket 10. One marker pair per language; which pair exists
  // tells the language of the README.
  {
    name: "thanks",
    label: "thanks",
    markers: [
      { lang: "zh", start: THANKS_ZH_MARKERS.start, end: THANKS_ZH_MARKERS.end },
      { lang: "en", start: THANKS_EN_MARKERS.start, end: THANKS_EN_MARKERS.end },
    ],
  },
];

/** Look up one block definition by name. */
export function blockDefinition(name: BlockName): BlockDefinition | undefined {
  return BLOCK_DEFINITIONS.find((definition) => definition.name === name);
}

/** Definitions that can be rendered today (reserved blocks are skipped). */
export function implementedBlockDefinitions(): BlockDefinition[] {
  return BLOCK_DEFINITIONS.filter((definition) => definition.render !== undefined);
}

/** Result of updating one README file. */
export interface ReadmeFileResult {
  /** Absolute path of the README. */
  readmePath: string;
  ok: boolean;
  /** The README content must change (or would change when `check`). */
  changed: boolean;
  /** The engine actually wrote the file. */
  written: boolean;
  blocks: Array<{ name: BlockName; status: "inserted" | "updated" | "unchanged" | "skipped" }>;
  errors: string[];
}

/** Options for one README target. */
export interface ReadmeTargetOptions extends BlockRenderOptions {
  /** Directory that contains the README (`--root`). */
  root: string;
  /** README path relative to `root`; default `README.md`. */
  readme?: string;
}

/** Options for one `readme:init` / `readme:sync` file update. */
export interface ReadmeUpdateOptions extends ReadmeTargetOptions {
  /** `init` may insert missing markers; `sync` only rewrites marked text. */
  command?: "init" | "sync";
  /** Report drift without writing. */
  check?: boolean;
}

/** Result of updating several README files. */
export interface ReadmeBatchResult {
  ok: boolean;
  files: ReadmeFileResult[];
}

/** Hooks used by tests to observe the atomic-write window. */
export interface AtomicWriteHooks {
  /** Called after the temp file is complete but before the rename. */
  beforeRename?: (tempPath: string) => void;
}

/**
 * Write a file atomically: full content goes to a sibling temp file first, the
 * original permissions are copied, and only then the temp file is renamed over
 * the destination. A failure before the rename leaves the original untouched
 * and removes the temp file.
 */
export function writeFileAtomic(
  filePath: string,
  content: string,
  hooks: AtomicWriteHooks = {},
): void {
  const directory = dirname(filePath);
  const tempPath = join(
    directory,
    "." + basename(filePath) + "." + process.pid + "." + randomBytes(6).toString("hex") + ".tmp",
  );
  let mode: number | undefined;
  try {
    mode = statSync(filePath).mode & 0o777;
  } catch {
    mode = undefined;
  }
  try {
    writeFileSync(tempPath, content, "utf8");
    if (mode !== undefined) chmodSync(tempPath, mode);
    hooks.beforeRename?.(tempPath);
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Best effort cleanup; the original error is the one worth reporting.
    }
    throw error;
  }
}

function detectLineEnding(markdown: string): string {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}

/** Indexes of every occurrence of `token`. */
function markerIndexes(markdown: string, token: string): number[] {
  const indexes: number[] = [];
  let from = 0;
  for (;;) {
    const index = markdown.indexOf(token, from);
    if (index === -1) return indexes;
    indexes.push(index);
    from = index + token.length;
  }
}

interface ApplyResult {
  markdown: string;
  changed: boolean;
  status: "inserted" | "updated" | "unchanged" | "skipped";
  errors: string[];
}

/** Render the content of one marker segment (resolved per-language). */
function renderSegment(
  definition: BlockDefinition,
  markerSet: BlockMarkerSet,
  context: BlockRenderContext,
): string {
  if (definition.render === undefined) throw new Error("block has no renderer: " + definition.name);
  return definition.render({ ...context, lang: markerSet.lang ?? context.lang });
}

/** Replace the text between one marker pair, or (init) insert the pair. */
function applyMarkerSet(
  markdown: string,
  definition: BlockDefinition,
  markerSet: BlockMarkerSet,
  context: BlockRenderContext,
  command: "init" | "sync",
): ApplyResult {
  const errors: string[] = [];
  const { start, end } = markerSet;
  const starts = markerIndexes(markdown, start);
  const ends = markerIndexes(markdown, end);
  const eol = detectLineEnding(markdown);

  if (starts.length === 0 && ends.length === 0) {
    if (definition.render === undefined) {
      return { markdown, changed: false, status: "skipped", errors };
    }
    if (command === "sync") {
      errors.push(definition.label + " markers are missing; run readme:init first");
      return { markdown, changed: false, status: "skipped", errors };
    }
    const legacy = definition.locateLegacy?.(markdown) ?? null;
    if (legacy === null) {
      errors.push(
        "cannot locate the legacy " + definition.label + " block; add " + start + " / " + end + " markers manually",
      );
      return { markdown, changed: false, status: "skipped", errors };
    }
    const content = renderSegment(definition, markerSet, context).split(/\r?\n/).join(eol);
    const replacement = start + eol + content + eol + end;
    return {
      markdown: markdown.slice(0, legacy.start) + replacement + markdown.slice(legacy.end),
      changed: true,
      status: "inserted",
      errors,
    };
  }

  if (starts.length === 1 && ends.length === 1 && starts[0]! < ends[0]!) {
    if (definition.render === undefined) {
      return { markdown, changed: false, status: "skipped", errors };
    }
    const startIndex = starts[0]!;
    const endIndex = ends[0]!;
    const inner = markdown.slice(startIndex + start.length, endIndex);
    const content = renderSegment(definition, markerSet, context).split(/\r?\n/).join(eol);
    const expectedInner = eol + content + eol;
    if (inner === expectedInner) {
      return { markdown, changed: false, status: "unchanged", errors };
    }
    const next =
      markdown.slice(0, startIndex + start.length) +
      expectedInner +
      markdown.slice(endIndex);
    return { markdown: next, changed: true, status: "updated", errors };
  }

  if (starts.length > 1 || ends.length > 1) {
    errors.push(
      "duplicate " + definition.label + " markers (" + start + " x" + starts.length + ", " + end + " x" + ends.length + "); refusing to guess",
    );
  } else if (starts.length !== ends.length) {
    errors.push(
      "unpaired " + definition.label + " markers (" + start + " x" + starts.length + ", " + end + " x" + ends.length + ")",
    );
  } else {
    errors.push("end marker appears before start marker for the " + definition.label + " block");
  }
  return { markdown, changed: false, status: "skipped", errors };
}

/** Recover language / heading variant from the README's current block text. */
function detectContext(
  markdown: string,
  options: ReadmeTargetOptions,
): BlockRenderContext {
  let lang: Lang | undefined = options.lang;
  let variant: HeadingVariant | undefined = options.variant;
  for (const definition of BLOCK_DEFINITIONS) {
    if (definition.detect === undefined) continue;
    let raw: string | null = null;
    for (const markerSet of definition.markers) {
      const starts = markerIndexes(markdown, markerSet.start);
      const ends = markerIndexes(markdown, markerSet.end);
      if (starts.length === 1 && ends.length === 1 && starts[0]! < ends[0]!) {
        raw = markdown.slice(starts[0]! + markerSet.start.length, ends[0]!);
        break;
      }
    }
    if (raw === null) {
      const legacy = definition.locateLegacy?.(markdown) ?? null;
      if (legacy !== null) raw = markdown.slice(legacy.start, legacy.end);
    }
    if (raw === null) continue;
    const detected = definition.detect(raw);
    lang ??= detected.lang;
    variant ??= detected.variant;
  }
  return {
    manifest: options.manifest,
    version: options.version,
    cdnBase: options.cdnBase,
    lang: lang ?? "zh",
    variant,
  };
}

/**
 * Update one README.
 *
 * `init` seeds missing marker pairs at the legacy block position; `sync`
 * only rewrites already-marked text. In both modes a README with suspicious
 * merge-conflict residue or broken markers is left byte-identical.
 */
export function updateReadme(options: ReadmeUpdateOptions): ReadmeFileResult {
  const readmePath = resolve(options.root, options.readme ?? "README.md");
  const command = options.command ?? "sync";
  const result: ReadmeFileResult = {
    readmePath,
    ok: false,
    changed: false,
    written: false,
    blocks: [],
    errors: [],
  };

  let markdown: string;
  try {
    markdown = readFileSync(readmePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    result.errors.push(
      code === "ENOENT"
        ? "README not found: " + readmePath
        : "cannot read " + readmePath + ": " + (error as Error).message,
    );
    return result;
  }

  const suspicious = findSuspiciousLines(markdown);
  if (suspicious.length > 0) {
    for (const line of suspicious) {
      result.errors.push(
        readmePath +
          ":" +
          line.line +
          ": suspicious merge-conflict residue (" +
          line.reason +
          '): "' +
          line.text +
          '"; refusing to modify the README, fix it manually first',
      );
    }
    return result;
  }

  const context = detectContext(markdown, options);
  let next = markdown;
  for (const definition of implementedBlockDefinitions()) {
    for (const markerSet of definition.markers) {
      const applied = applyMarkerSet(next, definition, markerSet, context, command);
      next = applied.markdown;
      result.blocks.push({ name: definition.name, status: applied.status });
      for (const error of applied.errors) result.errors.push(readmePath + ": " + error);
    }
  }

  if (result.errors.length > 0) return result;

  result.changed = next !== markdown;
  if (options.check === true) {
    if (result.changed) {
      result.errors.push(
        readmePath + ": managed blocks are out of date; run readme:" + command + " to fix",
      );
      return result;
    }
    result.ok = true;
    return result;
  }

  if (result.changed) {
    writeFileAtomic(readmePath, next);
    result.written = true;
  }
  result.ok = true;
  return result;
}

/**
 * Update every target root (CLI `--root`, repeatable).
 *
 * All targets are processed even when one fails, so a maintainer sees every
 * problem in one run; `--all` (the CLI flag) merely mirrors that policy for
 * the multi-repository workflow.
 */
export function updateReadmes(options: ReadmeSyncOptions): ReadmeBatchResult {
  const files = options.roots.map((root) =>
    updateReadme({
      root,
      command: options.command ?? "sync",
      check: options.check,
      manifest: options.manifest,
      version: options.version,
      cdnBase: options.cdnBase,
      lang: options.lang,
      variant: options.variant,
    }),
  );
  return { ok: files.every((file) => file.ok), files };
}