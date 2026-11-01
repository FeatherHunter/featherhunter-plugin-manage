/**
 * The docs gate: the reference blocks in README.md and AGENTS-USAGE.md are
 * projections of `describeCapability()`, and a stale projection fails the suite.
 *
 * The sentinel test is the interesting one: it injects a command that no
 * hand-written document could contain and proves the block is generated. The disk
 * test is the boring one that catches the real failure mode — someone edited the
 * description and forgot to run `npm run docs:sync`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { describeCapability, type CapabilityDescription } from "../src/real-machine-verification/capability-description";
import {
  DOC_TARGETS,
  REFERENCE_BEGIN,
  REFERENCE_END,
  checkDocs,
  demoteHeadings,
  renderReferenceBlock,
  spliceReference,
} from "../scripts/docs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SENTINEL_COMMAND = {
  name: "sentinel-command",
  layer: 3 as const,
  summary: "a command that exists only in the injected description",
  usage: "dsh-verify sentinel-command [--json]",
  writes: "nothing",
  flags: ["--json"],
};

function withSentinel(description: CapabilityDescription): CapabilityDescription {
  return { ...description, commands: [...description.commands, SENTINEL_COMMAND] };
}

const SAMPLE = [REFERENCE_BEGIN, "old block", REFERENCE_END, "", "after"].join("\n");

describe("reference block", () => {
  it("is deterministic and carries the real command surface", () => {
    const block = renderReferenceBlock();
    expect(block).toBe(renderReferenceBlock());
    expect(block).toContain("dsh-verify self-check");
    expect(block).toContain("dsh-verify describe --json".replace(" describe --json", " describe"));
  });

  it("is generated, not transcribed: an injected command shows up", () => {
    const block = renderReferenceBlock(withSentinel(describeCapability()));
    expect(block).toContain(SENTINEL_COMMAND.usage);
  });

  it("demotes headings by exactly one level", () => {
    expect(demoteHeadings("# title\n## section\n### deep")).toBe("## title\n### section\n#### deep");
  });
});

describe("spliceReference", () => {
  it("replaces only the text between the markers and is idempotent", () => {
    const once = spliceReference(SAMPLE, "new block");
    expect(once).toBe([REFERENCE_BEGIN, "new block", REFERENCE_END, "", "after"].join("\n"));
    expect(spliceReference(once, "new block")).toBe(once);
  });

  it("refuses malformed markers instead of guessing", () => {
    expect(() => spliceReference("no markers here", "block")).toThrow(/reference:begin/);
    expect(() => spliceReference([REFERENCE_BEGIN, "x"].join("\n"), "block")).toThrow(/reference:end/);
    expect(() =>
      spliceReference([REFERENCE_BEGIN, REFERENCE_BEGIN, REFERENCE_END].join("\n"), "block"),
    ).toThrow(/exactly one/);
    expect(() =>
      spliceReference([REFERENCE_END, REFERENCE_BEGIN].join("\n"), "block"),
    ).toThrow(/before/);
  });
});

describe("documents on disk", () => {
  it("has a marker pair in every target", () => {
    for (const target of DOC_TARGETS) {
      const text = readFileSync(resolve(PACKAGE_ROOT, target), "utf8");
      expect(text.split("\n").filter((line) => line === REFERENCE_BEGIN)).toHaveLength(1);
      expect(text.split("\n").filter((line) => line === REFERENCE_END)).toHaveLength(1);
    }
  });

  it("is in sync with describeCapability()", () => {
    const result = checkDocs(PACKAGE_ROOT);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
