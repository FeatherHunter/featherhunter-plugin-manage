/**
 * README block extraction and normalized comparison.
 *
 * The five plugin repositories hand-write four README blocks (contact, star
 * history, thanks, author plugins) in slightly different shapes. This module
 * (a) locates those blocks in a README text, (b) parses each shape leniently
 * into a comparable structure, and (c) compares two blocks by *content*
 * (members / links / texts / widths / thanks table data), reporting pure
 * formatting differences separately.
 *
 * It is deliberately dependency-free (no node: imports) so both the ./node
 * entry and the fixture extraction script can use it.
 */

/** Kind of a managed README block. */
export type ReadmeBlockKind = "contact" | "star-history" | "thanks" | "more";

/** A line that looks like merge-conflict residue; writers must stop. */
export interface SuspiciousLine {
  /** 1-based line number. */
  line: number;
  /** The offending line, verbatim. */
  text: string;
  reason: "conflict-start" | "conflict-separator" | "conflict-end" | "merge-conflict-residue";
}

/** Raw block slices located in a README text. */
export interface LocatedBlocks {
  /** Raw block text per kind; null when the block is absent. */
  blocks: Record<ReadmeBlockKind, string | null>;
  /** Block kinds in the order they appear in the file. */
  order: ReadmeBlockKind[];
  /** Merge-conflict residue / suspicious lines found anywhere in the file. */
  suspicious: SuspiciousLine[];
}

const MORE_HEADING = /\bMORE\b|作者的其他作品|More from the author|More by the author/i;
const THANKS_HEADING = /\bTHANKS\b|致谢|\bThanks\b|\bContributors\b/i;
const CONTACT_HEADING = /\bCONNECT\b|反馈与联系|Feedback and Contact/i;
const STAR_MARKER = /star-history[-a-z]*\.svg|star-history\.html|星标增长曲线|Star history chart/i;
const DIV_OPEN = /^\s*<div\b/i;

interface RawCandidate {
  kind: ReadmeBlockKind;
  start: number;
}

function headingKind(line: string): ReadmeBlockKind | null {
  const trimmed = line.trim();
  const isHtmlH2 = /^<h2\b/i.test(trimmed);
  const isMarkdownH2 = /^##\s+/.test(trimmed) && !/^###/.test(trimmed);
  if (!isHtmlH2 && !isMarkdownH2) return null;
  if (MORE_HEADING.test(trimmed)) return "more";
  if (THANKS_HEADING.test(trimmed)) return "thanks";
  if (CONTACT_HEADING.test(trimmed)) return "contact";
  return null;
}

/** Extend a block start backwards over blank lines to include a wrapping div. */
function includeWrappingDiv(lines: readonly string[], start: number): number {
  let index = start - 1;
  while (index >= 0 && lines[index]!.trim() === "") index -= 1;
  if (index >= 0 && DIV_OPEN.test(lines[index]!)) return index;
  return start;
}

function findStarBlockStart(lines: readonly string[], marker: number): number {
  for (let index = marker; index >= 0 && marker - index <= 8; index -= 1) {
    if (DIV_OPEN.test(lines[index]!)) return index;
  }
  return marker;
}

/** Drop leading/trailing blank lines and trailing horizontal rules. */
function trimBlock(rawLines: readonly string[]): string {
  const lines = [...rawLines];
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  for (;;) {
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
    if (lines.length > 0 && /^-{3,}$/.test(lines[lines.length - 1]!.trim())) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n");
}

/**
 * Locate the four managed blocks in a README text.
 *
 * Boundaries are the next managed-block start (or EOF), trimmed of blank lines
 * and trailing `---` rules. Block order is recorded but never assumed: the
 * five repos currently order the blocks differently.
 */
export function locateReadmeBlocks(markdown: string): LocatedBlocks {
  const lines = markdown.split(/\r?\n/);
  const candidates: RawCandidate[] = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const kind = headingKind(line);
    if (kind !== null) {
      candidates.push({ kind, start: includeWrappingDiv(lines, index) });
      continue;
    }
    if (STAR_MARKER.test(line)) {
      candidates.push({ kind: "star-history", start: findStarBlockStart(lines, index) });
    }
  }

  // Deduplicate (first occurrence wins) and sort by position.
  const seen = new Set<ReadmeBlockKind>();
  const ordered: RawCandidate[] = [];
  for (const candidate of candidates.sort((a, b) => a.start - b.start)) {
    if (seen.has(candidate.kind)) continue;
    seen.add(candidate.kind);
    ordered.push(candidate);
  }

  const blocks: Record<ReadmeBlockKind, string | null> = {
    contact: null,
    "star-history": null,
    thanks: null,
    more: null,
  };
  const order: ReadmeBlockKind[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index]!;
    const end = index + 1 < ordered.length ? ordered[index + 1]!.start : lines.length;
    blocks[candidate.kind] = trimBlock(lines.slice(candidate.start, end));
    order.push(candidate.kind);
  }

  return { blocks, order, suspicious: findSuspiciousLines(markdown) };
}

const CONFLICT_START = /^\s*<{7}(?:\s|$)/;
const CONFLICT_SEPARATOR = /^\s*={7}\s*$/;
const CONFLICT_END = /^\s*>{7}(?:\s|$)/;
const MERGE_RESIDUE = /<{7}\s+\S|>{7}\s+\S/;

/** Find merge-conflict residue. Writers must stop and hand the file to a human. */
export function findSuspiciousLines(markdown: string): SuspiciousLine[] {
  const found: SuspiciousLine[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    let reason: SuspiciousLine["reason"] | null = null;
    if (CONFLICT_START.test(line)) reason = "conflict-start";
    else if (CONFLICT_SEPARATOR.test(line)) reason = "conflict-separator";
    else if (CONFLICT_END.test(line)) reason = "conflict-end";
    else if (MERGE_RESIDUE.test(line)) reason = "merge-conflict-residue";
    if (reason !== null) found.push({ line: index + 1, text: line, reason });
  });
  return found;
}

// ---------------------------------------------------------------------------
// Shared parsing helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity: string, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? entity : String.fromCodePoint(code);
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? entity : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/** Strip tags / markdown links / comments, decode entities, collapse whitespace. */
function stripTags(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return text.replace(/\s+/g, " ").trim();
}

/** Parse an HTML attribute string into a lower-cased attribute map. */
export function parseAttributes(attributeText: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(attributeText)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes[match[1]!.toLowerCase()] = decodeEntities(value);
  }
  return attributes;
}

/** File name of an image src, dropping directory prefix, query and hash. */
export function assetName(src: string): string {
  const clean = src.split(/[?#]/)[0]!.trim();
  const segments = clean.split(/[\\/]+/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1]! : "";
}

function toWidth(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Parsed block heading; `sub` is the small label (CONNECT / THANKS / MORE). */
export interface ParsedHeading {
  sub: string | null;
  text: string;
}

/** Parse the heading of a managed block in either HTML or Markdown form. */
export function parseHeading(raw: string): ParsedHeading | null {
  const html = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(raw);
  const markdown = /^##\s+(.+)$/m.exec(raw);
  const inner = html !== null ? html[1]! : markdown !== null ? markdown[1]! : null;
  if (inner === null) return null;
  const subMatch = /<sub>([\s\S]*?)<\/sub>/i.exec(inner);
  const sub = subMatch !== null ? stripTags(subMatch[1]!) : null;
  const text = stripTags(inner.replace(/<sub>[\s\S]*?<\/sub>/i, " "));
  return { sub: sub !== null && sub !== "" ? sub : null, text };
}

// ---------------------------------------------------------------------------
// Contact block
// ---------------------------------------------------------------------------

/** One group (chat group QR code) inside the contact block. */
export interface ContactGroup {
  /** Table header text, e.g. 飞书群（主）. */
  title: string;
  /** Image src exactly as written (relative or absolute). */
  src: string;
  /** Image file name; stable across relative prefixes and CDN URLs. */
  asset: string;
  /** Rendered image width, if any. */
  width: number | null;
  alt: string;
}

/** Parsed contact block. */
export interface ParsedContactBlock {
  variant: "html-heading" | "markdown-heading";
  heading: ParsedHeading | null;
  welcome: string | null;
  groups: ContactGroup[];
}

/** Parse the contact block in either heading variant. */
export function parseContactBlock(raw: string): ParsedContactBlock {
  const variant = /<h2\b/i.test(raw) ? "html-heading" : "markdown-heading";
  const heading = parseHeading(raw);

  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(raw);
  const rows = table !== null ? [...table[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)] : [];
  const titleRow = rows.find((row) => /<b\b/i.test(row[1]!));
  const imageRow = rows.find((row) => /<img\b/i.test(row[1]!));
  const titles = titleRow !== undefined
    ? [...titleRow[1]!.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>/gi)].map((match) => stripTags(match[1]!))
    : [];
  const images = imageRow !== undefined
    ? [...imageRow[1]!.matchAll(/<img\b([^>]*)>/gi)].map((match) => parseAttributes(match[1]!))
    : [];
  const groups = images.map((attributes, index) => {
    const src = attributes.src ?? "";
    return {
      title: titles[index] ?? "",
      src,
      asset: assetName(src),
      width: toWidth(attributes.width),
      alt: attributes.alt ?? "",
    };
  });

  let rest = raw;
  const htmlHeading = /<h2\b[^>]*>[\s\S]*?<\/h2>/i.exec(rest);
  if (htmlHeading !== null) rest = rest.replace(htmlHeading[0], " ");
  else rest = rest.replace(/^##\s+.*$/m, " ");
  rest = rest.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, " ");
  const welcome = stripTags(rest);

  return { variant, heading, welcome: welcome === "" ? null : welcome, groups };
}

// ---------------------------------------------------------------------------
// Star history block
// ---------------------------------------------------------------------------

/** A dark/light `<source>` inside a `<picture>`. */
export interface StarSource {
  /** "dark" / "light" when declared, otherwise null. */
  media: string | null;
  src: string;
  /** Image file name, stable across CDN URLs and cache busters. */
  asset: string;
}

/** The visible star history image. */
export interface StarImage {
  alt: string;
  src: string;
  asset: string;
  width: number | null;
}

/** Parsed star history block. */
export interface ParsedStarHistoryBlock {
  variant: "picture-link" | "picture" | "markdown-image" | "unknown";
  /** Click-through link around the picture, e.g. deck's star-history.html. */
  link: string | null;
  sources: StarSource[];
  image: StarImage | null;
  /** Caption below the image (im keeps a two-axis explanation). */
  caption: string | null;
}

function firstSourceValue(attributes: Record<string, string>): string {
  const raw = attributes.srcset ?? attributes.src ?? "";
  return raw.split(/[\s,]+/).filter(Boolean)[0] ?? "";
}

function sourceMedia(attributes: Record<string, string>): string | null {
  const media = attributes.media ?? "";
  const match = /prefers-color-scheme:\s*(dark|light)/i.exec(media);
  return match !== null ? match[1]!.toLowerCase() : null;
}

function toImage(attributes: Record<string, string>): StarImage {
  const src = attributes.src ?? "";
  return { alt: attributes.alt ?? "", src, asset: assetName(src), width: toWidth(attributes.width) };
}

/** Parse the star history block in any of its four current shapes. */
export function parseStarHistoryBlock(raw: string): ParsedStarHistoryBlock {
  const picture = /<picture\b[^>]*>([\s\S]*?)<\/picture>/i.exec(raw);
  const imageTag = /<img\b([^>]*)>/i.exec(picture !== null ? picture[1]! : raw);
  let image = imageTag !== null ? toImage(parseAttributes(imageTag[1]!)) : null;
  if (image === null) {
    const markdownImage = /!\[([^\]]*)\]\(\s*([^)\s]+)/.exec(raw);
    if (markdownImage !== null) {
      const src = markdownImage[2]!;
      image = { alt: markdownImage[1]!, src, asset: assetName(src), width: null };
    }
  }

  const sources: StarSource[] = [];
  if (picture !== null) {
    for (const match of picture[1]!.matchAll(/<source\b([^>]*)>/gi)) {
      const attributes = parseAttributes(match[1]!);
      const src = firstSourceValue(attributes);
      sources.push({ media: sourceMedia(attributes), src, asset: assetName(src) });
    }
  }

  const linkTag = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(raw);
  const link = linkTag !== null ? decodeEntities(linkTag[1]!) : null;

  const sub = /<sub>([\s\S]*?)<\/sub>/i.exec(raw);
  const caption = sub !== null ? stripTags(sub[1]!) : null;

  let variant: ParsedStarHistoryBlock["variant"];
  if (picture !== null) variant = link !== null ? "picture-link" : "picture";
  else if (/!\[[^\]]*\]\([^)]*\)/.test(raw)) variant = "markdown-image";
  else variant = "unknown";

  return {
    variant,
    link,
    sources,
    image,
    caption: caption !== null && caption !== "" ? caption : null,
  };
}

// ---------------------------------------------------------------------------
// Shared prose helpers
// ---------------------------------------------------------------------------

/** Remove the block heading (HTML h2 or Markdown ## line) from a block. */
function removeHeading(raw: string): string {
  const html = /<h2\b[^>]*>[\s\S]*?<\/h2>/i.exec(raw);
  if (html !== null) return raw.replace(html[0], " ");
  return raw.replace(/^##\s+.*$/m, " ");
}

/** Join lines, drop horizontal rules, strip markup, collapse whitespace. */
function prose(lines: readonly string[]): string | null {
  const text = stripTags(lines.filter((line) => !/^\s*-{3,}\s*$/.test(line)).join("\n"));
  return text === "" ? null : text;
}

// ---------------------------------------------------------------------------
// Thanks block
// ---------------------------------------------------------------------------

/** One table cell of the thanks table. */
export interface ThanksCell {
  /** Visible text (links reduced to their label). */
  text: string;
  /** Link targets found in the cell, in order. */
  links: string[];
}

/** One row of the thanks table. */
export interface ThanksRow {
  cells: ThanksCell[];
}

/** Parsed thanks block. */
export interface ParsedThanksBlock {
  variant: "html-heading" | "markdown-heading";
  heading: ParsedHeading | null;
  /** Language of the table markers (THANKS-TABLE-ZH / -EN). */
  lang: "zh" | "en" | null;
  headers: string[];
  rows: ThanksRow[];
  /** Non-table prose around the table, kept for fixtures but not compared. */
  prose: string | null;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let buffer = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (character === "\\" && trimmed[index + 1] === "|") {
      buffer += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(buffer);
      buffer = "";
    } else {
      buffer += character;
    }
  }
  cells.push(buffer);
  return cells.map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*\|?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

function toThanksCell(rawCell: string): ThanksCell {
  const links: string[] = [];
  for (const match of rawCell.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) links.push(match[2]!);
  return { text: stripTags(rawCell), links };
}

/** Parse the thanks block, including the empty-table case used by ilife. */
export function parseThanksBlock(raw: string): ParsedThanksBlock {
  const variant = /<h2\b/i.test(raw) ? "html-heading" : "markdown-heading";
  const heading = parseHeading(raw);
  const marker = /<!--\s*THANKS-TABLE-(ZH|EN)-START\s*-->/i.exec(raw);
  const lang = marker !== null ? (marker[1]!.toLowerCase() as "zh" | "en") : null;

  const tableLines = raw.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
  const dataLines = tableLines.filter((line) => !isTableSeparator(line));
  const headers = dataLines.length > 0 ? splitTableRow(dataLines[0]!).map((cell) => stripTags(cell)) : [];
  const rows: ThanksRow[] = dataLines.slice(1).map((line) => ({ cells: splitTableRow(line).map(toThanksCell) }));

  const body = removeHeading(raw);
  const proseText = prose(body.split(/\r?\n/).filter((line) => !/^\s*\|/.test(line)));

  return { variant, heading, lang, headers, rows, prose: proseText };
}

// ---------------------------------------------------------------------------
// More block (author's other plugins)
// ---------------------------------------------------------------------------

/** One plugin row in the "more from the author" block. */
export interface MoreItem {
  name: string;
  url: string;
  description: string;
}

/** Parsed "more from the author" block. */
export interface ParsedMoreBlock {
  variant: "html-heading" | "markdown-heading";
  heading: ParsedHeading | null;
  intro: string | null;
  items: MoreItem[];
  footer: string | null;
}

const MORE_ITEM = /^\s*\*\*\s*\[([^\]]+)\]\(([^)\s]+)\)\s*\*\*\s*(.*)$/;

/** Parse the "more from the author" block. Rows are returned in file order. */
export function parseMoreBlock(raw: string): ParsedMoreBlock {
  const variant = /<h2\b/i.test(raw) ? "html-heading" : "markdown-heading";
  const heading = parseHeading(raw);
  const lines = raw.split(/\r?\n/);
  const itemIndexes: number[] = [];
  const items: MoreItem[] = [];
  lines.forEach((line, index) => {
    const match = MORE_ITEM.exec(line);
    if (match === null) return;
    const description = match[3]!.replace(/^(?:——|—|--|-)\s*/, "").trim();
    items.push({ name: stripTags(match[1]!), url: match[2]!, description: stripTags(description) });
    itemIndexes.push(index);
  });

  const headingRemoved = removeHeading(raw).split(/\r?\n/);
  const firstItem = itemIndexes.length > 0 ? itemIndexes[0]! : -1;
  const lastItem = itemIndexes.length > 0 ? itemIndexes[itemIndexes.length - 1]! : -1;
  const intro = prose(headingRemoved.slice(0, firstItem === -1 ? headingRemoved.length : firstItem));
  const footer = lastItem === -1 ? null : prose(headingRemoved.slice(lastItem + 1));

  return { variant, heading, intro, items, footer };
}

// ---------------------------------------------------------------------------
// Normalized comparison
// ---------------------------------------------------------------------------

/** Formatting-only differences; they never make a block content-different. */
export type FormatStage = "line-endings" | "whitespace" | "quotes" | "attribute-order" | "self-closing";

/** A formatting difference kind (`markup` = structural markup beyond the stages). */
export type FormatDifferenceKind = FormatStage | "heading-variant" | "markup";

/** One detected pure-format difference. */
export interface FormatDifference {
  kind: FormatDifferenceKind;
  /** Set when the difference was found at README level. */
  block?: ReadmeBlockKind;
}

/** Content difference dimensions required by the equivalence criterion. */
export type DifferenceDimension = "presence" | "members" | "links" | "text" | "width" | "table" | "image";

/** One content difference, addressed by a structural path. */
export interface Difference {
  dimension: DifferenceDimension;
  path: string;
  expected: unknown;
  actual: unknown;
}

/** Comparison options. */
export interface CompareOptions {
  /**
   * How image sources are compared. `basename` (default) ignores relative/CDN
   * prefixes and `?v=` cache busters; `exact` compares the raw src.
   */
  imageSrc?: "basename" | "exact";
}

/** Result of comparing one managed block. */
export interface BlockComparison {
  kind: ReadmeBlockKind;
  /** Raw text is byte-identical. */
  identical: boolean;
  /** Content is equivalent under the F18 criterion. */
  equivalent: boolean;
  contentDifferences: Difference[];
  /** Only populated when content is equivalent but raw text differs. */
  formatDifferences: FormatDifference[];
}

/** Result of comparing two READMEs. */
export interface ReadmeComparison {
  equivalent: boolean;
  blocks: Record<ReadmeBlockKind, BlockComparison>;
  contentDifferences: Difference[];
  formatDifferences: FormatDifference[];
  order: { expected: ReadmeBlockKind[]; actual: ReadmeBlockKind[]; same: boolean };
  /** Merge-conflict residue from the actual README: callers must stop. */
  suspicious: SuspiciousLine[];
}

const MARKUP_STAGES: readonly FormatStage[] = [
  "line-endings",
  "whitespace",
  "quotes",
  "attribute-order",
  "self-closing",
];

const SELF_CLOSING_VOID = /<(img|source|br|hr|input|meta|link)\b([^>]*?)\s*\/>/gi;

function normalizeForCompare(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) normalized[key] = normalizeForCompare(source[key]);
    return normalized;
  }
  return value;
}

function sameValue(expected: unknown, actual: unknown): boolean {
  return JSON.stringify(normalizeForCompare(expected)) === JSON.stringify(normalizeForCompare(actual));
}

function pushDifference(
  differences: Difference[],
  dimension: DifferenceDimension,
  path: string,
  expected: unknown,
  actual: unknown,
): void {
  if (sameValue(expected, actual)) return;
  differences.push({ dimension, path, expected, actual });
}

/** Rebuild one HTML tag with sorted attributes and double quotes. */
function canonicalTag(tag: string): string {
  const match = /^<([a-zA-Z][\w:-]*)((?:\s[^>]*?)?)\s*(\/?)>$/.exec(tag);
  if (match === null) return tag;
  const name = match[1]!;
  const attributes = parseAttributes(match[2] ?? "");
  const rebuilt = Object.keys(attributes)
    .sort()
    .map((key) => key + '="' + attributes[key] + '"')
    .join(" ");
  const selfClosing = match[3] === "/" ? " /" : "";
  return "<" + name + (rebuilt === "" ? "" : " " + rebuilt) + selfClosing + ">";
}

function applyStage(text: string, stage: FormatStage): string {
  switch (stage) {
    case "line-endings":
      return text.replace(/\r\n?/g, "\n");
    case "whitespace": {
      const collapsedTags = text.replace(/<[a-zA-Z][^>]*>/g, (tag) => tag.replace(/\s+/g, " "));
      const lines = collapsedTags
        .split(/\r?\n/)
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter((line) => line !== "");
      return lines.join("\n").replace(/>\s*\n\s*</g, "><").trim();
    }
    case "quotes":
      return text.replace(/<[a-zA-Z][^>]*>/g, (tag) => tag.replace(/([a-zA-Z-]+)\s*=\s*'([^']*)'/g, '$1="$2"'));
    case "attribute-order":
      return text.replace(/<[a-zA-Z][^>]*>/g, canonicalTag);
    case "self-closing":
      return text.replace(SELF_CLOSING_VOID, "<$1$2>");
  }
}

/** Canonical form that erases whitespace, quote, attribute-order and self-close style. */
export function canonicalizeMarkup(markup: string): string {
  return MARKUP_STAGES.reduce((text, stage) => applyStage(text, stage), markup);
}

/** Report the formatting stages whose normalisation is needed to reach equality. */
function detectFormatHints(expected: string, actual: string): FormatDifference[] {
  const changed: FormatDifference[] = [];
  let expectedText = expected;
  let actualText = actual;
  for (const stage of MARKUP_STAGES) {
    const nextExpected = applyStage(expectedText, stage);
    const nextActual = applyStage(actualText, stage);
    const stageChanged = nextExpected !== expectedText || nextActual !== actualText;
    expectedText = nextExpected;
    actualText = nextActual;
    if (stageChanged) changed.push({ kind: stage });
    if (expectedText === actualText) return changed;
  }
  return [{ kind: "markup" }];
}

/** Heading variant of a block, or null for blocks without headings. */
function headingVariant(kind: ReadmeBlockKind, raw: string): string | null {
  switch (kind) {
    case "contact":
      return parseContactBlock(raw).variant;
    case "star-history":
      return null;
    case "thanks":
      return parseThanksBlock(raw).variant;
    case "more":
      return parseMoreBlock(raw).variant;
  }
}

function compareContactBlocks(expectedRaw: string, actualRaw: string, options: CompareOptions): Difference[] {
  const expected = parseContactBlock(expectedRaw);
  const actual = parseContactBlock(actualRaw);
  const differences: Difference[] = [];
  pushDifference(differences, "text", "contact.heading", expected.heading?.text ?? null, actual.heading?.text ?? null);
  pushDifference(differences, "members", "contact.groups", expected.groups.length, actual.groups.length);
  const count = Math.max(expected.groups.length, actual.groups.length);
  for (let index = 0; index < count; index += 1) {
    const expectedGroup = expected.groups[index];
    const actualGroup = actual.groups[index];
    const path = "contact.groups[" + index + "]";
    if (expectedGroup === undefined || actualGroup === undefined) {
      pushDifference(differences, "members", path, expectedGroup ?? null, actualGroup ?? null);
      continue;
    }
    pushDifference(differences, "text", path + ".title", expectedGroup.title, actualGroup.title);
    pushDifference(differences, "text", path + ".alt", expectedGroup.alt, actualGroup.alt);
    pushDifference(differences, "width", path + ".width", expectedGroup.width, actualGroup.width);
    if (options.imageSrc === "exact") {
      pushDifference(differences, "image", path + ".src", expectedGroup.src, actualGroup.src);
    } else {
      pushDifference(differences, "image", path + ".asset", expectedGroup.asset, actualGroup.asset);
    }
  }
  return differences;
}

function sortedSources(sources: readonly StarSource[]): StarSource[] {
  return [...sources].sort((left, right) => {
    const byMedia = (left.media ?? "").localeCompare(right.media ?? "");
    return byMedia !== 0 ? byMedia : left.asset.localeCompare(right.asset);
  });
}

function compareStarHistoryBlocks(expectedRaw: string, actualRaw: string, options: CompareOptions): Difference[] {
  const expected = parseStarHistoryBlock(expectedRaw);
  const actual = parseStarHistoryBlock(actualRaw);
  const differences: Difference[] = [];
  pushDifference(differences, "links", "star-history.link", expected.link, actual.link);

  if (expected.image === null || actual.image === null) {
    pushDifference(
      differences,
      "image",
      "star-history.image",
      expected.image === null ? null : "present",
      actual.image === null ? null : "present",
    );
  } else {
    pushDifference(differences, "text", "star-history.image.alt", expected.image.alt, actual.image.alt);
    pushDifference(differences, "width", "star-history.image.width", expected.image.width, actual.image.width);
    if (options.imageSrc === "exact") {
      pushDifference(differences, "image", "star-history.image.src", expected.image.src, actual.image.src);
    } else {
      pushDifference(differences, "image", "star-history.image.asset", expected.image.asset, actual.image.asset);
    }
  }

  const expectedSources = sortedSources(expected.sources);
  const actualSources = sortedSources(actual.sources);
  if (expectedSources.length !== actualSources.length) {
    pushDifference(
      differences,
      "image",
      "star-history.sources",
      expectedSources.map((source) => [source.media, source.asset]),
      actualSources.map((source) => [source.media, source.asset]),
    );
  } else {
    expectedSources.forEach((source, index) => {
      const actualSource = actualSources[index]!;
      pushDifference(differences, "image", "star-history.sources[" + index + "].media", source.media, actualSource.media);
      if (options.imageSrc === "exact") {
        pushDifference(differences, "image", "star-history.sources[" + index + "].src", source.src, actualSource.src);
      } else {
        pushDifference(differences, "image", "star-history.sources[" + index + "].asset", source.asset, actualSource.asset);
      }
    });
  }

  pushDifference(differences, "text", "star-history.caption", expected.caption, actual.caption);
  return differences;
}

function compareThanksBlocks(expectedRaw: string, actualRaw: string): Difference[] {
  const expected = parseThanksBlock(expectedRaw);
  const actual = parseThanksBlock(actualRaw);
  const differences: Difference[] = [];
  pushDifference(differences, "text", "thanks.heading", expected.heading?.text ?? null, actual.heading?.text ?? null);
  pushDifference(differences, "table", "thanks.headers", expected.headers, actual.headers);
  const headerCount = Math.max(expected.headers.length, actual.headers.length);
  for (let index = 0; index < headerCount; index += 1) {
    pushDifference(differences, "table", "thanks.headers[" + index + "]", expected.headers[index] ?? null, actual.headers[index] ?? null);
  }
  pushDifference(differences, "table", "thanks.rows", expected.rows.length, actual.rows.length);
  const rowCount = Math.max(expected.rows.length, actual.rows.length);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const expectedRow = expected.rows[rowIndex];
    const actualRow = actual.rows[rowIndex];
    const rowPath = "thanks.rows[" + rowIndex + "]";
    if (expectedRow === undefined || actualRow === undefined) {
      pushDifference(differences, "table", rowPath, expectedRow ?? null, actualRow ?? null);
      continue;
    }
    pushDifference(differences, "table", rowPath + ".cells", expectedRow.cells.length, actualRow.cells.length);
    const cellCount = Math.max(expectedRow.cells.length, actualRow.cells.length);
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
      const expectedCell = expectedRow.cells[cellIndex];
      const actualCell = actualRow.cells[cellIndex];
      const cellPath = rowPath + ".cells[" + cellIndex + "]";
      if (expectedCell === undefined || actualCell === undefined) {
        pushDifference(differences, "table", cellPath, expectedCell ?? null, actualCell ?? null);
        continue;
      }
      pushDifference(differences, "table", cellPath + ".text", expectedCell.text, actualCell.text);
      pushDifference(differences, "links", cellPath + ".links", expectedCell.links, actualCell.links);
      const linkCount = Math.max(expectedCell.links.length, actualCell.links.length);
      for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) {
        pushDifference(
          differences,
          "links",
          cellPath + ".links[" + linkIndex + "]",
          expectedCell.links[linkIndex] ?? null,
          actualCell.links[linkIndex] ?? null,
        );
      }
    }
  }
  return differences;
}

function compareMoreBlocks(expectedRaw: string, actualRaw: string): Difference[] {
  const expected = parseMoreBlock(expectedRaw);
  const actual = parseMoreBlock(actualRaw);
  const differences: Difference[] = [];
  pushDifference(differences, "text", "more.heading", expected.heading?.text ?? null, actual.heading?.text ?? null);

  const expectedNames = expected.items.map((item) => item.name);
  const actualNames = actual.items.map((item) => item.name);
  const expectedSorted = [...expectedNames].sort();
  const actualSorted = [...actualNames].sort();
  const sameMemberSet = sameValue(expectedSorted, actualSorted);
  const sameOrder = sameValue(expectedNames, actualNames);

  if (!sameOrder) {
    pushDifference(differences, "members", "more.items", expectedNames, actualNames);
    // Same members in a different order: report the order and stop here, the
    // per-index text/link comparison below would only repeat the mismatch.
    if (sameMemberSet) return differences;
  }

  const count = Math.max(expected.items.length, actual.items.length);
  for (let index = 0; index < count; index += 1) {
    const expectedItem = expected.items[index];
    const actualItem = actual.items[index];
    const path = "more.items[" + index + "]";
    if (expectedItem === undefined || actualItem === undefined) {
      pushDifference(differences, "members", path, expectedItem ?? null, actualItem ?? null);
      continue;
    }
    pushDifference(differences, "text", path + ".name", expectedItem.name, actualItem.name);
    pushDifference(differences, "links", path + ".url", expectedItem.url, actualItem.url);
    pushDifference(differences, "text", path + ".description", expectedItem.description, actualItem.description);
  }
  return differences;
}

function compareBlockContent(
  kind: ReadmeBlockKind,
  expectedRaw: string,
  actualRaw: string,
  options: CompareOptions,
): Difference[] {
  switch (kind) {
    case "contact":
      return compareContactBlocks(expectedRaw, actualRaw, options);
    case "star-history":
      return compareStarHistoryBlocks(expectedRaw, actualRaw, options);
    case "thanks":
      return compareThanksBlocks(expectedRaw, actualRaw);
    case "more":
      return compareMoreBlocks(expectedRaw, actualRaw);
  }
}

/** Compare one managed block; null means the block is absent. */
export function compareBlocks(
  kind: ReadmeBlockKind,
  expectedRaw: string | null,
  actualRaw: string | null,
  options: CompareOptions = {},
): BlockComparison {
  if (expectedRaw === null && actualRaw === null) {
    return { kind, identical: true, equivalent: true, contentDifferences: [], formatDifferences: [] };
  }
  if (expectedRaw === null || actualRaw === null) {
    return {
      kind,
      identical: false,
      equivalent: false,
      contentDifferences: [
        {
          dimension: "presence",
          path: kind,
          expected: expectedRaw === null ? null : "present",
          actual: actualRaw === null ? null : "present",
        },
      ],
      formatDifferences: [],
    };
  }

  const contentDifferences = compareBlockContent(kind, expectedRaw, actualRaw, options);
  const identical = expectedRaw === actualRaw;
  let formatDifferences: FormatDifference[] = [];
  if (!identical && contentDifferences.length === 0) {
    formatDifferences = detectFormatHints(expectedRaw, actualRaw);
    const expectedVariant = headingVariant(kind, expectedRaw);
    const actualVariant = headingVariant(kind, actualRaw);
    if (expectedVariant !== null && actualVariant !== null && expectedVariant !== actualVariant) {
      formatDifferences = [{ kind: "heading-variant" }, ...formatDifferences.filter((entry) => entry.kind !== "heading-variant")];
    }
  }
  return { kind, identical, equivalent: contentDifferences.length === 0, contentDifferences, formatDifferences };
}

const BLOCK_KINDS: readonly ReadmeBlockKind[] = ["contact", "star-history", "thanks", "more"];

/** Compare two READMEs (raw text or already-located blocks) block by block. */
export function compareReadmeBlocks(
  expected: string | LocatedBlocks,
  actual: string | LocatedBlocks,
  options: CompareOptions = {},
): ReadmeComparison {
  const expectedLocated = typeof expected === "string" ? locateReadmeBlocks(expected) : expected;
  const actualLocated = typeof actual === "string" ? locateReadmeBlocks(actual) : actual;

  const blocks = {} as Record<ReadmeBlockKind, BlockComparison>;
  const contentDifferences: Difference[] = [];
  const formatDifferences: FormatDifference[] = [];
  for (const kind of BLOCK_KINDS) {
    const comparison = compareBlocks(kind, expectedLocated.blocks[kind], actualLocated.blocks[kind], options);
    blocks[kind] = comparison;
    contentDifferences.push(...comparison.contentDifferences);
    for (const difference of comparison.formatDifferences) formatDifferences.push({ ...difference, block: kind });
  }

  return {
    equivalent: contentDifferences.length === 0,
    blocks,
    contentDifferences,
    formatDifferences,
    order: {
      expected: expectedLocated.order,
      actual: actualLocated.order,
      same: sameValue(expectedLocated.order, actualLocated.order),
    },
    suspicious: actualLocated.suspicious,
  };
}
