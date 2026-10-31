/**
 * README block renderers (tickets 08-10).
 *
 * Every renderer is a pure string function: data (manifest / plugin list) +
 * language + image base in, Markdown/HTML out. No filesystem access and no
 * marker handling — the marker registry and the sync engine own that
 * (see ./readme-sync.ts). The returned string is the block *content*.
 */
import { BASELINE, pickText, pluginHref, sortByOrder } from "../core/index";
import type { Group, Lang, Manifest, PluginEntry } from "../core/types";
import { STAR_CHART_DEFAULT_DARK, STAR_CHART_DEFAULT_LIGHT } from "./star-assets";
import type {
  BlockRenderOptions,
  StarHistoryData,
  ThanksAuthor,
  ThanksData,
} from "./types";

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
 * Link target of one plugin row (kept for the node entry API; the shared
 * implementation lives in ./core so the client rows resolve links identically).
 */
export const pluginLink = pluginHref;

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

/** Default alt text of the star-history chart image. */
export const STAR_HISTORY_DEFAULT_ALT = "Star History Chart";

/** Minute-level version query string shape (YYYYMMDDHHmm). */
const STAR_HISTORY_VERSION = /^\d{12}$/;

/** Branch / repository shapes accepted in a raw GitHub image URL. */
const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Fixed parts of the thanks table. */
export const THANKS_TEXT = {
  header: {
    zh: "| 贡献者 | 致敬 | 贡献 |",
    en: "| Contributor | Tribute | Contributions |",
  },
  separator: "| --- | --- | --- |",
} as const;

/** Roses/medals of the thanks table, highest tier first. */
const THANKS_TIERS: ReadonlyArray<readonly [number, string]> = [
  [10000, "💎"],
  [1000, "👑"],
  [100, "🏆"],
  [10, "💐"],
  [1, "🌹"],
];

function requireRepo(repo: string, block: string): string {
  if (!GITHUB_REPO.test(repo)) {
    throw new Error(block + ' data needs an "owner/repo" repository (got "' + repo + '")');
  }
  return repo;
}

function rawImageUrl(repo: string, branch: string, path: string, version: string): string {
  const cleanPath = path.replace(/^\/+/, "");
  if (cleanPath === "" || /\s/.test(branch) || /\s/.test(cleanPath)) {
    throw new Error('invalid star-history chart path or branch ("' + branch + '", "' + path + '")');
  }
  return "https://raw.githubusercontent.com/" + repo + "/" + branch + "/" + cleanPath + "?v=" + version;
}

/**
 * Render the star-history block content (no markers).
 *
 * The chart is a light/dark picture pair of the repository SVG assets, each
 * cache-busted with a minute-level ?v=YYYYMMDDHHmm query string. The optional
 * data fields keep the per-repository functional elements found before the
 * migration: deck links the pair to a standalone chart page, im renders it at
 * a fixed width with a caption note.
 */
export function renderStarHistoryBlock(options: BlockRenderOptions = {}): string {
  const data: StarHistoryData | undefined = options.starHistory;
  if (data === undefined) {
    throw new Error("star-history block needs starHistory data (repo and minute-level version)");
  }
  const repo = requireRepo(data.repo, "star-history");
  if (!STAR_HISTORY_VERSION.test(data.version)) {
    throw new Error(
      'star-history version must be a minute-level YYYYMMDDHHmm query string (got "' + data.version + '")',
    );
  }
  if (data.width !== undefined && (!Number.isInteger(data.width) || data.width <= 0)) {
    throw new Error('star-history width must be a positive integer (got "' + String(data.width) + '")');
  }
  const branch = data.branch ?? "main";
  const dark = rawImageUrl(repo, branch, data.darkPath ?? STAR_CHART_DEFAULT_DARK, data.version);
  const light = rawImageUrl(repo, branch, data.lightPath ?? STAR_CHART_DEFAULT_LIGHT, data.version);
  const alt = escapeAttribute(data.alt ?? STAR_HISTORY_DEFAULT_ALT);
  const img = "  <img alt=\"" + alt + "\"" + (data.width === undefined ? "" : ' width="' + data.width + '"') + ' src="' + light + '" />';
  const lines: string[] = ['<div align="center">', ""];
  if (data.pageUrl !== undefined) lines.push('<a href="' + escapeAttribute(data.pageUrl) + '">');
  if (dark === light) {
    // The repository publishes one theme-neutral chart (palette / prompt): a
    // picture pair would point both sources at the same file, so emit the
    // plain image the repository already used.
    lines.push(img);
  } else {
    lines.push(
      "  <picture>",
      '    <source media="(prefers-color-scheme: dark)" srcset="' + dark + '" />',
      '    <source media="(prefers-color-scheme: light)" srcset="' + light + '" />',
      img,
      "  </picture>",
    );
  }
  if (data.pageUrl !== undefined) lines.push("</a>");
  if (data.note !== undefined && data.note.trim() !== "") {
    lines.push("", "<sub>" + escapeAttribute(data.note) + "</sub>");
  }
  lines.push("", "</div>");
  return lines.join("\n");
}

/**
 * Contribution total of one author: every issue, pull request, discussion and
 * counted comment adds one flower.
 */
export function thanksTotal(author: ThanksAuthor): number {
  return (
    (author.issues?.length ?? 0) +
    (author.prs?.length ?? 0) +
    (author.discussions?.length ?? 0) +
    (author.comments?.length ?? 0)
  );
}

/** Roses of one author, one symbol per tier (greedy, high to low). */
export function rosesFor(total: number): string {
  let rest = Math.max(0, Math.floor(total));
  let out = "";
  for (const [worth, mark] of THANKS_TIERS) {
    while (rest >= worth) {
      out += mark;
      rest -= worth;
    }
  }
  return out;
}

/** Maintainer / bot / deleted accounts never enter the thanks table. */
export function isSkippedThanksLogin(login: string, owner: string): boolean {
  if (login === "" || login === owner || login === "ghost") return true;
  return login === "dependabot" || login.endsWith("[bot]");
}

/**
 * Contribution links of one author, grouped by URL segment (issue thread,
 * pull-request thread, discussions) and ascending inside a segment. Comments
 * inherit their thread segment so a comment and its issue stay adjacent.
 */
export function thanksLinks(author: ThanksAuthor, repo: string): string[] {
  interface LinkEntry {
    segment: number;
    n: number;
    path: string;
  }
  const entries: LinkEntry[] = [];
  for (const entry of author.issues ?? []) entries.push({ segment: 0, n: entry.n, path: "issues" });
  for (const entry of author.prs ?? []) entries.push({ segment: 1, n: entry.n, path: "pull" });
  for (const entry of author.discussions ?? []) entries.push({ segment: 2, n: entry.n, path: "discussions" });
  for (const entry of author.comments ?? []) {
    const pull = entry.thread === "pr";
    entries.push({ segment: pull ? 1 : 0, n: entry.n, path: pull ? "pull" : "issues" });
  }
  entries.sort((a, b) => (a.segment !== b.segment ? a.segment - b.segment : a.n - b.n));
  return entries.map((entry) => "[#" + entry.n + "](https://github.com/" + repo + "/" + entry.path + "/" + entry.n + ")");
}

/** Row order: contribution total desc, last activity desc, login asc. */
function orderedThanksLogins(authors: Record<string, ThanksAuthor>, owner: string): string[] {
  return Object.keys(authors)
    .filter((login) => !isSkippedThanksLogin(login, owner))
    .sort((left, right) => {
      const totalDelta = thanksTotal(authors[right]!) - thanksTotal(authors[left]!);
      if (totalDelta !== 0) return totalDelta;
      const lastLeft = authors[left]!.lastActive ?? "";
      const lastRight = authors[right]!.lastActive ?? "";
      if (lastLeft !== lastRight) return lastLeft < lastRight ? 1 : -1;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

/** One table row of the thanks block. */
export function thanksRow(login: string, author: ThanksAuthor, repo: string): string {
  const links = thanksLinks(author, repo).join(" ");
  return "| [@" + login + "](https://github.com/" + login + ") | " + rosesFor(thanksTotal(author)) + " | " + links + " |";
}

/**
 * Render the thanks block content (no markers, no heading / prose).
 *
 * The three-column table is the only managed part: its surrounding heading,
 * intro and footer stay byte-identical outside the marker pair. The row rules
 * are the ones the five repositories already use - maintainer / bot accounts
 * filtered out, one symbol per tier, and the segment-merged link order.
 */
export function renderThanksBlock(options: BlockRenderOptions = {}): string {
  const data: ThanksData | undefined = options.thanks;
  if (data === undefined) throw new Error("thanks block needs thanks data (repo and author records)");
  const repo = requireRepo(data.repo, "thanks");
  const owner = repo.split("/")[0]!;
  const lang = resolveLang(options);
  const lines: string[] = [THANKS_TEXT.header[lang], THANKS_TEXT.separator];
  for (const login of orderedThanksLogins(data.authors, owner)) {
    lines.push(thanksRow(login, data.authors[login]!, repo));
  }
  return lines.join("\n");
}
