/**
 * Reading the file table of an Electron `app.asar`.
 *
 * A DSH desktop install keeps its host code inside one archive; on disk there is
 * no `resources/app.asar/dsh/.../cli.js` to stat. The only honest way to say "the
 * CLI entry is present" from plain Node is to read the archive's header — a JSON
 * file table stored as a Chromium Pickle at offset 0 — and look the entry up.
 *
 * The layout, confirmed against a real 182 MB install:
 *
 * ```
 * uint32 @0   size of the header-size pickle (4)
 * uint32 @4   bytes of header region that follow (pickle framing included)
 * uint32 @8   size of the header pickle payload
 * uint32 @12  byte length of the JSON header
 * @16         the JSON header ("files" tree)
 * data offset = 8 + u32@4
 * ```
 *
 * Only the prefix and the JSON are read; the half-gigabyte of packaged code is
 * never touched. Every failure is a `Result` because a truncated or non-asar
 * file is an observation about the install, not an exception in the caller.
 */
import { err, failure, ok, type Result } from "../../contracts/result";
import type { ReadFileSlice } from "../types";

/** Posix path of the desktop host CLI entry inside the archive. */
export const ASAR_CLI_ENTRY = "dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js";

/** Bytes needed to read the four size words before the JSON header. */
const PREFIX_BYTES = 16;

/** A corrupt size word must not turn into a multi-gigabyte allocation. */
const MAX_HEADER_BYTES = 64 * 1024 * 1024;

/** Structurally parsed header bounds, useful for evidence on their own. */
export interface AsarHeaderBounds {
  /** Byte length of the JSON header. */
  readonly jsonLength: number;
  /** Bytes from offset 8 to the start of file data (pickle framing included). */
  readonly headerBytes: number;
  /** Absolute file offset where packed file contents begin. */
  readonly dataOffset: number;
}

/** One entry in the archive's file table. */
export interface AsarEntryInfo {
  readonly path: string;
  readonly size: number;
  /** Offset of the file payload relative to `dataOffset`; `null` when unpacked. */
  readonly offset: number | null;
  /** sha256 from the archive's integrity metadata, when present. */
  readonly integritySha256: string | null;
}

/** Decode the four size words that precede the JSON header. */
export function parseAsarHeaderBounds(prefix: Uint8Array): Result<AsarHeaderBounds> {
  if (prefix.byteLength < PREFIX_BYTES) {
    return err(
      failure("unsupported", `asar header prefix is ${prefix.byteLength} bytes, expected at least ${PREFIX_BYTES}`),
    );
  }
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  const pickleSize = view.getUint32(0, true);
  const headerBytes = view.getUint32(4, true);
  const payloadSize = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);

  if (pickleSize !== 4 || payloadSize === 0) {
    return err(
      failure(
        "unsupported",
        `not an Electron asar archive: header pickle sizes are ${pickleSize}/${payloadSize}`,
        "point --dsh-exe at the desktop install whose resources/app.asar this path should be",
      ),
    );
  }
  if (jsonLength === 0 || jsonLength > MAX_HEADER_BYTES) {
    return err(
      failure("unsupported", `asar header JSON length ${jsonLength} is not plausible for a DSH install`),
    );
  }
  if (headerBytes < jsonLength + 8) {
    return err(
      failure("unsupported", `asar header region ${headerBytes} cannot contain a ${jsonLength}-byte JSON header`),
    );
  }
  return ok({ jsonLength, headerBytes, dataOffset: 8 + headerBytes });
}

/** Walk the `files` tree and return one entry, or explain what was missing. */
export function findAsarEntry(header: unknown, entryPosixPath: string): Result<AsarEntryInfo> {
  const segments = entryPosixPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return err(failure("invalid-input", "an asar entry path must name at least one segment"));
  }
  let node: unknown = header;
  for (const segment of segments) {
    const files = node !== null && typeof node === "object" ? (node as { files?: unknown }).files : undefined;
    if (files === undefined || files === null || typeof files !== "object") {
      return err(
        failure(
          "not-found",
          `asar archive has no ${JSON.stringify(entryPosixPath)} (no file table at ${JSON.stringify(segment)})`,
        ),
      );
    }
    node = (files as Record<string, unknown>)[segment];
    if (node === undefined) {
      return err(
        failure(
          "not-found",
          `asar archive does not contain ${JSON.stringify(entryPosixPath)} (missing ${JSON.stringify(segment)})`,
        ),
      );
    }
  }
  if (node === null || typeof node !== "object") {
    return err(failure("not-found", `asar entry ${entryPosixPath} is not a file record`));
  }
  const record = node as { size?: unknown; offset?: unknown; unpacked?: unknown; integrity?: unknown };
  if (typeof record.size !== "number" || record.size < 0) {
    return err(failure("not-found", `asar entry ${entryPosixPath} has no usable size`));
  }
  const rawOffset = record.offset;
  const offset =
    typeof rawOffset === "number"
      ? rawOffset
      : typeof rawOffset === "string" && rawOffset.length > 0 && /^\d+$/.test(rawOffset)
        ? Number(rawOffset)
        : null;
  const integrity = record.integrity;
  const integritySha256 =
    integrity !== null && typeof integrity === "object" && typeof (integrity as { hash?: unknown }).hash === "string"
      ? ((integrity as { hash: string }).hash)
      : null;
  return ok({ path: entryPosixPath, size: record.size, offset, integritySha256 });
}

/** Read the archive header through an injected slice reader and look up one entry. */
export async function readAsarEntry(
  readSlice: ReadFileSlice,
  asarPath: string,
  entryPosixPath: string = ASAR_CLI_ENTRY,
): Promise<Result<AsarEntryInfo>> {
  const prefix = await readSlice(asarPath, 0, PREFIX_BYTES);
  if (!prefix.ok) return prefix;
  const bounds = parseAsarHeaderBounds(prefix.value);
  if (!bounds.ok) return bounds;
  const json = await readSlice(asarPath, PREFIX_BYTES, bounds.value.jsonLength);
  if (!json.ok) return json;
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(json.value));
  } catch (error) {
    return err(
      failure(
        "unsupported",
        `asar header is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
  return findAsarEntry(header, entryPosixPath);
}
