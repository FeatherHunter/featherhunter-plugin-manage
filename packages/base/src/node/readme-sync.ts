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
  parseMoreBlock,
} from "./readme-compare";
import {
  renderContactBlock,
  renderMoreBlock,
  renderStarHistoryBlock,
  renderThanksBlock,
} from "./renderers";
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
  /** Recover the language, heading form and heading wording from a current block. */
  detect?: (raw: string) => { lang?: Lang; variant?: HeadingVariant; headingText?: string };
  /**
   * Whether the caller supplied the data this block renders. Definitions
   * without data are skipped instead of failing, so a CLI run that has no
   * thanks / star data yet still syncs the other blocks.
   */
  hasData?: (options: BlockRenderOptions) => boolean;
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
function detectContact(raw: string): { lang?: Lang; variant?: HeadingVariant; headingText?: string } {
  const parsed = parseContactBlock(raw);
  const heading = parsed.heading?.text ?? "";
  const lang: Lang = /[A-Za-z]/.test(heading) ? "en" : "zh";
  const variant: HeadingVariant =
    parsed.variant === "markdown-heading" ? "markdown-heading" : "html-heading";
  // A Markdown contact heading carries its own wording and may keep a sub-label
  // (ilife: "## 反馈与联系", prompt: "## 反馈与联系 <sub>CONNECT</sub>"); keep
  // both verbatim so the sync never rewrites the repository's heading style.
  if (variant === "markdown-heading" && parsed.heading !== null) {
    const sub = parsed.heading.sub;
    return {
      lang,
      variant,
      headingText: sub === null ? parsed.heading.text : parsed.heading.text + " <sub>" + sub + "</sub>",
    };
  }
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
 * Detect the language and heading form of a legacy MORE block.
 *
 * The heading text distinguishes zh from en and the two historical English
 * wordings ("More from the author" / "More by the author"); the wording is
 * returned so a sync keeps it instead of silently unifying it.
 */
function detectMore(raw: string): { lang?: Lang; variant?: HeadingVariant; headingText?: string } {
  const parsed = parseMoreBlock(raw);
  const heading = parsed.heading?.text ?? "";
  if (heading === "") return {};
  const lang: Lang = /[A-Za-z]/.test(heading) ? "en" : "zh";
  const variant: HeadingVariant =
    parsed.variant === "markdown-heading" ? "markdown-heading" : "html-heading";
  return { lang, variant, headingText: heading };
}

const MORE_HEADING_LINE = /^(?:<h2\b[^\n]*(?:\bMORE\b|作者的其他作品|More from the author|More by the author)[^\n]*<\/h2>|##\s+[^\n]*(?:\bMORE\b|作者的其他作品|More from the author|More by the author)[^\n]*)\s*$/i;
const THANKS_HEADING_LINE = /^(?:<h2\b[^\n]*(?:\bTHANKS\b|致谢|\bThanks\b|\bContributors\b)[^\n]*<\/h2>|##\s+[^\n]*(?:\bTHANKS\b|致谢|\bThanks\b|\bContributors\b)[^\n]*)\s*$/i;
const CONTACT_HEADING_LINE = /^(?:<h2\b[^\n]*(?:CONNECT|反馈与联系|Feedback and Contact)[^\n]*<\/h2>|##\s+[^\n]*(?:CONNECT|反馈与联系|Feedback and Contact)[^\n]*)\s*$/i;
const STAR_MARKER_LINE = /star-history[-a-z]*\.svg|star-history\.html|星标增长曲线|Star history chart/i;
const WRAPPING_DIV_LINE = /^\s*<div\b/i;
/** A managed block boundary already seeded by a previous init pass. */
const MANAGED_MARKER_LINE =
  /^\s*<!--\s*(?:CONTACT|MORE|STAR-HISTORY|THANKS-TABLE-[A-Z]+)-(?:START|END)\s*-->\s*$/;

interface MarkdownLine {
  text: string;
  /** Offset of the first character of the line. */
  start: number;
  /** Offset just past the last character of the line (without the EOL). */
  end: number;
}

/** Split a README into lines and character offsets (CRLF-safe). */
function markdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let offset = 0;
  for (const raw of markdown.split("\n")) {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    lines.push({ text, start: offset, end: offset + text.length });
    offset += raw.length + 1;
  }
  return lines;
}

function isFenceLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

/**
 * Index of the first line after `from` that starts another managed block, or
 * the number of lines when the block runs to the end of the README. A star
 * marker is widened back to the wrapping <div> so a boundary never cuts a
 * block in the middle.
 */
function nextManagedBlockLine(lines: readonly MarkdownLine[], from: number): number {
  let fence = false;
  for (let index = from; index < lines.length; index += 1) {
    const text = lines[index]!.text;
    if (isFenceLine(text)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (MANAGED_MARKER_LINE.test(text)) return index;
    if (MORE_HEADING_LINE.test(text) || THANKS_HEADING_LINE.test(text) || CONTACT_HEADING_LINE.test(text)) {
      // The next block's heading may sit inside a centring <div> of its own
      // (the prompt repositories wrap the THANKS heading). Start the boundary
      // at that wrapper so the previous block never swallows it.
      for (let back = index - 1; back >= 0; back -= 1) {
        if (lines[back]!.text.trim() === "") continue;
        if (WRAPPING_DIV_LINE.test(lines[back]!.text)) return back;
        break;
      }
      return index;
    }
    if (STAR_MARKER_LINE.test(text)) {
      for (let back = index - 1; back >= Math.max(0, index - 8); back -= 1) {
        if (WRAPPING_DIV_LINE.test(lines[back]!.text)) return back;
      }
      return index;
    }
  }
  return lines.length;
}

/**
 * Locate the legacy MORE block.
 *
 * The heading may be wrapped in a centring <div> (the prompt repositories), so
 * the start walks back to that wrapper. The block ends where the next managed
 * block begins, or at the end of the README, and trailing blank lines / `---`
 * rules are trimmed so a block inserted by init does not swallow the around
 * text. When no legacy heading exists (ilife) the block is appended at the end.
 */
function locateLegacyMore(markdown: string): LegacyBlockSpan | null {
  const lines = markdownLines(markdown);
  let fence = false;
  let headingIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!.text;
    if (isFenceLine(text)) {
      fence = !fence;
      continue;
    }
    if (!fence && MORE_HEADING_LINE.test(text)) {
      headingIndex = index;
      break;
    }
  }
  if (headingIndex === -1) {
    const insertion = markdown.trimEnd().length;
    return { start: insertion, end: markdown.length };
  }
  let startIndex = headingIndex;
  for (let back = headingIndex - 1; back >= 0; back -= 1) {
    if (lines[back]!.text.trim() === "") continue;
    if (WRAPPING_DIV_LINE.test(lines[back]!.text)) startIndex = back;
    break;
  }
  const boundary = nextManagedBlockLine(lines, headingIndex + 1);
  // A footer that follows a top-level `---` rule (deck-en's Q&A / licence, im's
  // CTA) is not part of the block: it must survive byte-for-byte after the end
  // marker. Everything up to the rule is replaced.
  let footerIndex = -1;
  for (let index = headingIndex + 1; index < boundary; index += 1) {
    if (!/^-{3,}$/.test(lines[index]!.text.trim())) continue;
    for (let after = index + 1; after < boundary; after += 1) {
      if (lines[after]!.text.trim() !== "") {
        footerIndex = index;
        break;
      }
    }
    if (footerIndex !== -1) break;
  }
  let endIndex = footerIndex === -1 ? boundary - 1 : footerIndex - 1;
  while (endIndex >= startIndex && lines[endIndex]!.text.trim() === "") {
    endIndex -= 1;
  }
  if (footerIndex === -1) {
    while (endIndex >= startIndex && /^-{3,}$/.test(lines[endIndex]!.text.trim())) {
      endIndex -= 1;
    }
  }
  if (endIndex < startIndex) return null;
  return { start: lines[startIndex]!.start, end: lines[endIndex]!.end };
}

/**
 * Locate the legacy star-history block.
 *
 * The block starts at the wrapping centring <div> (the chart and, for deck,
 * its standalone-page link live inside it) and ends at the closing </div>.
 * When no chart survives in the README (ilife) the block is appended at the end.
 */
function locateLegacyStarHistory(markdown: string): LegacyBlockSpan | null {
  const lines = markdownLines(markdown);
  let fence = false;
  let markerIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!.text;
    if (isFenceLine(text)) {
      fence = !fence;
      continue;
    }
    if (!fence && STAR_MARKER_LINE.test(text)) {
      markerIndex = index;
      break;
    }
  }
  if (markerIndex === -1) {
    const insertion = markdown.trimEnd().length;
    return { start: insertion, end: markdown.length };
  }
  let startIndex = markerIndex;
  for (let back = markerIndex - 1; back >= Math.max(0, markerIndex - 8); back -= 1) {
    if (WRAPPING_DIV_LINE.test(lines[back]!.text)) {
      startIndex = back;
      break;
    }
  }
  const closingDiv = /^\s*<\/div\b/i;
  for (let index = markerIndex + 1; index < lines.length; index += 1) {
    if (closingDiv.test(lines[index]!.text)) {
      return { start: lines[startIndex]!.start, end: lines[index]!.end };
    }
  }
  return { start: lines[startIndex]!.start, end: markdown.trimEnd().length };
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
  {
    name: "star-history",
    label: "star-history",
    markers: [{ start: BLOCK_MARKERS.starHistory.start, end: BLOCK_MARKERS.starHistory.end }],
    render: (context) => renderStarHistoryBlock(context),
    locateLegacy: locateLegacyStarHistory,
    hasData: (options) => options.starHistory !== undefined,
  },
  // One marker pair per language; which pair exists tells the language of the
  // README. Only the table between the markers is managed: the surrounding
  // heading / intro / footer prose differ per repository and stay untouched.
  {
    name: "thanks",
    label: "thanks",
    markers: [
      { lang: "zh", start: THANKS_ZH_MARKERS.start, end: THANKS_ZH_MARKERS.end },
      { lang: "en", start: THANKS_EN_MARKERS.start, end: THANKS_EN_MARKERS.end },
    ],
    render: (context) => renderThanksBlock(context),
    hasData: (options) => options.thanks !== undefined,
  },
  {
    name: "more",
    label: "more",
    markers: [{ start: BLOCK_MARKERS.more.start, end: BLOCK_MARKERS.more.end }],
    render: (context) => renderMoreBlock(context),
    locateLegacy: locateLegacyMore,
    detect: detectMore,
  },
];

/** Look up one block definition by name. */
export function blockDefinition(name: BlockName): BlockDefinition | undefined {
  return BLOCK_DEFINITIONS.find((definition) => definition.name === name);
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

/** Render the content of one marker segment (resolved per-language and block). */
function renderSegment(
  definition: BlockDefinition,
  markerSet: BlockMarkerSet,
  context: ResolvedBlockContext,
): string {
  if (definition.render === undefined) throw new Error("block has no renderer: " + definition.name);
  return definition.render({
    ...context.options,
    lang: markerSet.lang ?? context.lang,
    variant: context.variants[definition.name] ?? context.options.variant,
    headingText: context.headings[definition.name] ?? context.options.headingText,
  });
}

/** Replace the text between one marker pair, or (init) insert the pair. */
function applyMarkerSet(
  markdown: string,
  definition: BlockDefinition,
  markerSet: BlockMarkerSet,
  context: ResolvedBlockContext,
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
    // A per-language marker pair that is absent from a README of the other
    // language is not missing, just not applicable (deck's zh README has no
    // English thanks table).
    if (markerSet.lang !== undefined && markerSet.lang !== context.lang) {
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
    // A block inserted at the end of the README still needs a blank line
    // between the existing content and the start marker.
    const before = markdown.slice(0, legacy.start);
    let lead = "";
    if (legacy.start === legacy.end && before.length > 0) {
      if (!/(?:\r?\n){2}$/.test(before)) lead = /\n$/.test(before) ? eol : eol + eol;
    }
    const replacement = lead + start + eol + content + eol + end;
    return {
      markdown: before + replacement + markdown.slice(legacy.end),
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

/**
 * Render context recovered from the README.
 *
 * Heading form and wording are recovered per block: the prompt repositories
 * mix an HTML contact block with a Markdown MORE heading, so one global
 * variant would overwrite the other block's convention.
 */
interface ResolvedBlockContext {
  /** Data options forwarded to the renderers. */
  options: BlockRenderOptions;
  lang: Lang;
  variants: Partial<Record<BlockName, HeadingVariant>>;
  headings: Partial<Record<BlockName, string>>;
}

/** Recover language, heading variant and heading wording from the current README. */
function detectContext(markdown: string, options: ReadmeTargetOptions): ResolvedBlockContext {
  let lang: Lang | undefined = options.lang;
  const variants: Partial<Record<BlockName, HeadingVariant>> = {};
  const headings: Partial<Record<BlockName, string>> = {};
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
    if (detected.variant !== undefined) variants[definition.name] ??= detected.variant;
    if (detected.headingText !== undefined) headings[definition.name] ??= detected.headingText;
  }
  return {
    options: {
      manifest: options.manifest,
      version: options.version,
      cdnBase: options.cdnBase,
      selfId: options.selfId,
      headingText: options.headingText,
      starHistory: options.starHistory,
      thanks: options.thanks,
    },
    lang: lang ?? "zh",
    variants,
    headings,
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
  for (const definition of BLOCK_DEFINITIONS) {
    if (definition.hasData !== undefined && !definition.hasData(context.options)) {
      result.blocks.push({ name: definition.name, status: "skipped" });
      continue;
    }
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
      readme: options.readme,
      command: options.command ?? "sync",
      check: options.check,
      manifest: options.manifest,
      version: options.version,
      cdnBase: options.cdnBase,
      lang: options.lang,
      variant: options.variant,
      selfId: options.selfId,
      headingText: options.headingText,
      starHistory: options.starHistory,
      thanks: options.thanks,
    }),
  );
  return { ok: files.every((file) => file.ok), files };
}

/** Options for updating an explicit list of targets (CLI `--all --repos`). */
export interface ReadmeTargetListOptions {
  /** `init` may insert missing marker pairs; `sync` only rewrites marked text. */
  command?: "init" | "sync";
  /** Report drift without writing. */
  check?: boolean;
}

/**
 * Update an explicit list of targets (CLI `--all --repos`).
 *
 * Unlike {@link updateReadmes}, which applies one set of options to several
 * roots, every target carries its own README path, language, self id and
 * per-repository star / thanks data. Every target is attempted even when one
 * fails, so the maintainer sees all problems in one run.
 */
export function updateReadmeTargets(
  targets: readonly ReadmeTargetOptions[],
  options: ReadmeTargetListOptions = {},
): ReadmeBatchResult {
  const files = targets.map((target) =>
    updateReadme({
      ...target,
      command: options.command ?? "sync",
      check: options.check,
    }),
  );
  return { ok: files.every((file) => file.ok), files };
}
