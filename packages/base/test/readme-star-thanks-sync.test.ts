import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareBlocks,
  parseThanksBlock,
  updateReadme,
} from "../src/node/index";
import {
  fixtureContactRaw,
  fixtureStarRaw,
  fixtureThanksRaw,
  loadThanksData,
  makeTempDir,
  starDataOf,
} from "./readme-helpers";

const STAR_START = "<!-- STAR-HISTORY-START -->";
const STAR_END = "<!-- STAR-HISTORY-END -->";
const THANKS_ZH_START = "<!-- THANKS-TABLE-ZH-START -->";
const THANKS_ZH_END = "<!-- THANKS-TABLE-ZH-END -->";

function setup(readmeText: string): { dir: string; readmePath: string; cleanup: () => void } {
  const { dir, cleanup } = makeTempDir();
  const readmePath = join(dir, "README.md");
  writeFileSync(readmePath, readmeText, "utf8");
  return { dir, readmePath, cleanup };
}

function innerBetween(markdown: string, startMarker: string, endMarker: string): string {
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markdown.slice(start + startMarker.length, end).trim();
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("star-history block migration", () => {
  it("inserts markers around the legacy deck chart and is idempotent", () => {
    const original =
      "# Deck\n\nIntro paragraph.\n\n" +
      fixtureContactRaw("deck") +
      "\n\n" +
      fixtureStarRaw("deck") +
      "\n\n## After\n\nTail.\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const first = updateReadme({ root: dir, command: "init", starHistory: starDataOf("deck"), selfId: "deck" });
      expect(first.errors).toEqual([]);
      expect(first.written).toBe(true);
      const starStatus = first.blocks.find((block) => block.name === "star-history");
      expect(starStatus?.status).toBe("inserted");

      const markdown = read(readmePath);
      const starInner = innerBetween(markdown, STAR_START, STAR_END);
      const comparison = compareBlocks("star-history", fixtureStarRaw("deck"), starInner);
      expect(comparison.contentDifferences).toEqual([]);
      expect(markdown).toContain('<a href="https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html">');
      expect(markdown).toContain("## After\n\nTail.");

      const second = updateReadme({ root: dir, command: "init", starHistory: starDataOf("deck"), selfId: "deck" });
      expect(second.errors).toEqual([]);
      expect(second.changed).toBe(false);
      expect(read(readmePath)).toBe(markdown);

      const check = updateReadme({ root: dir, command: "sync", check: true, starHistory: starDataOf("deck"), selfId: "deck" });
      expect(check.errors).toEqual([]);
      expect(check.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("renders one plain image when both themes share a single chart asset (palette)", () => {
    const original = "# Palette\n\n" + fixtureContactRaw("palette") + "\n\n" + fixtureStarRaw("palette") + "\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const result = updateReadme({ root: dir, command: "init", starHistory: starDataOf("palette"), selfId: "palette" });
      expect(result.errors).toEqual([]);
      const starInner = innerBetween(read(readmePath), STAR_START, STAR_END);
      // Both <source> elements would point at the same file, so the renderer
      // keeps the plain image the repository already published.
      expect(starInner).not.toContain("<picture>");
      expect(starInner).not.toContain("<source ");
      expect(starInner.match(/<img /g)).toHaveLength(1);
      expect(starInner).toContain("docs/star-history.svg?v=202610310130");
      expect(starInner).toContain('alt="星标增长曲线：左轴累计星标、右轴每日新增"');
    } finally {
      cleanup();
    }
  });

  it("appends a star-history block at EOF for a repository that has none (ilife)", () => {
    const original = "# 爱生活（iLife）\n\n" + fixtureContactRaw("ilife") + "\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const result = updateReadme({ root: dir, command: "init", starHistory: starDataOf("ilife"), selfId: "ilife" });
      expect(result.errors).toEqual([]);
      expect(result.blocks.filter((block) => block.name === "star-history")[0]?.status).toBe("inserted");
      const markdown = read(readmePath);
      const starInner = innerBetween(markdown, STAR_START, STAR_END);
      expect(starInner).toContain("  <picture>");
      expect(starInner).toContain('media="(prefers-color-scheme: dark)"');
      expect(starInner).toContain('media="(prefers-color-scheme: light)"');
      expect(starInner).not.toContain("<a ");
      expect(markdown.indexOf(STAR_START)).toBeGreaterThan(markdown.indexOf("## 反馈与联系"));
    } finally {
      cleanup();
    }
  });
});

describe("thanks block migration", () => {
  it("rewrites only the table between the existing markers", () => {
    const original =
      "# Demo plugin\n\n" + fixtureContactRaw("deck") + "\n\n" + fixtureThanksRaw("deck") + "\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const result = updateReadme({ root: dir, command: "init", thanks: loadThanksData("deck") });
      expect(result.errors).toEqual([]);
      expect(result.written).toBe(true);

      const markdown = read(readmePath);
      expect(markdown).toContain('<h2 align="center"><sub>THANKS</sub><br>致谢</h2>');
      expect(markdown).toContain("感谢每一位提交 Issue、PR 与参与讨论的朋友，是你们让这个插件一点点变好。");
      expect(markdown).toContain(
        "也感谢在评论区与讨论区留下想法的每一位朋友。如果你也遇到了问题或有新想法，欢迎直接提 Issue 或发起讨论。",
      );

      const table = innerBetween(markdown, THANKS_ZH_START, THANKS_ZH_END);
      const actual = parseThanksBlock(table);
      const expected = parseThanksBlock(fixtureThanksRaw("deck"));
      expect(actual.headers).toEqual(expected.headers);
      expect(actual.rows).toEqual(expected.rows);

      const second = updateReadme({ root: dir, command: "sync", thanks: loadThanksData("deck") });
      expect(second.errors).toEqual([]);
      expect(second.changed).toBe(false);
      expect(read(readmePath)).toBe(markdown);
    } finally {
      cleanup();
    }
  });

  it("updates the English pair and skips the missing Chinese pair on an English page", () => {
    const original =
      "# Demo plugin\n\n" + fixtureContactRaw("deck-en") + "\n\n" + fixtureThanksRaw("deck-en") + "\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const result = updateReadme({ root: dir, command: "init", thanks: loadThanksData("deck") });
      expect(result.errors).toEqual([]);
      const thanksStatuses = result.blocks
        .filter((block) => block.name === "thanks")
        .map((block) => block.status);
      expect(thanksStatuses).toEqual(["skipped", "unchanged"]);
      const markdown = read(readmePath);
      expect(markdown).toContain("<!-- THANKS-TABLE-EN-START -->");
      expect(markdown).not.toContain("<!-- THANKS-TABLE-ZH-START -->");
    } finally {
      cleanup();
    }
  });

  it("reports drift in check mode without writing", () => {
    const original =
      "# Demo plugin\n\n" + fixtureContactRaw("deck") + "\n\n" + fixtureThanksRaw("deck") + "\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const init = updateReadme({ root: dir, command: "init", thanks: loadThanksData("deck") });
      expect(init.errors).toEqual([]);
      const markdown = read(readmePath);
      const tampered = markdown.replace(
        /^\| \[@[^\n]+$/m,
        "| [@tampered](https://github.com/tampered) | 🌹 | [#1](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1) |",
      );
      writeFileSync(readmePath, tampered, "utf8");
      const checked = updateReadme({ root: dir, command: "sync", check: true, thanks: loadThanksData("deck") });
      expect(checked.ok).toBe(false);
      expect(checked.written).toBe(false);
      expect(checked.errors.join("\n")).toMatch(/out of date/);
      expect(read(readmePath)).toBe(tampered);
    } finally {
      cleanup();
    }
  });

  it("needs markers in sync mode and leaves the README untouched", () => {
    const original = "# Demo plugin\n\n" + fixtureContactRaw("deck") + "\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const init = updateReadme({ root: dir, command: "init" });
      expect(init.errors).toEqual([]);
      const marked = read(readmePath);
      const sync = updateReadme({ root: dir, command: "sync", thanks: loadThanksData("deck") });
      expect(sync.ok).toBe(false);
      expect(sync.written).toBe(false);
      expect(sync.errors.join("\n")).toMatch(/thanks markers are missing; run readme:init first/);
      expect(read(readmePath)).toBe(marked);
    } finally {
      cleanup();
    }
  });

  it("skips both blocks when their data is absent", () => {
    const original = "# Demo plugin\n\n" + fixtureContactRaw("deck") + "\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const result = updateReadme({ root: dir, command: "init" });
      expect(result.errors).toEqual([]);
      const starStatuses = result.blocks.filter((block) => block.name === "star-history");
      const thanksStatuses = result.blocks.filter((block) => block.name === "thanks");
      expect(starStatuses.map((block) => block.status)).toEqual(["skipped"]);
      expect(thanksStatuses.map((block) => block.status)).toEqual(["skipped"]);
      const markdown = read(readmePath);
      expect(markdown).not.toContain(STAR_START);
      expect(markdown).not.toContain(THANKS_ZH_START);
    } finally {
      cleanup();
    }
  });

  it("refuses to touch a README with merge-conflict residue (im)", () => {
    const original =
      "# dsh-im-companion\n\n" + fixtureContactRaw("im") + "\n\n" + fixtureStarRaw("im") + "\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const result = updateReadme({ root: dir, command: "init", starHistory: starDataOf("im") });
      expect(result.ok).toBe(false);
      expect(result.written).toBe(false);
      expect(result.errors.join("\n")).toMatch(/suspicious merge-conflict residue/);
      expect(read(readmePath)).toBe(original);
    } finally {
      cleanup();
    }
  });

  it("migrates a deck-shaped README end to end", () => {
    const original =
      "# Deck\n\nIntro.\n\n" +
      fixtureThanksRaw("deck") +
      "\n\n" +
      fixtureContactRaw("deck") +
      "\n\n" +
      fixtureStarRaw("deck") +
      "\n\n## Tail\n\nBye.\n";
    const { dir, readmePath, cleanup } = setup(original);
    try {
      const options = {
        root: dir,
        command: "init" as const,
        selfId: "deck",
        starHistory: starDataOf("deck"),
        thanks: loadThanksData("deck"),
      };
      const first = updateReadme(options);
      expect(first.errors).toEqual([]);
      expect(first.ok).toBe(true);
      const markdown = read(readmePath);
      expect(markdown).toContain(STAR_START);
      expect(markdown).toContain("<!-- MORE-START -->");
      const starInner = innerBetween(markdown, STAR_START, STAR_END);
      expect(compareBlocks("star-history", fixtureStarRaw("deck"), starInner).contentDifferences).toEqual([]);

      const second = updateReadme(options);
      expect(second.errors).toEqual([]);
      expect(second.changed).toBe(false);
      expect(read(readmePath)).toBe(markdown);

      const check = updateReadme({ ...options, command: "sync", check: true });
      expect(check.errors).toEqual([]);
      expect(check.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});
