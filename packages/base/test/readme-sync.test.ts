import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE, sortByOrder } from "../src/core/index";
import {
  BLOCK_DEFINITIONS,
  compareBlocks,
  parseMoreBlock,
  updateReadme,
  updateReadmes,
  writeFileAtomic,
} from "../src/node/index";
import {
  expectMigratedContactSources,
  fixtureContactRaw,
  fixtureMoreRaw,
  makeTempDir,
} from "./readme-helpers";

const START = "<!-- CONTACT-START -->";
const END = "<!-- CONTACT-END -->";
const MORE_START = "<!-- MORE-START -->";
const MORE_END = "<!-- MORE-END -->";

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

/** Inner text of the marked MORE block. */
function moreInner(markdown: string): string {
  const start = markdown.indexOf(MORE_START);
  const end = markdown.indexOf(MORE_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markdown.slice(start + MORE_START.length, end).trim();
}

/** Plugin names the MORE block must list for one repository. */
function manifestRowNames(selfId?: string): string[] {
  return sortByOrder(BASELINE.manifest.plugins)
    .filter((plugin) => plugin.id !== selfId)
    .map((plugin) => plugin.name);
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
      expect(markdown).toContain("## Footer\n\nFooter text.");
      // The unmarked README also gains the brand-new MORE block at the end.
      expect(markdown.trimEnd().endsWith(MORE_END)).toBe(true);

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
describe("MORE block migration", () => {
  it("appends the author-plugins block at the end of a README that has none (ilife)", () => {
    const { dir, readmePath, cleanup } = setup(fakeReadme(fixtureContactRaw("ilife")));
    try {
      const init = updateReadme({ root: dir, command: "init", selfId: "ilife" });
      expect(init.errors).toEqual([]);
      expect(init.blocks.find((block) => block.name === "more")?.status).toBe("inserted");

      const markdown = readFileSync(readmePath, "utf8");
      expect(markdown.trimEnd().endsWith(MORE_END)).toBe(true);
      const inner = moreInner(markdown);
      expect(inner.startsWith('<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>')).toBe(true);
      expect(inner).toContain("喜欢这个插件的话，这些可能你也用得上：");

      const rows = parseMoreBlock(inner).items.map((item) => item.name);
      expect(rows).toEqual(manifestRowNames("ilife"));
      expect(rows).not.toContain("ilife");
      expect(rows).toHaveLength(4);

      const again = updateReadme({ root: dir, command: "init", selfId: "ilife" });
      expect(again.errors).toEqual([]);
      expect(again.changed).toBe(false);
      const check = updateReadme({ root: dir, command: "sync", check: true, selfId: "ilife" });
      expect(check.errors).toEqual([]);
      expect(check.ok).toBe(true);
      expect(check.written).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("keeps the prompt Markdown heading variant when the contact block stays HTML", () => {
    const readme =
      "# Demo plugin\n\n" + fixtureContactRaw("prompt") + "\n\n" + fixtureMoreRaw("prompt") + "\n";
    const { dir, readmePath, cleanup } = setup(readme);
    try {
      const init = updateReadme({ root: dir, command: "init", selfId: "prompt" });
      expect(init.errors).toEqual([]);
      const markdown = readFileSync(readmePath, "utf8");
      const inner = moreInner(markdown);
      expect(inner.startsWith("## 作者的其他作品 <sub>MORE</sub>")).toBe(true);
      expect(inner).not.toContain("<h2");
      expect(parseMoreBlock(inner).items.map((item) => item.name)).toEqual(manifestRowNames("prompt"));

      const again = updateReadme({ root: dir, command: "init", selfId: "prompt" });
      expect(again.errors).toEqual([]);
      expect(again.changed).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("keeps the historical 'More by the author' wording of the English im README", () => {
    const readme =
      "# Demo plugin\n\n" + fixtureContactRaw("im-en") + "\n\n" + fixtureMoreRaw("im-en") + "\n";
    const { dir, readmePath, cleanup } = setup(readme);
    try {
      const init = updateReadme({ root: dir, command: "init", selfId: "im" });
      expect(init.errors).toEqual([]);
      const inner = moreInner(readFileSync(readmePath, "utf8"));
      expect(inner.startsWith('<h2 align="center"><sub>MORE</sub><br>More by the author</h2>')).toBe(true);
      expect(inner).toContain("** — ");
      expect(inner).not.toContain("file an ISSUE");
      expect(parseMoreBlock(inner).items.map((item) => item.name)).toEqual(manifestRowNames("im"));
    } finally {
      cleanup();
    }
  });

  it("replaces deck-en's third-party row with the final plugin list", () => {
    const readme =
      "# Demo plugin\n\n" + fixtureContactRaw("deck-en") + "\n\n" + fixtureMoreRaw("deck-en") + "\n";
    const { dir, readmePath, cleanup } = setup(readme);
    try {
      const init = updateReadme({ root: dir, command: "init", selfId: "deck" });
      expect(init.errors).toEqual([]);
      const inner = moreInner(readFileSync(readmePath, "utf8"));
      expect(inner).not.toContain("dsh-chinese-skill-patch");
      expect(inner).not.toContain("MIT ©");
      const rows = parseMoreBlock(inner).items.map((item) => item.name);
      expect(rows).toEqual(manifestRowNames("deck"));
      expect(rows).toHaveLength(4);
      expect(rows).toContain("dsh-im-companion");
      expect(rows).toContain("ilife");
    } finally {
      cleanup();
    }
  });

  it("replaces a MORE block that precedes another managed block without swallowing it", () => {
    const readme =
      "# Demo plugin\n\n" + fixtureMoreRaw("palette") + "\n\n" + fixtureContactRaw("palette") + "\n";
    const { dir, readmePath, cleanup } = setup(readme);
    try {
      const init = updateReadme({ root: dir, command: "init", selfId: "palette" });
      expect(init.errors).toEqual([]);
      const markdown = readFileSync(readmePath, "utf8");
      expect(markdown.indexOf(MORE_START)).toBeGreaterThanOrEqual(0);
      expect(markdown.indexOf(MORE_START)).toBeLessThan(markdown.indexOf(START));
      expect(moreInner(markdown)).not.toContain("CONNECT");
      expect(moreInner(markdown)).not.toContain("Feedback and Contact");
      expect(markedInner(markdown)).not.toContain("MORE");

      const sync = updateReadme({ root: dir, command: "sync", selfId: "palette" });
      expect(sync.errors).toEqual([]);
      expect(sync.changed).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("reports unpaired MORE markers and leaves the file untouched", () => {
    const readme = fakeReadme(fixtureContactRaw("deck")) + "\n" + MORE_START + "\n";
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
  it("registers the implemented blocks in visual order and reserves the follow-up markers", () => {
    const byName = new Map(BLOCK_DEFINITIONS.map((definition) => [definition.name, definition]));
    expect([...byName.keys()]).toEqual(["contact", "star-history", "thanks", "more"]);

    const contact = byName.get("contact")!;
    expect(contact.render).toBeTypeOf("function");
    expect(contact.locateLegacy).toBeTypeOf("function");
    expect(contact.markers).toEqual([{ start: START, end: END }]);

    const more = byName.get("more")!;
    expect(more.render).toBeTypeOf("function");
    expect(more.locateLegacy).toBeTypeOf("function");
    expect(more.detect).toBeTypeOf("function");
    expect(more.markers.map((set) => [set.start, set.end])).toEqual([
      ["<!-- MORE-START -->", "<!-- MORE-END -->"],
    ]);
    expect(byName.get("star-history")!.markers.map((set) => [set.start, set.end])).toEqual([
      ["<!-- STAR-HISTORY-START -->", "<!-- STAR-HISTORY-END -->"],
    ]);
    expect(byName.get("thanks")!.markers.map((set) => [set.lang, set.start, set.end])).toEqual([
      ["zh", "<!-- THANKS-TABLE-ZH-START -->", "<!-- THANKS-TABLE-ZH-END -->"],
      ["en", "<!-- THANKS-TABLE-EN-START -->", "<!-- THANKS-TABLE-EN-END -->"],
    ]);
    for (const name of ["star-history", "thanks"] as const) {
      expect(byName.get(name)!.render).toBeUndefined();
    }
  });
});
