/**
 * README block renderers (tickets 08-10).
 *
 * Every renderer is a pure string function: data (manifest / plugin list) +
 * language + image base in, Markdown/HTML out. No filesystem access and no
 * marker handling — the marker registry and the sync engine own that
 * (see ./readme-sync.ts). The returned string is the block *content*.
 */
import { BASELINE, pickText, sortByOrder } from "../core/index";
import type { Group, Lang, Manifest, PluginEntry } from "../core/types";
import type { BlockRenderOptions } from "./types";

/** jsDelivr base of the published data package (exact-version images). */
export const DEFAULT_CDN_BASE = "https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base";

/** Whole-card image width used by the README contact table (spec rule 9). */
export const CONTACT_CARD_WIDTH = 260;

/** Fixed wording of the contact block, independent of the group data. */
export const CONTACT_TEXT = {
  sub: "CONNECT",
  heading: {
    zh: "反馈与联系",
    en: "Feedback and Contact",
  },
  welcome: {
    zh: "👏欢迎提交PR、ISSUE。星星之火可以燎原🔥有任何建议、意见、想法、吐槽、idea都可以进群交流。",
    en: "👏Welcome PRs and issues. A single spark can start a prairie fire 🔥. Any suggestion, opinion, idea or rant — come join the group and talk.",
  },
} as const;

/** Fixed wording of the author-plugins (MORE) block. */
export const MORE_TEXT = {
  sub: "MORE",
  heading: {
    zh: "作者的其他作品",
    en: "More from the author",
  },
  leadIn: {
    zh: "喜欢这个插件的话，这些可能你也用得上：",
    en: "If you like this plugin, these might help too:",
  },
  separator: {
    zh: "——",
    en: "—",
  },
} as const;

const DATE_IN_FILENAME = /(\d{4})-(\d{2})-(\d{2})/;
const DATE_IN_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})/;

function resolveManifest(options: BlockRenderOptions): Manifest {
  return options.manifest ?? BASELINE.manifest;
}

function resolveLang(options: BlockRenderOptions): Lang {
  return options.lang ?? "zh";
}

/** Escape a value for use inside a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Cache-busting date for a limited-time card (`YYYYMMDD`), or null for a
 * permanent card.
 *
 * A card counts as limited-time when the manifest marks it with `validUntil`
 * or the published file name carries a `YYYY-MM-DD` date. The date in the
 * file name wins; otherwise the manifest `updatedAt` date is used, because
 * GitHub's camo proxy caches images by URL and a new QR code must get a new
 * URL.
 */
export function contactCardCacheDate(group: Group, manifest: Manifest): string | null {
  const fromCard = DATE_IN_FILENAME.exec(group.card);
  if (fromCard !== null) return fromCard[1]! + fromCard[2]! + fromCard[3]!;
  if (group.validUntil === undefined) return null;
  const fromManifest = DATE_IN_TIMESTAMP.exec(manifest.updatedAt);
  if (fromManifest === null) {
    throw new Error(
      "manifest.updatedAt must start with YYYY-MM-DD when a group has validUntil (group: " + group.id + ")",
    );
  }
  return fromManifest[1]! + fromManifest[2]! + fromManifest[3]!;
}

/**
 * Absolute pristine CDN URL of one published card image.
 *
 * Shape: `<cdnBase>@<manifest.version>/data/img/<card>[?v=YYYYMMDD]`. The
 * base must be an absolute https URL — README images are never relative or
 * copied into the plugin repositories.
 */
export function contactCardUrl(
  group: Group,
  manifest: Manifest,
  options: BlockRenderOptions = {},
): string {
  const base = (options.cdnBase ?? DEFAULT_CDN_BASE).replace(/\/+$/, "");
  if (!/^https:\/\/[^\s"'<>]+$/i.test(base)) {
    throw new Error("contact CDN base must be an absolute https URL (got \"" + base + "\")");
  }
  const card = group.card.trim();
  if (card === "") throw new Error("contact group \"" + group.id + "\" has an empty card file name");
  if (card.includes("/") || card.includes("\\") || /^[a-z]+:/i.test(card)) {
    throw new Error("contact card must be a bare file name under data/img/ (got \"" + card + "\")");
  }
  const version = options.version ?? manifest.version;
  if (version === "") throw new Error("contact CDN URL needs a manifest version");
  let url = base + "@" + version + "/data/img/" + card;
  const cacheDate = contactCardCacheDate(group, manifest);
  if (cacheDate !== null) url += "?v=" + cacheDate;
  return url;
}

function contactHeading(lang: Lang, options: BlockRenderOptions): string {
  const text = CONTACT_TEXT.heading[lang];
  if (options.variant === "markdown-heading") return "## " + text;
  return '<h2 align="center"><sub>' + CONTACT_TEXT.sub + "</sub><br>" + text + "</h2>";
}

/**
 * Render the README contact block content (no markers).
 *
 * Keeps the pre-migration structure: heading, centered wrapper, welcome line,
 * one header row and one row of {@link CONTACT_CARD_WIDTH}-wide whole cards.
 * Modal-only fields (`title`, `subtitle`, `note`, `qr`) never appear here.
 *
 * @param options data + language + image base; `variant` selects the standard
 *   CONNECT h2 (default) or ilife's Markdown `##` heading.
 */
export function renderContactBlock(options: BlockRenderOptions = {}): string {
  const manifest = resolveManifest(options);
  const lang = resolveLang(options);
  const groups = sortByOrder(manifest.groups);
  if (groups.length === 0) throw new Error("contact block needs at least one group in the manifest");
  const headerCells = groups
    .map((group) => '<td align="center"><b>' + escapeAttribute(pickText(group.readmeTitle, lang)) + "</b></td>")
    .join("");
  const cardCells = groups
    .map((group) => {
      const src = contactCardUrl(group, manifest, options);
      const alt = escapeAttribute(pickText(group.alt, lang));
      return '<td><img src="' + src + '" width="' + CONTACT_CARD_WIDTH + '" alt="' + alt + '" /></td>';
    })
    .join("");
  return [
    contactHeading(lang, options),
    "",
    '<div align="center">',
    "",
    CONTACT_TEXT.welcome[lang],
    "",
    '<table align="center"><tr>' + headerCells + "</tr><tr>" + cardCells + "</tr></table>",
    "",
    "</div>",
  ].join("\n");
}

/**
 * Link target of one plugin row.
 *
 * The manifest URL wins; the GitHub repository is the fallback so a row never
 * renders as a linkless plugin name.
 */
export function pluginLink(plugin: PluginEntry): string {
  return plugin.url ?? "https://github.com/" + plugin.repo;
}

/**
 * Render the author-plugins (MORE) block content (no markers).
 *
 * Structure: heading, left-aligned wrapper, one lead-in sentence and four
 * `**[name](url)** —— description` rows, one per plugin other than the
 * repository being rendered. The standard heading is the HTML `<h2>` with the
 * MORE sub-label; the prompt repositories keep their Markdown `##` variant and
 * the en headings may keep a historical wording through `headingText`.
 *
 * @param options data + language; `selfId` excludes the current repository and
 *   `variant` / `headingText` preserve the repository heading conventions.
 */
export function renderMoreBlock(options: BlockRenderOptions = {}): string {
  const manifest = resolveManifest(options);
  const lang = resolveLang(options);
  if (manifest.plugins.length === 0) {
    throw new Error("more block needs at least one plugin in the manifest");
  }
  const plugins = sortByOrder(manifest.plugins).filter((plugin) => plugin.id !== options.selfId);
  if (plugins.length === 0) {
    throw new Error('more block needs at least one plugin besides "' + String(options.selfId) + '"');
  }
  const headingText = options.headingText ?? MORE_TEXT.heading[lang];
  const heading =
    options.variant === "markdown-heading"
      ? "## " + headingText + " <sub>" + MORE_TEXT.sub + "</sub>"
      : '<h2 align="center"><sub>' + MORE_TEXT.sub + "</sub><br>" + headingText + "</h2>";
  const rows = plugins.map(
    (plugin) =>
      "**[" +
      plugin.name +
      "](" +
      pluginLink(plugin) +
      ")** " +
      MORE_TEXT.separator[lang] +
      " " +
      pickText(plugin.desc, lang),
  );
  return [
    heading,
    "",
    '<div align="left">',
    "",
    MORE_TEXT.leadIn[lang],
    "",
    rows.join("\n\n"),
    "",
    "</div>",
  ].join("\n");
}
