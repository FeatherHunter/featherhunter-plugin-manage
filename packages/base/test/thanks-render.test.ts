import { describe, expect, it } from "vitest";
import {
  isSkippedThanksLogin,
  parseThanksBlock,
  renderThanksBlock,
  rosesFor,
  thanksLinks,
  thanksRow,
  thanksTotal,
} from "../src/node/index";
import type { ThanksAuthor } from "../src/node/index";
import {
  fixtureDoc,
  fixtureFile,
  fixtureThanksRaw,
  loadThanksData,
  thanksDatasetOf,
} from "./readme-helpers";

/** Rows observed in the pre-migration README tables (numbers are the reference). */
const LEGACY_ROW_COUNTS: Record<string, number> = {
  deck: 47,
  "deck-pkg": 47,
  "deck-en": 47,
  palette: 9,
  "palette-pkg": 9,
  "palette-en": 9,
  im: 3,
  "im-en": 3,
  prompt: 5,
  "prompt-en": 5,
  ilife: 0,
};

function parsedTable(raw: string): { headers: string[]; rows: unknown } {
  const parsed = parseThanksBlock(raw);
  return { headers: parsed.headers, rows: parsed.rows };
}

describe("thanks renderer", () => {
  for (const file of fixtureDoc().files) {
    it("reproduces the " + file.id + " table from its docs/thanks-data.json", () => {
      const thanks = loadThanksData(thanksDatasetOf(file.id));
      const rendered = renderThanksBlock({ thanks, lang: file.lang });
      const actual = parseThanksBlock(rendered);
      const expected = parseThanksBlock(fixtureThanksRaw(file.id));
      expect(actual.headers).toEqual(expected.headers);
      expect(actual.rows).toEqual(expected.rows);
      expect(actual.rows.length).toBe(LEGACY_ROW_COUNTS[file.id]);
    });
  }

  it("renders an empty table as header + separator only (ilife rule)", () => {
    const rendered = renderThanksBlock({ thanks: { repo: "FeatherHunter/ilife", authors: {} } });
    expect(rendered).toBe("| 贡献者 | 致敬 | 贡献 |\n| --- | --- | --- |");
    const english = renderThanksBlock({ thanks: { repo: "FeatherHunter/ilife", authors: {} }, lang: "en" });
    expect(english).toBe("| Contributor | Tribute | Contributions |\n| --- | --- | --- |");
  });

  it("counts roses by greedy tiers", () => {
    expect(rosesFor(0)).toBe("");
    expect(rosesFor(1)).toBe("🌹");
    expect(rosesFor(10)).toBe("💐");
    expect(rosesFor(11)).toBe("💐🌹");
    expect(rosesFor(123)).toBe("🏆💐💐🌹🌹🌹");
    expect(rosesFor(10000)).toBe("💎");
  });

  it("skips maintainers, bots and anonymous authors", () => {
    expect(isSkippedThanksLogin("FeatherHunter", "FeatherHunter")).toBe(true);
    expect(isSkippedThanksLogin("ghost", "FeatherHunter")).toBe(true);
    expect(isSkippedThanksLogin("dependabot", "FeatherHunter")).toBe(true);
    expect(isSkippedThanksLogin("renovate[bot]", "FeatherHunter")).toBe(true);
    expect(isSkippedThanksLogin("somebody", "FeatherHunter")).toBe(false);
    const rendered = renderThanksBlock({
      thanks: {
        repo: "FeatherHunter/x",
        authors: {
          FeatherHunter: { issues: [{ n: 1 }] },
          ghost: { issues: [{ n: 2 }] },
          somebody: { prs: [{ n: 3 }] },
        },
      },
    });
    expect(rendered).not.toContain("FeatherHunter)");
    expect(rendered).not.toContain("ghost");
    expect(rendered).toContain("| [@somebody](https://github.com/somebody) | 🌹 | [#3](https://github.com/FeatherHunter/x/pull/3) |");
  });

  it("orders authors by activity count, then recency, then login", () => {
    const authors: Record<string, ThanksAuthor> = {
      busy: { issues: [{ n: 1 }, { n: 2 }], lastActive: "2026-01-01T00:00:00Z" },
      recent: { issues: [{ n: 3 }], lastActive: "2026-10-01T00:00:00Z" },
      older: { issues: [{ n: 4 }], lastActive: "2026-02-01T00:00:00Z" },
      alpha: { issues: [{ n: 5 }], lastActive: "2026-02-01T00:00:00Z" },
    };
    const rows = parseThanksBlock(renderThanksBlock({ thanks: { repo: "FeatherHunter/x", authors } })).rows;
    const logins = rows.map((row) => row.cells[0]?.links[0]?.replace("https://github.com/", ""));
    expect(logins).toEqual(["busy", "recent", "alpha", "older"]);
  });

  it("merges comments into the issue/PR segments and sorts each segment", () => {
    const author: ThanksAuthor = {
      issues: [{ n: 1481 }],
      prs: [{ n: 273 }],
      discussions: [{ n: 435 }],
      comments: [
        { n: 1375, thread: "issue" },
        { n: 1400, thread: "pr" },
      ],
    };
    expect(thanksLinks(author, "FeatherHunter/x")).toEqual([
      "[#1375](https://github.com/FeatherHunter/x/issues/1375)",
      "[#1481](https://github.com/FeatherHunter/x/issues/1481)",
      "[#273](https://github.com/FeatherHunter/x/pull/273)",
      "[#1400](https://github.com/FeatherHunter/x/pull/1400)",
      "[#435](https://github.com/FeatherHunter/x/discussions/435)",
    ]);
    expect(thanksTotal(author)).toBe(5);
    const row = thanksRow("someone", author, "FeatherHunter/x");
    expect(row.startsWith("| [@someone](https://github.com/someone) | 🌹🌹🌹🌹🌹 | ")).toBe(true);
  });

  it("needs author records", () => {
    expect(() => renderThanksBlock({})).toThrow(/thanks data/);
    expect(() => renderThanksBlock({ thanks: { repo: "bad-repo", authors: {} } })).toThrow(/owner\/repo/);
  });
});
