import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isCliEntryPoint } from "../cli/entry";

const entryPath = join(tmpdir(), "dsh-verify-entry.js");
const entryUrl = pathToFileURL(entryPath).href;
const linkPath = join(tmpdir(), "node_modules", "dsh-featherhunter-plugin-base", "dist", "real-machine-verification", "cli", "main.js");
const linkUrl = pathToFileURL(linkPath).href;

describe("CLI entry detection", () => {
  it("accepts the literal argv path", () => {
    expect(isCliEntryPoint(entryPath, entryUrl, () => entryPath)).toBe(true);
  });

  it("accepts a junction path whose realpath is the module", () => {
    expect(isCliEntryPoint(linkPath, entryUrl, () => entryPath)).toBe(true);
  });

  it("accepts the literal link URL when Node preserves symlinks", () => {
    // With --preserve-symlinks import.meta.url is the link path, not the realpath.
    expect(isCliEntryPoint(linkPath, linkUrl, () => entryPath)).toBe(true);
  });

  it("rejects a different module", () => {
    expect(isCliEntryPoint(entryPath, pathToFileURL(join(tmpdir(), "other.js")).href, () => entryPath)).toBe(false);
  });

  it("rejects a missing argv[1]", () => {
    expect(isCliEntryPoint(undefined, entryUrl, () => entryPath)).toBe(false);
    expect(isCliEntryPoint("", entryUrl, () => entryPath)).toBe(false);
  });

  it("still compares the literal path when realpath fails", () => {
    const result = isCliEntryPoint(
      entryPath,
      entryUrl,
      () => {
        throw new Error("ENOENT");
      },
    );
    expect(result).toBe(true);
  });

  it("rejects when realpath fails and the literal path does not match", () => {
    expect(
      isCliEntryPoint(linkPath, entryUrl, () => {
        throw new Error("ENOENT");
      }),
    ).toBe(false);
  });
});

