/**
 * Reading what `npm pack` produced, without trusting the host's `tar`.
 *
 * The tarball is the candidate's physical identity, so its contents are parsed
 * here and hashed from the same bytes that are hashed as a whole. A corrupt or
 * ambiguous archive is a failure, never a partial file list: a manifest that
 * silently omits files would describe a package nobody shipped.
 */
import { gunzipSync } from "node:zlib";

import { err, ok, type Result } from "../../contracts/result";

const BLOCK = 512;
const MAX_ENTRIES = 100_000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/** One regular file inside the package. */
export interface NpmPackFile {
  /** Path relative to the package root, `/` separated and sorted by this module. */
  readonly path: string;
  readonly bytes: number;
  readonly content: Uint8Array;
}

/** The subset of `npm pack --json` this command relies on. */
export interface NpmPackEntry {
  readonly filename: string;
  readonly name?: string;
  readonly version?: string;
  readonly shasum?: string;
  readonly integrity?: string;
  readonly size?: number;
}

export interface UnpackedTarball {
  readonly files: readonly NpmPackFile[];
  readonly packageJson: Record<string, unknown>;
}

function invalid(message: string, hint?: string): Result<never> {
  return err({ code: "invalid-input", message, ...(hint === undefined ? {} : { hint }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the one JSON document npm prints. Warnings belong on stderr, but a
 * caller that got prose on stdout must not have it mistaken for a file name.
 */
export function parseNpmPackJson(stdout: string): Result<readonly NpmPackEntry[]> {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return invalid("npm pack printed nothing on stdout", "run `npm pack --json` by hand to see the failure");
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return invalid(
      `npm pack stdout is not JSON: ${JSON.stringify(trimmed.slice(0, 200))}`,
      "npm wrappers sometimes print banners; run npm directly or fix the wrapper",
    );
  }
  if (!Array.isArray(value) || value.length === 0) {
    return invalid("npm pack JSON must be a non-empty array of pack results");
  }
  const entries: NpmPackEntry[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return invalid(`npm pack JSON[${index}] must be an object`);
    if (typeof item.filename !== "string" || !item.filename.endsWith(".tgz")) {
      return invalid(`npm pack JSON[${index}].filename ${JSON.stringify(item.filename)} must end with .tgz`);
    }
    const optionalString = (field: "name" | "version" | "shasum" | "integrity"): string | undefined => {
      const raw = item[field];
      return typeof raw === "string" ? raw : undefined;
    };
    const name = optionalString("name");
    const version = optionalString("version");
    const shasum = optionalString("shasum");
    const integrity = optionalString("integrity");
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : undefined;
    entries.push({
      filename: item.filename,
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
      ...(shasum === undefined ? {} : { shasum }),
      ...(integrity === undefined ? {} : { integrity }),
      ...(size === undefined ? {} : { size }),
    });
  }
  return ok(entries);
}

function allZero(block: Uint8Array): boolean {
  for (const byte of block) if (byte !== 0) return false;
  return true;
}

function readCString(block: Uint8Array, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return Buffer.from(slice.subarray(0, end === -1 ? slice.length : end)).toString("utf8");
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const slice = block.subarray(offset, offset + length);
  if (slice.length > 0 && (slice[0] & 0x80) !== 0) {
    // GNU base-256 extension: the low 7 bits of the first byte are the top bits.
    let value = slice[0] & 0x7f;
    for (let index = 1; index < slice.length; index += 1) value = value * 256 + slice[index];
    return value;
  }
  const text = readCString(block, offset, length).trim();
  if (text.length === 0) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`tar header field at ${offset} is not octal: ${JSON.stringify(text)}`);
  return Number.parseInt(text, 8);
}

/** PAX headers are a sequence of `<length> <key>=<value>\n` records, lengths in bytes. */
function parsePax(payload: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.subarray(offset).indexOf(0x20);
    if (space <= 0) throw new Error("PAX record has no length separator");
    const lengthText = Buffer.from(payload.subarray(offset, offset + space)).toString("ascii");
    if (!/^[0-9]+$/.test(lengthText)) throw new Error(`PAX record length is not decimal: ${JSON.stringify(lengthText)}`);
    const recordLength = Number.parseInt(lengthText, 10);
    if (recordLength <= space + 1 || offset + recordLength > payload.length) throw new Error("PAX record length is out of bounds");
    const record = payload.subarray(offset + space + 1, offset + recordLength - 1);
    if (payload[offset + recordLength - 1] !== 0x0a) throw new Error("PAX record does not end with a newline");
    const equals = record.indexOf(0x3d);
    if (equals <= 0) throw new Error("PAX record has no key");
    const key = Buffer.from(record.subarray(0, equals)).toString("utf8");
    const value = Buffer.from(record.subarray(equals + 1)).toString("utf8");
    records.set(key, value);
    offset += recordLength;
  }
  return records;
}

/**
 * `package/` is the prefix npm uses. Stripping it is the only normalization
 * allowed: absolute paths, backslashes and `..` are rejected because they
 * would make the file list name something outside the package.
 */
function normalizeEntryPath(raw: string): string | null {
  let path = raw;
  if (path.startsWith("./")) path = path.slice(2);
  if (path.startsWith("package/")) path = path.slice("package/".length);
  if (path.length === 0 || path.includes("\\") || path.includes("\0")) return null;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return path;
}

/** Decompress and list the regular files in a `.tgz`. */
export function unpackNpmTarball(bytes: Uint8Array): Result<UnpackedTarball> {
  let data: Buffer;
  try {
    data = gunzipSync(bytes);
  } catch (error) {
    return invalid(`package is not a readable gzip archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const files = new Map<string, NpmPackFile>();
  let offset = 0;
  let totalBytes = 0;
  let pendingLongName: string | null = null;
  let pendingPaxPath: string | null = null;
  let entryCount = 0;

  try {
    while (offset + BLOCK <= data.length) {
      const header = data.subarray(offset, offset + BLOCK);
      if (allZero(header)) break;
      entryCount += 1;
      if (entryCount > MAX_ENTRIES) return invalid(`package has more than ${MAX_ENTRIES} entries`);
      const typeByte = header[156];
      const type = typeByte === 0 ? "\0" : String.fromCharCode(typeByte);
      const headerSize = readOctal(header, 124, 12);
      const headerName = readCString(header, 0, 100);
      const magic = readCString(header, 257, 6);
      const prefix = magic.startsWith("ustar") ? readCString(header, 345, 155) : "";
      const headerPath = prefix.length > 0 ? `${prefix}/${headerName}` : headerName;
      offset += BLOCK;
      if (headerSize < 0 || offset + headerSize > data.length) throw new Error(`tar entry ${JSON.stringify(headerPath)} declares ${headerSize} bytes beyond the archive`);
      const payload = data.subarray(offset, offset + headerSize);
      offset += Math.ceil(headerSize / BLOCK) * BLOCK;

      if (type === "L") {
        pendingLongName = Buffer.from(payload).toString("utf8").replace(/\0+$/, "");
        continue;
      }
      if (type === "K") continue;
      if (type === "x") {
        const pax = parsePax(payload);
        pendingPaxPath = pax.get("path") ?? pendingPaxPath;
        continue;
      }
      if (type === "g") continue;

      const rawPath = pendingPaxPath ?? pendingLongName ?? headerPath;
      pendingLongName = null;
      pendingPaxPath = null;

      if (type === "5") continue;
      if (type !== "0" && type !== "\0" && type !== "7") {
        return invalid(`package contains unsupported tar entry type ${JSON.stringify(type)} at ${JSON.stringify(rawPath)}`, "only regular files can be hashed as package contents");
      }

      const path = normalizeEntryPath(rawPath);
      if (path === null) return invalid(`package contains an unsafe path: ${JSON.stringify(rawPath)}`);
      if (files.has(path)) return invalid(`package lists the same path twice: ${path}`);
      totalBytes += payload.length;
      if (totalBytes > MAX_TOTAL_BYTES) return invalid(`package expands to more than ${MAX_TOTAL_BYTES} bytes`);
      files.set(path, { path, bytes: payload.length, content: Uint8Array.from(payload) });
    }
  } catch (error) {
    return invalid(`package tar is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const packageJsonFile = files.get("package.json");
  if (packageJsonFile === undefined) return invalid("package tarball has no package.json at its root");
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(Buffer.from(packageJsonFile.content).toString("utf8"));
  } catch {
    return invalid("package/package.json inside the tarball is not valid JSON");
  }
  if (!isRecord(packageJson)) return invalid("package/package.json inside the tarball is not an object");

  const sorted = [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ok({ files: sorted, packageJson });
}
