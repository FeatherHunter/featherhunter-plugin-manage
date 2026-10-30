import type { I18nText, Lang, Manifest, Group, PluginEntry } from "./types";

export * from "./types";
export { BASELINE } from "./baseline";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Pick the localized variant, falling back to the other language. */
export function pickText(text: I18nText | undefined, lang: Lang): string {
  if (!text) return "";
  return text[lang] ?? text.zh ?? text.en ?? "";
}

/** Normalize one BCP-47-ish tag to a supported language, or null. */
function normalizeLang(value: string | null | undefined): Lang | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("en")) return "en";
  return null;
}

export interface LangHints {
  /** Explicit user setting. */
  explicit?: string | null;
  /** `<html lang>` of the host page. */
  htmlLang?: string | null;
  /** `navigator.languages` of the host page. */
  navigatorLanguages?: readonly string[] | null;
}

/**
 * Language fallback chain: explicit setting -> page `<html lang>` ->
 * `navigator.languages` -> `zh`.
 */
export function resolveLang(hints: LangHints = {}): Lang {
  const explicit = normalizeLang(hints.explicit);
  if (explicit) return explicit;
  const html = normalizeLang(hints.htmlLang);
  if (html) return html;
  for (const candidate of hints.navigatorLanguages ?? []) {
    const normalized = normalizeLang(candidate);
    if (normalized) return normalized;
  }
  return "zh";
}

/** Copy sorted by display order (stable, input untouched). */
export function sortByOrder<T extends { order: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** Strict `YYYY-MM-DD` parser (UTC midnight). Invalid dates return null. */
export function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function todayUtc(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** `validUntil` is inclusive; a group without `validUntil` never expires. */
export function isExpired(validUntil: string | undefined, now: Date = new Date()): boolean {
  if (!validUntil) return false;
  const until = parseDateOnly(validUntil);
  if (!until) return false;
  return until.getTime() < todayUtc(now);
}

export interface ValidityOptions {
  lang: Lang;
  now?: Date;
}

/**
 * Human validity line for the modal footnote. Returns null for permanent codes
 * and for expired ones (the caller falls back to the link).
 */
export function formatValidity(
  validUntil: string | undefined,
  options: ValidityOptions,
): string | null {
  if (!validUntil) return null;
  const until = parseDateOnly(validUntil);
  if (!until) return null;
  const now = options.now ?? new Date();
  if (isExpired(validUntil, now)) return null;
  const days = Math.round((until.getTime() - todayUtc(now)) / DAY_MS);
  const month = until.getUTCMonth() + 1;
  const day = until.getUTCDate();
  if (options.lang === "en") {
    return `Valid for ${days} day${days === 1 ? "" : "s"} (until ${month}/${day}), refreshed on re-entry`;
  }
  return `该二维码 ${days} 天内（${month} 月 ${day} 日前）有效，重新进入将更新`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`manifest: ${where}.${key} must be a non-empty string`);
  }
  return value;
}

function requireI18n(record: Record<string, unknown>, key: string, where: string): I18nText {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`manifest: ${where}.${key} must be an object`);
  const zh = value.zh;
  const en = value.en;
  if (typeof zh !== "string" || zh.length === 0) {
    throw new Error(`manifest: ${where}.${key}.zh must be a non-empty string`);
  }
  if (typeof en !== "string" || en.length === 0) {
    throw new Error(`manifest: ${where}.${key}.en must be a non-empty string`);
  }
  return { zh, en };
}

function requireOrder(record: Record<string, unknown>, where: string): number {
  const value = record["order"];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`manifest: ${where}.order must be a number`);
  }
  return value;
}

function validateGroup(value: unknown, index: number): Group {
  const where = `groups[${index}]`;
  if (!isRecord(value)) throw new Error(`manifest: ${where} must be an object`);
  const id = requireString(value, "id", where);
  const platform = requireString(value, "platform", where);
  const order = requireOrder(value, where);
  const readmeTitle = requireI18n(value, "readmeTitle", where);
  const alt = requireI18n(value, "alt", where);
  const card = requireString(value, "card", where);
  const title = requireI18n(value, "title", where);
  const qrRaw = value["qr"];
  if (!isRecord(qrRaw)) throw new Error(`manifest: ${where}.qr must be an object`);
  const kind = qrRaw["kind"];
  let qr: Group["qr"];
  if (kind === "bundled") {
    qr = { kind: "bundled", key: requireString(qrRaw, "key", `${where}.qr`) };
  } else if (kind === "remote") {
    qr = { kind: "remote", path: requireString(qrRaw, "path", `${where}.qr`) };
  } else {
    throw new Error(`manifest: ${where}.qr.kind must be "bundled" or "remote"`);
  }
  const group: Group = { id, platform, order, readmeTitle, alt, card, qr, title };
  const subtitle = value["subtitle"];
  if (subtitle !== undefined) {
    if (!isRecord(subtitle)) throw new Error(`manifest: ${where}.subtitle must be an object`);
    group.subtitle = requireI18n(value, "subtitle", where);
  }
  const note = value["note"];
  if (note !== undefined) {
    if (!isRecord(note)) throw new Error(`manifest: ${where}.note must be an object`);
    group.note = requireI18n(value, "note", where);
  }
  const validUntil = value["validUntil"];
  if (validUntil !== undefined) {
    if (typeof validUntil !== "string" || parseDateOnly(validUntil) === null) {
      throw new Error(`manifest: ${where}.validUntil must be a valid YYYY-MM-DD date`);
    }
    group.validUntil = validUntil;
  }
  return group;
}

function validatePlugin(value: unknown, index: number): PluginEntry {
  const where = `plugins[${index}]`;
  if (!isRecord(value)) throw new Error(`manifest: ${where} must be an object`);
  const id = requireString(value, "id", where);
  const order = requireOrder(value, where);
  const verifiedAt = requireString(value, "verifiedAt", where);
  if (parseDateOnly(verifiedAt) === null) {
    throw new Error(`manifest: ${where}.verifiedAt must be a valid YYYY-MM-DD date`);
  }
  const name = requireString(value, "name", where);
  const repo = requireString(value, "repo", where);
  const desc = requireI18n(value, "desc", where);
  const entry: PluginEntry = { id, order, verifiedAt, name, repo, desc };
  const url = value["url"];
  if (url !== undefined) entry.url = requireString(value, "url", where);
  return entry;
}

/**
 * Validate a published `data/manifest.json` payload. Throws on the first
 * structural problem so a bad deploy fails loudly instead of rendering blanks.
 */
export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) throw new Error("manifest: root must be an object");
  if (raw["schema"] !== 1) throw new Error("manifest: schema must be 1");
  const version = requireString(raw, "version", "manifest");
  const revision = raw["revision"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    throw new Error("manifest: revision must be a non-negative integer");
  }
  const updatedAt = requireString(raw, "updatedAt", "manifest");
  if (Number.isNaN(Date.parse(updatedAt))) {
    throw new Error("manifest: updatedAt must be a parseable timestamp");
  }
  const fallbackUrl = requireString(raw, "fallbackUrl", "manifest");
  if (!/^https?:\/\//.test(fallbackUrl)) {
    throw new Error("manifest: fallbackUrl must be an absolute http(s) URL");
  }
  const groupsRaw = raw["groups"];
  if (!Array.isArray(groupsRaw)) throw new Error("manifest: groups must be an array");
  if (groupsRaw.length === 0) throw new Error("manifest: groups must not be empty");
  const pluginsRaw = raw["plugins"];
  if (!Array.isArray(pluginsRaw)) throw new Error("manifest: plugins must be an array");
  if (pluginsRaw.length === 0) throw new Error("manifest: plugins must not be empty");
  const groups = groupsRaw.map(validateGroup);
  const plugins = pluginsRaw.map(validatePlugin);
  const ids = new Set<string>();
  for (const group of groups) {
    if (ids.has(group.id)) throw new Error(`manifest: duplicate group id "${group.id}"`);
    ids.add(group.id);
  }
  return { schema: 1, version, revision, updatedAt, fallbackUrl, groups, plugins };
}
