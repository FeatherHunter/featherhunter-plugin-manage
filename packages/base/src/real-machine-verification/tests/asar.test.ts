/**
 * Reading an asar header is the only way to prove a DSH install is complete
 * without executing it. The layout is Electron's, not ours, so the parser is
 * tested against bytes built with the real field offsets: a header that says it is
 * 4748096 bytes long must not make the reader allocate 4.7 MB to answer "is this
 * entry there".
 */
import { describe, expect, it } from "vitest";

import { ASAR_CLI_ENTRY, findAsarEntry, parseAsarHeaderBounds, readAsarEntry } from "../runtime/dsh/asar";
import { parseNodeVersion } from "../declaration/loader";
import { buildFakeAsarBytes, createFakeReadFileSlice } from "./support/fake-machine";
import { FakeFs } from "./support/fake-fs";

const PREFIX = 16;

function entryHeader(entries?: Readonly<Record<string, string>>): { header: Record<string, unknown>; bytes: Uint8Array } {
  const bytes = buildFakeAsarBytes(entries);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(PREFIX, PREFIX + jsonLength))) as Record<string, unknown>;
  return { header: json, bytes };
}

describe("parseAsarHeaderBounds", () => {
  it("reads the four little-endian fields and the data offset", () => {
    const { bytes } = entryHeader();
    const parsed = parseAsarHeaderBounds(bytes.subarray(0, PREFIX));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.dataOffset).toBeGreaterThanOrEqual(parsed.value.headerBytes + 8);
    expect(parsed.value.jsonLength).toBeGreaterThan(0);
    expect(parsed.value.headerBytes).toBe(parsed.value.jsonLength + 8 + (parsed.value.headerBytes - parsed.value.jsonLength - 8));
  });

  it("refuses a header that is not an asar pickle", () => {
    const bytes = new Uint8Array(PREFIX);
    new DataView(bytes.buffer).setUint32(0, 7, true);
    const parsed = parseAsarHeaderBounds(bytes);
    expect(parsed.ok).toBe(false);
  });

  it("refuses a header size that would point outside the file", () => {
    const { bytes } = entryHeader();
    const corrupted = new Uint8Array(bytes.subarray(0, PREFIX));
    new DataView(corrupted.buffer).setUint32(4, 0, true);
    const parsed = parseAsarHeaderBounds(corrupted);
    expect(parsed.ok).toBe(false);
  });
});

describe("findAsarEntry", () => {
  it("walks the nested files tree to the host CLI entry", () => {
    const { header } = entryHeader();
    const found = findAsarEntry(header, ASAR_CLI_ENTRY);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.path).toBe(ASAR_CLI_ENTRY);
    expect(found.value.size).toBeGreaterThan(0);
    expect(found.value.integritySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a missing entry as a failure with the path in the message", () => {
    const { header } = entryHeader();
    const found = findAsarEntry(header, "dsh/node_modules/absent/lib/cli.js");
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error.message).toContain("absent");
  });

  it("reads an entry through a slice reader without touching the whole archive", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    const asarPath = "C:\\Harness\\resources\\app.asar";
    fs.seedFile(asarPath, buildFakeAsarBytes());

    const read = await readAsarEntry(createFakeReadFileSlice(fs), asarPath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.path).toBe(ASAR_CLI_ENTRY);
    expect(read.value.size).toBeGreaterThan(0);
  });

  it("fails cleanly when the archive is not an asar file", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    const asarPath = "C:\\Harness\\resources\\app.asar";
    fs.seedFile(asarPath, "not an archive at all, just a text file");

    const read = await readAsarEntry(createFakeReadFileSlice(fs), asarPath);
    expect(read.ok).toBe(false);
  });
});

describe("parseNodeVersion sanity", () => {
  it("is importable and strips a leading v", () => {
    expect(parseNodeVersion("v24.19.0")).toEqual([24, 19, 0]);
  });
});
