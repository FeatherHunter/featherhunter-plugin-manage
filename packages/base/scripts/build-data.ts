/**
 * Build the published data and the bundled offline baseline from the single
 * source of truth in `contact/`.
 *
 *   contact/groups.json   -> data/manifest.json groups + data/img/qr-*.png
 *   contact/src/card-*.   -> data/img/card-*.png (260px wide, palette PNG)
 *   contact/crops.json    -> QR crop boxes used to cut the crops out of cards
 *   contact/plugins.json  -> data/manifest.json plugins
 *   everything above      -> src/core/baseline.ts (every QR code inlined)
 *
 * Run with `npm run build:data`; pass `--check` to compare without writing.
 * The output is deterministic: the same input always produces the same bytes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BaselineContent, Group, I18nText, Manifest, PluginEntry } from "../src/core/types";
import { isRecord, parseDateOnly, parseManifest, sortByOrder } from "../src/core/index";
import { cropImage, extractQrCode, luminanceStdDev, quantizeToPng, resizeImage } from "./image";
import { decodeImage, isJpeg, isPng } from "./png";
import { findRepoRoot, readJsonFile, relativePosix } from "./io";

/** QR crop edge length in the published package. */
export const QR_SIZE = 320;
/** Palette size of the QR crops (4-bit palette PNG). */
export const QR_COLORS = 16;
/** Card width in the published package (README <img> width). */
export const CARD_WIDTH = 260;
/** Palette size of the card screenshots (8-bit palette PNG). */
export const CARD_COLORS = 256;
/**
 * Platforms whose QR code is inlined into the offline baseline. Every group is
 * bundled: the published manifest keeps all codes remote so a refresh can swap
 * in a newer code, and the bundled copy is the offline safety net behind it.
 */
export const BUNDLED_PLATFORMS: ReadonlySet<string> = new Set(["feishu", "qq", "wechat"]);
/** Baseline size budget for the QR crops (base64, three codes). */
export const QR_BASE64_BUDGET = 80 * 1024;

const GROUPS_FILE = "contact/groups.json";
const CROPS_FILE = "contact/crops.json";
const PLUGINS_FILE = "contact/plugins.json";

export interface GroupSourceEntry {
  id: string;
  platform: string;
  order: number;
  readmeTitle: I18nText;
  alt: I18nText;
  /** Whole-card screenshot file name under contact/src/. */
  card: string;
  /** Raw QR screenshot file name under contact/src/ (provenance). */
  qr: string;
  title: I18nText;
  subtitle?: I18nText;
  note?: I18nText;
  validUntil?: string;
}

export interface GroupsSource {
  schema: 1;
  revision: number;
  updatedAt: string;
  fallbackUrl: string;
  groups: GroupSourceEntry[];
}

export interface CropBoxSource {
  x: number;
  y: number;
  size: number;
}

export interface CropsSource {
  schema: 1;
  canvas: { width: number; height: number };
  crops: Record<string, CropBoxSource>;
}

export interface PluginsSource {
  schema: 1;
  updatedAt: string;
  plugins: PluginEntry[];
}

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  where: string,
  source: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(source, `${where}.${key} must be a non-empty string`);
  }
  return value;
}

function requireI18n(
  record: Record<string, unknown>,
  key: string,
  where: string,
  source: string,
): I18nText {
  const value = record[key];
  if (!isRecord(value)) fail(source, `${where}.${key} must be an object with zh and en`);
  const zh = value["zh"];
  const en = value["en"];
  if (typeof zh !== "string" || zh.length === 0) {
    fail(source, `${where}.${key}.zh must be a non-empty string`);
  }
  if (typeof en !== "string" || en.length === 0) {
    fail(source, `${where}.${key}.en must be a non-empty string`);
  }
  return { zh, en };
}

function requireOrder(record: Record<string, unknown>, where: string, source: string): number {
  const value = record["order"];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(source, `${where}.order must be a number`);
  }
  return value;
}

function requireNonNegativeInt(value: unknown, where: string, source: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(source, `${where} must be a non-negative integer`);
  }
  return value;
}

function requireDateOnly(
  record: Record<string, unknown>,
  key: string,
  where: string,
  source: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || parseDateOnly(value) === null) {
    fail(source, `${where}.${key} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function optionalI18n(
  record: Record<string, unknown>,
  key: string,
  where: string,
  source: string,
): I18nText | undefined {
  if (record[key] === undefined) return undefined;
  return requireI18n(record, key, where, source);
}

const IMAGE_NAME_RE = /\.(png|jpe?g)$/i;

function requireImageName(
  record: Record<string, unknown>,
  key: string,
  where: string,
  source: string,
): string {
  const value = requireString(record, key, where, source);
  if (!IMAGE_NAME_RE.test(value)) {
    fail(source, `${where}.${key} must be a .png/.jpg file name`);
  }
  return value;
}

/** Validate contact/groups.json and return the typed source. */
export function validateGroupsSource(raw: unknown): GroupsSource {
  const source = GROUPS_FILE;
  if (!isRecord(raw)) fail(source, "root must be an object");
  if (raw["schema"] !== 1) fail(source, "schema must be 1");
  const revision = raw["revision"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    fail(source, "revision must be a non-negative integer");
  }
  const updatedAt = requireDateOnly(raw, "updatedAt", "root", source);
  const fallbackUrl = requireString(raw, "fallbackUrl", "root", source);
  if (!/^https?:\/\//.test(fallbackUrl)) {
    fail(source, "fallbackUrl must be an absolute http(s) URL");
  }
  const groupsRaw = raw["groups"];
  if (!Array.isArray(groupsRaw)) fail(source, "groups must be an array");
  if (groupsRaw.length === 0) fail(source, "groups must not be empty");

  const groups: GroupSourceEntry[] = [];
  const ids = new Set<string>();
  groupsRaw.forEach((value, index) => {
    const where = `groups[${index}]`;
    if (!isRecord(value)) fail(source, `${where} must be an object`);
    const id = requireString(value, "id", where, source);
    if (ids.has(id)) fail(source, `duplicate group id "${id}"`);
    ids.add(id);
    const platform = requireString(value, "platform", where, source);
    const order = requireOrder(value, where, source);
    const readmeTitle = requireI18n(value, "readmeTitle", where, source);
    const alt = requireI18n(value, "alt", where, source);
    const card = requireImageName(value, "card", where, source);
    const qr = requireImageName(value, "qr", where, source);
    const title = requireI18n(value, "title", where, source);
    const entry: GroupSourceEntry = { id, platform, order, readmeTitle, alt, card, qr, title };
    const subtitle = optionalI18n(value, "subtitle", where, source);
    if (subtitle) entry.subtitle = subtitle;
    const note = optionalI18n(value, "note", where, source);
    if (note) entry.note = note;
    if (value["validUntil"] !== undefined) {
      entry.validUntil = requireDateOnly(value, "validUntil", where, source);
    }
    groups.push(entry);
  });
  return { schema: 1, revision, updatedAt, fallbackUrl, groups };
}

/** Validate contact/plugins.json and return the typed source. */
export function validatePluginsSource(raw: unknown): PluginsSource {
  const source = PLUGINS_FILE;
  if (!isRecord(raw)) fail(source, "root must be an object");
  if (raw["schema"] !== 1) fail(source, "schema must be 1");
  const updatedAt = requireDateOnly(raw, "updatedAt", "root", source);
  const pluginsRaw = raw["plugins"];
  if (!Array.isArray(pluginsRaw)) fail(source, "plugins must be an array");
  if (pluginsRaw.length === 0) fail(source, "plugins must not be empty");
  const plugins: PluginEntry[] = [];
  const ids = new Set<string>();
  pluginsRaw.forEach((value, index) => {
    const where = `plugins[${index}]`;
    if (!isRecord(value)) fail(source, `${where} must be an object`);
    const id = requireString(value, "id", where, source);
    if (ids.has(id)) fail(source, `duplicate plugin id "${id}"`);
    ids.add(id);
    const order = requireOrder(value, where, source);
    const verifiedAt = requireDateOnly(value, "verifiedAt", where, source);
    const name = requireString(value, "name", where, source);
    const repo = requireString(value, "repo", where, source);
    const desc = requireI18n(value, "desc", where, source);
    const entry: PluginEntry = { id, order, verifiedAt, name, repo, desc };
    if (value["url"] !== undefined) {
      const url = requireString(value, "url", where, source);
      if (!/^https?:\/\//.test(url)) fail(source, `${where}.url must be an absolute http(s) URL`);
      entry.url = url;
    }
    plugins.push(entry);
  });
  return { schema: 1, updatedAt, plugins };
}

/** Validate contact/crops.json (fixed 900x1600 template, one box per group). */
export function validateCropsSource(raw: unknown): CropsSource {
  const source = CROPS_FILE;
  if (!isRecord(raw)) fail(source, "root must be an object");
  if (raw["schema"] !== 1) fail(source, "schema must be 1");
  const canvasRaw = raw["canvas"];
  if (!isRecord(canvasRaw)) fail(source, "canvas must be an object");
  const width = canvasRaw["width"];
  const height = canvasRaw["height"];
  if (typeof width !== "number" || !Number.isInteger(width) || width <= 0) {
    fail(source, "canvas.width must be a positive integer");
  }
  if (typeof height !== "number" || !Number.isInteger(height) || height <= 0) {
    fail(source, "canvas.height must be a positive integer");
  }
  const cropsRaw = raw["crops"];
  if (!isRecord(cropsRaw)) fail(source, "crops must be an object");
  const crops: Record<string, CropBoxSource> = {};
  for (const [id, value] of Object.entries(cropsRaw)) {
    if (!isRecord(value)) fail(source, `crops.${id} must be an object`);
    const x = requireNonNegativeInt(value["x"], `crops.${id}.x`, source);
    const y = requireNonNegativeInt(value["y"], `crops.${id}.y`, source);
    const size = requireNonNegativeInt(value["size"], `crops.${id}.size`, source);
    if (size === 0) fail(source, `crops.${id}.size must be positive`);
    if (x + size > width || y + size > height) {
      fail(source, `crops.${id} leaves the ${width}x${height} canvas`);
    }
    crops[id] = { x, y, size };
  }
  if (Object.keys(crops).length === 0) fail(source, "crops must not be empty");
  return { schema: 1, canvas: { width, height }, crops };
}

/** Published file name: the QR crops and cards always ship as PNG. */
export function publishedName(fileName: string): string {
  return fileName.replace(IMAGE_NAME_RE, ".png");
}

export interface BuildManifestInput {
  version: string;
  source: GroupsSource;
  plugins: readonly PluginEntry[];
}

/** Assemble the published manifest (all QR codes remote: fetched from the CDN). */
export function buildManifest(input: BuildManifestInput): Manifest {
  const groups: Group[] = sortByOrder(input.source.groups).map((group) => {
    const manifestGroup: Group = {
      id: group.id,
      platform: group.platform,
      order: group.order,
      readmeTitle: group.readmeTitle,
      alt: group.alt,
      card: publishedName(group.card),
      qr: { kind: "remote", path: publishedName(group.qr) },
      title: group.title,
    };
    if (group.subtitle) manifestGroup.subtitle = group.subtitle;
    if (group.note) manifestGroup.note = group.note;
    if (group.validUntil) manifestGroup.validUntil = group.validUntil;
    return manifestGroup;
  });
  return parseManifest({
    schema: 1,
    version: input.version,
    revision: input.source.revision,
    updatedAt: `${input.source.updatedAt}T00:00:00+08:00`,
    fallbackUrl: input.source.fallbackUrl,
    groups,
    plugins: sortByOrder(input.plugins),
  });
}

/**
 * Turn the published manifest into the offline baseline: every group's code is
 * switched to `bundled` and its PNG inlined as a data URI, so a card still
 * shows a scannable code when the CDN is slow or unreachable.
 */
export function buildBaseline(manifest: Manifest, qrPng: ReadonlyMap<string, Buffer>): BaselineContent {
  const qr: Record<string, string> = {};
  const groups = manifest.groups.map((group) => {
    if (!BUNDLED_PLATFORMS.has(group.platform)) return { ...group };
    const key = `qr-${group.id}`;
    const bytes = qrPng.get(group.id);
    if (!bytes) throw new Error(`build-data: missing generated QR for group "${group.id}"`);
    qr[key] = `data:image/png;base64,${bytes.toString("base64")}`;
    return { ...group, qr: { kind: "bundled" as const, key } };
  });
  return { manifest: { ...manifest, groups }, qr };
}

/** Render src/core/baseline.ts (deterministic: JSON.stringify with 2 spaces). */
export function renderBaselineModule(baseline: BaselineContent): string {
  return [
    "// GENERATED FILE — do not edit by hand. Run `npm run build:data` instead.",
    'import type { BaselineContent } from "./types";',
    "",
    `export const BASELINE: BaselineContent = ${JSON.stringify(baseline, null, 2)};`,
    "",
  ].join("\n");
}

export interface GeneratedFile {
  path: string;
  contents: Buffer;
}

export interface GenerateDataOptions {
  rootDir: string;
  /** Defaults to <rootDir>/contact. */
  contactDir?: string;
  /** Defaults to <rootDir>/packages/base/data. */
  dataDir?: string;
  /** Defaults to <rootDir>/packages/base/src/core/baseline.ts. */
  baselineFile?: string;
  /** Defaults to <rootDir>/packages/base/package.json. */
  packageJsonPath?: string;
  /** Compare with disk instead of writing. */
  check?: boolean;
  qrSize?: number;
  cardWidth?: number;
  qrColors?: number;
  cardColors?: number;
}

export interface GenerateDataResult {
  manifest: Manifest;
  baseline: BaselineContent;
  files: GeneratedFile[];
  /** Base64 length of all generated QR crops (the baseline size budget). */
  qrBase64Bytes: number;
  /** In check mode: files whose bytes differ from disk (relative paths). */
  drift: string[];
}

function readCardImage(path: string, label: string): { width: number; height: number; data: Uint8Array } {
  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    throw new Error(`${label}: cannot read image`);
  }
  if (!isPng(buffer) && !isJpeg(buffer)) {
    throw new Error(`${label}: unsupported image format (expected PNG or JPEG)`);
  }
  try {
    return decodeImage(buffer);
  } catch (error) {
    throw new Error(`${label}: ${(error as Error).message}`);
  }
}

/**
 * Generate every published file plus the bundled baseline. Writes by default;
 * `check: true` only compares and reports drift.
 */
export function generateData(options: GenerateDataOptions): GenerateDataResult {
  const rootDir = resolve(options.rootDir);
  const contactDir = options.contactDir ? resolve(options.contactDir) : join(rootDir, "contact");
  const dataDir = options.dataDir ? resolve(options.dataDir) : join(rootDir, "packages", "base", "data");
  const baselineFile = options.baselineFile
    ? resolve(options.baselineFile)
    : join(rootDir, "packages", "base", "src", "core", "baseline.ts");
  const packageJsonPath = options.packageJsonPath
    ? resolve(options.packageJsonPath)
    : join(rootDir, "packages", "base", "package.json");
  const qrSize = options.qrSize ?? QR_SIZE;
  const cardWidth = options.cardWidth ?? CARD_WIDTH;
  const qrColors = options.qrColors ?? QR_COLORS;
  const cardColors = options.cardColors ?? CARD_COLORS;

  const groupsSource = validateGroupsSource(readJsonFile(join(contactDir, "groups.json")));
  const crops = validateCropsSource(readJsonFile(join(contactDir, "crops.json")));
  const pluginsSource = validatePluginsSource(readJsonFile(join(contactDir, "plugins.json")));
  const packageJson = readJsonFile(packageJsonPath);
  if (!isRecord(packageJson) || typeof packageJson["version"] !== "string" || packageJson["version"].length === 0) {
    fail(packageJsonPath, "has no version string");
  }
  const version = packageJson["version"] as string;

  const files: GeneratedFile[] = [];
  const qrPng = new Map<string, Buffer>();
  const qrBase64: string[] = [];
  const cardHeight = Math.max(1, Math.round((crops.canvas.height * cardWidth) / crops.canvas.width));

  for (const group of groupsSource.groups) {
    const crop = crops.crops[group.id];
    if (!crop) fail(CROPS_FILE, `missing crop box for group "${group.id}"`);
    const cardLabel = `contact/src/${group.card}`;
    const cardImage = readCardImage(join(contactDir, "src", group.card), cardLabel);
    if (cardImage.width !== crops.canvas.width || cardImage.height !== crops.canvas.height) {
      fail(cardLabel, `must be ${crops.canvas.width}x${crops.canvas.height} (got ${cardImage.width}x${cardImage.height})`);
    }
    const cropPixels = cropImage(cardImage, crop);
    if (luminanceStdDev(cropPixels) < 6) {
      fail(CROPS_FILE, `crop box for "${group.id}" looks blank (no contrast)`);
    }
    let qrPixels;
    try {
      qrPixels = extractQrCode(cardImage, crop, { outputSize: qrSize });
    } catch (error) {
      fail(CROPS_FILE, `crop box for "${group.id}": ${(error as Error).message}`);
    }
    const qr = quantizeToPng(qrPixels, qrColors);
    qrPng.set(group.id, qr);
    qrBase64.push(qr.toString("base64"));
    files.push({ path: join(dataDir, "img", publishedName(group.qr)), contents: qr });

    const card = quantizeToPng(resizeImage(cardImage, cardWidth, cardHeight), cardColors);
    files.push({ path: join(dataDir, "img", publishedName(group.card)), contents: card });
  }

  const manifest = buildManifest({ version, source: groupsSource, plugins: pluginsSource.plugins });
  const baseline = buildBaseline(manifest, qrPng);
  files.unshift({
    path: join(dataDir, "manifest.json"),
    contents: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  });
  files.push({
    path: baselineFile,
    contents: Buffer.from(renderBaselineModule(baseline), "utf8"),
  });

  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) fail("build-data", `two outputs map to the same file ${file.path}`);
    seen.add(file.path);
  }

  const drift: string[] = [];
  for (const file of files) {
    if (!existsSync(file.path) || !readFileSync(file.path).equals(file.contents)) {
      drift.push(relativePosix(rootDir, file.path));
    }
  }
  if (!options.check) {
    for (const file of files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.contents);
    }
  }
  return {
    manifest,
    baseline,
    files,
    qrBase64Bytes: qrBase64.reduce((sum, item) => sum + item.length, 0),
    drift,
  };
}

const USAGE = `build:data — regenerate data/manifest.json, data/img/ and the bundled baseline

Usage:
  npm run build:data              Write the generated files
  npm run build:data -- --check   Report stale generated files (exit 1 when stale)
  npm run build:data -- --help    Print this help

The single source of truth is contact/groups.json, contact/plugins.json,
contact/crops.json and contact/src/*.
`;

/** CLI entry used by scripts/run-ts.mjs. */
export async function runCli(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const unknown = argv.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    process.stderr.write(`build:data: unknown option "${unknown[0]}"\n\n${USAGE}`);
    return 2;
  }
  const check = argv.includes("--check");
  let rootDir: string;
  try {
    rootDir = findRepoRoot();
  } catch (error) {
    process.stderr.write(`build:data: ${(error as Error).message}\n`);
    return 1;
  }
  try {
    const result = generateData({ rootDir, check });
    if (check) {
      if (result.drift.length === 0) {
        process.stdout.write("build:data — generated data is up to date\n");
        return 0;
      }
      process.stderr.write(`build:data — generated data is stale (${result.drift.length} file(s)):\n`);
      for (const file of result.drift) process.stderr.write(`  ${file}\n`);
      process.stderr.write("Run `npm run build:data` to regenerate.\n");
      return 1;
    }
    process.stdout.write(
      `build:data — ${result.manifest.groups.length} groups, ${result.manifest.plugins.length} plugins, version ${result.manifest.version}, revision ${result.manifest.revision}\n`,
    );
    for (const file of result.files) {
      process.stdout.write(`  wrote ${relativePosix(rootDir, file.path)} (${file.contents.length} bytes)\n`);
    }
    process.stdout.write(
      `build:data — QR base64 total ${(result.qrBase64Bytes / 1024).toFixed(1)} KB (budget ${QR_BASE64_BUDGET / 1024} KB)\n`,
    );
    if (result.qrBase64Bytes > QR_BASE64_BUDGET) {
      process.stderr.write("build:data — WARNING: QR base64 exceeds the 80 KB budget\n");
    }
    return 0;
  } catch (error) {
    process.stderr.write(`build:data: ${(error as Error).message}\n`);
    return 1;
  }
}
