import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCK_DEFINITIONS,
  compareBlocks,
  updateReadme,
  updateReadmes,
  writeFileAtomic,
} from "../src/node/index";
import {
  expectMigratedContactSources,
  fixtureContactRaw,
  makeTempDir,
} from "./readme-helpers";

const START = "<!-- CONTACT-START -->";
const END = "<!-- CONTACT-END -->";

/** A small README that wraps a legacy contact block with unrelated text. */
function fakeReadme(contactRaw: string): string {
  return "# Demo plugin\n\nSome intro paragraph.\n\n" + contactRaw + "\n\n## Footer\n\nFooter text.\n";
}

/** Write a README into a throwaway directory and return its helpers. */
function setup(readmeText: string): { dir: string; readmePath: string; cleanup: () => void } {
  const { dir, cleanup } = makeTempDir();
  const readmePath = join(dir, "README.md");
  writeFileSync(readmePath, readmeText, "utf8");
  return { dir, readmePath, cleanup };
}

function markedInner(markdown: string): string {
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markdown.slice(start + START.length, end).trim();
}

describe("readme:init", () => {
  it("inserts paired markers around a rendered contact block in an unmarked README", () => {
    const contactRaw = fixtureContactRaw("deck");
    const { dir, readmePath, cleanup } = setup(fakeReadme(contactRaw));
    try {
      const result = updateReadme({ root: dir, command: "init" });
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.changed).toBe(true);

      const markdown = readFileSync(readmePath, "utf8");
      expect(markdown).toContain(START);
      expect(markdown).toContain(END);
      expect(markdown).toContain(
        "cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@0.0.1/data/img/card-feishu.png",
      );
      expect(markdown.startsWith("# Demo plugin\n\nSome intro paragraph.\n\n")).toBe(true);
      expect(markdown.endsWith("\n\n## Footer\n\nFooter text.\n")).toBe(true);

      const comparison = compareBlocks("contact", expectMigratedContactSources(contactRaw), markedInner(markdown));
      expect(comparison.contentDifferences).toEqual([]);
      expect(comparison.equivalent).toBe(true);

      const again = updateReadme({ root: dir, command: "init" });
      expect(again.errors).toEqual([]);
      expect(again.changed).toBe(false);
      expect(readFileSync(readmePath, "utf8")).toBe(markdown);
    } finally {
      cleanup();
    }
  });

  it("keeps ilife's Markdown heading variant when seeding markers", () => {
    const contactRaw = fixtureContactRaw("ilife");
    const { dir, readmePath, cleanup } = setup(fakeReadme(contactRaw));
    try {
      const result = updateReadme({ root: dir, command: "init" });
      expect(result.errors).toEqual([]);
      const markdown = readFileSync(readmePath, "utf8");
      const inner = markedInner(markdown);
      expect(inner.startsWith("## 反馈与联系")).toBe(true);
      expect(inner).not.toContain("<h2");
      const comparison = compareBlocks("contact", expectMigratedContactSources(contactRaw), inner);
      expect(comparison.contentDifferences).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("keeps the English heading and titles of an en README", () => {
    const contactRaw = fixtureContactRaw("deck-en");
    const { dir, readmePath, cleanup } = setup(fakeReadme(contactRaw));
    try {
      const result = updateReadme({ root: dir, command: "init" });
      expect(result.errors).toEqual([]);
      const inner = markedInner(readFileSync(readmePath, "utf8"));
      expect(inner).toContain("Feedback and Contact");
      expect(inner).toContain("Feishu Group (Main)");
      const comparison = compareBlocks("contact", expectMigratedContactSources(contactRaw), inner);
      expect(comparison.contentDifferences).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("reports a missing README instead of creating one", () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const result = updateReadme({ root: dir, command: "init" });
      expect(result.ok).toBe(false);
      expect(result.changed).toBe(false);
      expect(result.errors.join("\n")).toMatch(/README\.md/);
    } finally {
      cleanup();
    }
  });
});
describe("readme:sync", () => {
  /** Initialize a temp README, then return its directory and current text. */
  function seeded(contactId = "deck"): { dir: string; readmePath: string; markdown: string; cleanup: () => void } {
    const { dir, readmePath, cleanup } = setup(fakeReadme(fixtureContactRaw(contactId)));
    const init = updateReadme({ root: dir, command: "init" });
    expect(init.errors).toEqual([]);
    return { dir, readmePath, markdown: readFileSync(readmePath, "utf8"), cleanup };
  }

  it("rewrites only the marked block, then is a zero-diff no-op", () => {
    const { dir, readmePath, markdown, cleanup } = seeded();
    try {
      const drifted = markdown
        .replace("@0.0.1", "@0.0.0")
        .replace("</div>", "<em>hand edit</em>\n</div>");
      writeFileSync(readmePath, drifted, "utf8");

      const result = updateReadme({ root: dir, command: "sync" });
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.changed).toBe(true);
      const synced = readFileSync(readmePath, "utf8");
      expect(synced).toBe(markdown);
      expect(synced).not.toContain("hand edit");

      const again = updateReadme({ root: dir, command: "sync" });
      expect(again.errors).toEqual([]);
      expect(again.changed).toBe(false);
      expect(readFileSync(readmePath, "utf8")).toBe(synced);
    } finally {
      cleanup();
    }
  });

  it("refuses to run on a README without contact markers", () => {
    const { dir, readmePath, cleanup } = setup(fakeReadme(fixtureContactRaw("deck")));
    try {
      const before = readFileSync(readmePath, "utf8");
      const result = updateReadme({ root: dir, command: "sync" });
      expect(result.ok).toBe(false);
      expect(result.changed).toBe(false);
      expect(result.errors.join("\n")).toMatch(/readme:init/);
      expect(readFileSync(readmePath, "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });
});

describe("readme --check", () => {
  it("passes on an up-to-date README and reports drift without writing", () => {
    const contactRaw = fixtureContactRaw("deck");
    const { dir, readmePath, cleanup } = setup(fakeReadme(contactRaw));
    try {
      const before = readFileSync(readmePath, "utf8");
      const drift = updateReadme({ root: dir, command: "init", check: true });
      expect(drift.ok).toBe(false);
      expect(drift.changed).toBe(true);
      expect(drift.written).toBe(false);
      expect(drift.errors.join("\n")).toMatch(/out of date/);
      expect(readFileSync(readmePath, "utf8")).toBe(before);

      expect(updateReadme({ root: dir, command: "init" }).errors).toEqual([]);
      const clean = updateReadme({ root: dir, command: "sync", check: true });
      expect(clean.ok).toBe(true);
      expect(clean.changed).toBe(false);
      expect(clean.written).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("readme marker hygiene", () => {
  it("reports unpaired markers and leaves the file untouched", () => {
    const readme = fakeReadme(fixtureContactRaw("deck")) + "\n" + START + "\n";
    const { dir, readmePath, cleanup } = setup(readme);
    try {
      const before = readFileSync(readmePath, "utf8");
      const result = updateReadme({ root: dir, command: "sync" });
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/unpaired/);
      expect(readFileSync(readmePath, "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("reports duplicate and reversed markers instead of guessing", () => {
    const duplicate = fakeReadme(START + "\n" + END + "\n" + START + "\n" + END);
    const { dir, readmePath, cleanup } = setup(duplicate);
    try {
      const result = updateReadme({ root: dir, command: "sync" });
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/duplicate/);
    } finally {
      cleanup();
    }

    const reversed = fakeReadme(END + "\nstale\n" + START);
    const second = setup(reversed);
    try {
      const result = updateReadme({ root: second.dir, command: "sync" });
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/before start/);
    } finally {
      second.cleanup();
    }
  });
});

describe("readme suspicious lines", () => {
  it("stops on merge-conflict residue and does not modify the file", () => {
    const readme =
      fakeReadme(fixtureContactRaw("deck")) + "\n</div>>>>>>>> origin/master\n";
    const { dir, readmePath, cleanup } = setup(readme);
    try {
      const before = readFileSync(readmePath, "utf8");
      const result = updateReadme({ root: dir, command: "init" });
      expect(result.ok).toBe(false);
      expect(result.changed).toBe(false);
      expect(result.errors.join("\n")).toMatch(/suspicious/);
      expect(result.errors.join("\n")).toMatch(/refusing to modify/);
      expect(readFileSync(readmePath, "utf8")).toBe(before);

      const check = updateReadme({ root: dir, command: "init", check: true });
      expect(check.ok).toBe(false);
      expect(readFileSync(readmePath, "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });
});

describe("atomic README writes", () => {
  it("keeps the original file and no temp file when the rename step fails", () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const target = join(dir, "README.md");
      writeFileSync(target, "original\n", "utf8");
      expect(() =>
        writeFileAtomic(target, "replacement\n", {
          beforeRename: () => {
            throw new Error("simulated failure");
          },
        }),
      ).toThrow(/simulated failure/);
      expect(readFileSync(target, "utf8")).toBe("original\n");
      expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("replaces the file atomically on success", () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const target = join(dir, "README.md");
      writeFileSync(target, "original\n", "utf8");
      writeFileAtomic(target, "replacement\n");
      expect(readFileSync(target, "utf8")).toBe("replacement\n");
      expect(readdirSync(dir)).toEqual(["README.md"]);
    } finally {
      cleanup();
    }
  });
});

describe("readme batch (--all)", () => {
  it("processes every root and keeps going after a per-file error", () => {
    const missing = makeTempDir();
    const stale = setup(fakeReadme(fixtureContactRaw("deck")));
    try {
      const result = updateReadmes({
        roots: [missing.dir, stale.dir],
        command: "init",
        all: true,
      });
      expect(result.files).toHaveLength(2);
      expect(result.files[0]!.ok).toBe(false);
      expect(result.files[0]!.errors.join("\n")).toMatch(/README\.md/);
      expect(result.files[1]!.ok).toBe(true);
      expect(result.files[1]!.changed).toBe(true);
      expect(result.ok).toBe(false);
      expect(readFileSync(stale.readmePath, "utf8")).toContain(START);
    } finally {
      missing.cleanup();
      stale.cleanup();
    }
  });
});

describe("block registry", () => {
  it("implements contact and reserves the markers of the follow-up blocks", () => {
    const byName = new Map(BLOCK_DEFINITIONS.map((definition) => [definition.name, definition]));
    expect([...byName.keys()]).toEqual(["contact", "more", "star-history", "thanks"]);

    const contact = byName.get("contact")!;
    expect(contact.render).toBeTypeOf("function");
    expect(contact.locateLegacy).toBeTypeOf("function");
    expect(contact.markers).toEqual([{ start: START, end: END }]);

    expect(byName.get("more")!.markers.map((set) => [set.start, set.end])).toEqual([
      ["<!-- MORE-START -->", "<!-- MORE-END -->"],
    ]);
    expect(byName.get("star-history")!.markers.map((set) => [set.start, set.end])).toEqual([
      ["<!-- STAR-HISTORY-START -->", "<!-- STAR-HISTORY-END -->"],
    ]);
    expect(byName.get("thanks")!.markers.map((set) => [set.lang, set.start, set.end])).toEqual([
      ["zh", "<!-- THANKS-TABLE-ZH-START -->", "<!-- THANKS-TABLE-ZH-END -->"],
      ["en", "<!-- THANKS-TABLE-EN-START -->", "<!-- THANKS-TABLE-EN-END -->"],
    ]);
    for (const name of ["more", "star-history", "thanks"] as const) {
      expect(byName.get(name)!.render).toBeUndefined();
    }
  });
});
