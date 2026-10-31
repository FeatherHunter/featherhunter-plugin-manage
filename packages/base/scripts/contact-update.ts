/**
 * contact:update — refresh one contact group from a new QR screenshot.
 *
 * Weekly WeChat flow: screenshot the new group QR, then
 *
 *   npm run contact:update -- <image> [--group wechat] [--date YYYY-MM-DD]
 *
 * The command normalises the screenshot onto the fixed 900x1600 card template,
 * writes contact/src/card-<group>-<date>.png + contact/src/qr-<group>-<date>.<ext>,
 * bumps contact/groups.json (card, qr, validUntil = date + 7 days), deletes the
 * group's dated images older than 8 weeks, prints a diff and regenerates the
 * published data. Exit code 3 means "written but waiting for a human to scan
 * the new code"; re-run with --confirmed once that check passed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isRecord, parseDateOnly } from "../src/core/index";
import {
  generateData,
  validateCropsSource,
  validateGroupsSource,
} from "./build-data";
import { cropImage, extractQrCode, luminanceStdDev, normalizeCard } from "./image";
import { findRepoRoot, readJsonFile, relativePosix } from "./io";
import { decodeImage, encodeTruecolorPng, isJpeg, isPng } from "./png";

/** Days a limited-time QR code stays valid (weekly refresh). */
export const VALID_DAYS = 7;
/** Dated source images older than this are removed on update. */
export const STALE_DAYS = 56;
/** Minimum decoded screenshot edge length (the published code must be >= 320px). */
export const MIN_IMAGE_SIZE = 320;
/** Below this luminance standard deviation the crop box is probably blank. */
export const MIN_CROP_CONTRAST = 6;

const GROUPS_FILE = "contact/groups.json";

export interface ContactUpdateOptions {
  rootDir: string;
  imagePath: string;
  /** Group id to refresh; defaults to "wechat". */
  group?: string;
  /** Date stamp (YYYY-MM-DD); defaults to today. */
  date?: string;
  /** Skip the human scan gate (exit 0 instead of 3). */
  confirmed?: boolean;
  /** Do not regenerate data/manifest.json + baseline. */
  noBuild?: boolean;
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
  dataDir?: string;
  baselineFile?: string;
  packageJsonPath?: string;
  now?: Date;
  stdout?: (line: string) => void;
}

export interface ContactUpdateResult {
  status: "updated" | "needs-confirmation" | "dry-run";
  exitCode: number;
  group: string;
  date: string;
  validUntil: string;
  filesWritten: string[];
  filesRemoved: string[];
  diff: string;
  generated: string[];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Format an instant as a UTC date (used for date-only arithmetic). */
function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Format an instant as the maintainer's local date (the default date stamp). */
function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(dateOnly: string, days: number): string {
  const parsed = parseDateOnly(dateOnly);
  if (!parsed) throw new Error(`invalid date "${dateOnly}"`);
  return formatUtcDate(new Date(parsed.getTime() + days * 24 * 60 * 60 * 1000));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Line-level diff (only changed lines are printed, LCS based). */
export function lineDiff(before: readonly string[], after: readonly string[]): string {
  const rows = before.length;
  const columns = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i]![j] = before[i] === after[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push(`- ${before[i]}`);
      i += 1;
    } else {
      lines.push(`+ ${after[j]}`);
      j += 1;
    }
  }
  while (i < rows) {
    lines.push(`- ${before[i]}`);
    i += 1;
  }
  while (j < columns) {
    lines.push(`+ ${after[j]}`);
    j += 1;
  }
  return lines.join("\n");
}

/**
 * Normalise a new screenshot, update the source data and regenerate the
 * published files. Throws with a "contact:update: ..."-style message on any
 * structural problem (bad image, unknown group, blank crop box).
 */
export function updateContact(options: ContactUpdateOptions): ContactUpdateResult {
  const write = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const rootDir = resolve(options.rootDir);
  const contactDir = join(rootDir, "contact");
  const srcDir = join(contactDir, "src");
  const groupsPath = join(contactDir, "groups.json");
  const cropsPath = join(contactDir, "crops.json");
  const imagePath = resolve(options.imagePath);
  const groupId = options.group ?? "wechat";
  const now = options.now ?? new Date();
  const date = options.date ?? formatLocalDate(now);
  if (parseDateOnly(date) === null) throw new Error(`invalid --date "${date}" (expected YYYY-MM-DD)`);

  const groupsRaw = readJsonFile(groupsPath);
  const groupsSource = validateGroupsSource(groupsRaw);
  const crops = validateCropsSource(readJsonFile(cropsPath));
  const group = groupsSource.groups.find((entry) => entry.id === groupId);
  if (!group) {
    throw new Error(`unknown group "${groupId}" (known: ${groupsSource.groups.map((entry) => entry.id).join(", ")})`);
  }
  const crop = crops.crops[groupId];
  if (!crop) throw new Error(`contact/crops.json has no crop box for group "${groupId}"`);
  if (!existsSync(imagePath)) throw new Error(`cannot find image ${imagePath}`);

  const raw = readFileSync(imagePath);
  if (!isPng(raw) && !isJpeg(raw)) {
    throw new Error(`${imagePath}: unsupported image format (expected PNG or JPEG)`);
  }
  let image;
  try {
    image = decodeImage(raw);
  } catch (error) {
    throw new Error(`${imagePath}: cannot decode image (${(error as Error).message})`);
  }
  if (image.width < MIN_IMAGE_SIZE || image.height < MIN_IMAGE_SIZE) {
    throw new Error(
      `${imagePath}: image is ${image.width}x${image.height}, expected at least ${MIN_IMAGE_SIZE}x${MIN_IMAGE_SIZE}`,
    );
  }
  const normalized = normalizeCard(image, crops.canvas);
  const cropPixels = cropImage(normalized, crop);
  const contrast = luminanceStdDev(cropPixels);
  if (contrast < MIN_CROP_CONTRAST) {
    throw new Error(
      `crop box for "${groupId}" looks blank (contrast ${contrast.toFixed(1)}) — is this really a QR screenshot?`,
    );
  }
  // Geometry gate (F2): three finder patterns, no clipping, re-detect >= 90%,
  // 4-module quiet zone and a >= 320px square output. Decoding is deliberately
  // not attempted (QQ/WeChat styles defeat open-source decoders).
  let publishedQr;
  try {
    publishedQr = extractQrCode(normalized, crop);
  } catch (error) {
    throw new Error(`crop box for "${groupId}": ${(error as Error).message}`);
  }

  const extension = isPng(raw) ? ".png" : ".jpg";
  const qrName = `qr-${groupId}-${date}${extension}`;
  const cardName = `card-${groupId}-${date}.png`;
  const cardPng = encodeTruecolorPng(normalized);
  const validUntil = addDays(date, VALID_DAYS);

  if (!isRecord(groupsRaw)) throw new Error(`${GROUPS_FILE}: root must be an object`);
  const rawGroups = groupsRaw["groups"];
  if (!Array.isArray(rawGroups)) throw new Error(`${GROUPS_FILE}: groups must be an array`);
  const rawGroup = rawGroups.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry["id"] === groupId);
  if (!rawGroup) throw new Error(`${GROUPS_FILE}: cannot locate group "${groupId}"`);
  rawGroup["card"] = cardName;
  rawGroup["qr"] = qrName;
  rawGroup["validUntil"] = validUntil;
  groupsRaw["updatedAt"] = date;
  groupsRaw["revision"] = groupsSource.revision + 1;

  const beforeText = readFileSync(groupsPath, "utf8");
  const afterText = `${JSON.stringify(groupsRaw, null, 2)}\n`;
  // Re-validate the edited source before anything is written.
  validateGroupsSource(groupsRaw);

  const filesWritten: string[] = [];
  const filesRemoved: string[] = [];
  if (!options.dryRun) {
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, qrName), raw);
    writeFileSync(join(srcDir, cardName), cardPng);
    writeFileSync(groupsPath, afterText);
    filesWritten.push(
      relativePosix(rootDir, join(srcDir, qrName)),
      relativePosix(rootDir, join(srcDir, cardName)),
      GROUPS_FILE,
    );
  }

  const staleThreshold = addDays(date, -STALE_DAYS);
  const stalePattern = new RegExp(
    `^(?:card|qr)-${escapeRegExp(groupId)}-(\\d{4}-\\d{2}-\\d{2})\\.(?:png|jpe?g)$`,
  );
  for (const fileName of readdirSync(srcDir)) {
    const match = stalePattern.exec(fileName);
    if (!match) continue;
    const fileDate = match[1]!;
    if (parseDateOnly(fileDate) === null) continue;
    if (fileDate >= staleThreshold) continue;
    if (!options.dryRun) unlinkSync(join(srcDir, fileName));
    filesRemoved.push(relativePosix(rootDir, join(srcDir, fileName)));
  }

  const diff = lineDiff(beforeText.split("\n"), afterText.split("\n"));

  const generated: string[] = [];
  if (!options.noBuild && !options.dryRun) {
    const result = generateData({
      rootDir,
      dataDir: options.dataDir,
      baselineFile: options.baselineFile,
      packageJsonPath: options.packageJsonPath,
    });
    generated.push(...result.files.map((file) => relativePosix(rootDir, file.path)));
  }

  write(`contact:update — group ${groupId} → ${date} (valid until ${validUntil})`);
  write(`contact:update — QR geometry ok (published ${publishedQr.width}x${publishedQr.height}px, 4-module quiet zone)`);
  if (diff.length > 0) {
    write(`${GROUPS_FILE}:`);
    for (const line of diff.split("\n")) write(`  ${line}`);
  }
  for (const file of filesWritten) write(`  wrote ${file}`);
  for (const file of filesRemoved) write(`  removed ${file}`);
  if (generated.length > 0) {
    write(`contact:update — regenerated ${generated.length} data file(s)`);
  }

  const needsConfirmation = !options.confirmed && !options.dryRun;
  if (needsConfirmation) {
    write(
      "contact:update — 请在真机上扫一次新码确认可加入；确认无误后加 --confirmed 重跑（或直接 npm run build:data 并发布）。",
    );
  }
  if (options.dryRun) {
    write(`contact:update — dry run: would write contact/src/${qrName}, contact/src/${cardName} and update ${GROUPS_FILE}`);
  }
  return {
    status: options.dryRun ? "dry-run" : needsConfirmation ? "needs-confirmation" : "updated",
    exitCode: needsConfirmation ? 3 : 0,
    group: groupId,
    date,
    validUntil,
    filesWritten,
    filesRemoved,
    diff,
    generated,
  };
}

const USAGE = `contact:update — refresh one contact group from a new QR screenshot

Usage:
  npm run contact:update -- <image> [--group wechat] [--date YYYY-MM-DD]
  npm run contact:update -- <image> --confirmed [--no-build]
  npm run contact:update -- <image> --dry-run
  npm run contact:update -- --check

Steps:
  1. normalise the screenshot onto the fixed 900x1600 card template
  2. geometry gate: three finder patterns, no clipping, re-detect >= 90%,
     4-module quiet zone, >= 320px square output (no decoding — see F2)
  3. write contact/src/card-<group>-<date>.png and qr-<group>-<date>.<ext>
  4. update contact/groups.json (card, qr, validUntil = date + 7 days, revision)
  5. delete that group's dated images older than 8 weeks
  6. regenerate data/manifest.json, data/img/ and src/core/baseline.ts
  7. exit 3 until a human scanned the new code and re-runs with --confirmed
`;

export async function runCli(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const parsed: {
    group?: string;
    date?: string;
    confirmed: boolean;
    dryRun: boolean;
    noBuild: boolean;
    check: boolean;
  } = { confirmed: false, dryRun: false, noBuild: false, check: false };
  let imagePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--group" || arg === "--date") {
      const value = argv[index + 1];
      if (!value) {
        process.stderr.write(`contact:update: ${arg} needs a value\n`);
        return 2;
      }
      if (arg === "--group") parsed.group = value;
      else parsed.date = value;
      index += 1;
    } else if (arg === "--confirmed") {
      parsed.confirmed = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--no-build") {
      parsed.noBuild = true;
    } else if (arg === "--check") {
      parsed.check = true;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`contact:update: unknown option "${arg}"\n\n${USAGE}`);
      return 2;
    } else if (imagePath === undefined) {
      imagePath = arg;
    } else {
      process.stderr.write(`contact:update: unexpected argument "${arg}"\n`);
      return 2;
    }
  }

  let rootDir: string;
  try {
    rootDir = findRepoRoot();
  } catch (error) {
    process.stderr.write(`contact:update: ${(error as Error).message}\n`);
    return 1;
  }

  if (parsed.check) {
    try {
      const result = generateData({ rootDir, check: true });
      if (result.drift.length === 0) {
        process.stdout.write("contact:update — generated data is up to date\n");
        return 0;
      }
      process.stderr.write(`contact:update — generated data is stale: ${result.drift.join(", ")}\n`);
      return 1;
    } catch (error) {
      process.stderr.write(`contact:update: ${(error as Error).message}\n`);
      return 1;
    }
  }

  if (imagePath === undefined) {
    process.stderr.write(`contact:update: missing <image> argument\n\n${USAGE}`);
    return 2;
  }
  try {
    const result = updateContact({
      rootDir,
      imagePath,
      group: parsed.group,
      date: parsed.date,
      confirmed: parsed.confirmed,
      dryRun: parsed.dryRun,
      noBuild: parsed.noBuild,
    });
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`contact:update: ${(error as Error).message}\n`);
    return 1;
  }
}