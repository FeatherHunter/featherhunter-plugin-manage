import { describe, expect, it } from "vitest";
import { compareBlocks, parseStarHistoryBlock, renderStarHistoryBlock } from "../src/node/index";
import { fixtureStarRaw, starDataOf } from "./readme-helpers";

/**
 * Content differences of the migration: none. The unified renderer reproduces
 * each repository's existing chart shape, including the single theme-neutral
 * image palette and prompt publish (no <picture> pair when both themes would
 * point at the same file).
 */
const INTENTIONAL_DIFFERENCES: Record<string, string[]> = {
  deck: [],
  "deck-pkg": [],
  "deck-en": [],
  im: [],
  "im-en": [],
  palette: [],
  "palette-pkg": [],
  "palette-en": [],
  prompt: [],
  "prompt-en": [],
};

describe("star-history renderer", () => {
  for (const fixtureId of Object.keys(INTENTIONAL_DIFFERENCES)) {
    it("keeps the " + fixtureId + " chart content (only intentional differences)", () => {
      const rendered = renderStarHistoryBlock({ starHistory: starDataOf(fixtureId) });
      const comparison = compareBlocks("star-history", fixtureStarRaw(fixtureId), rendered);
      expect(comparison.contentDifferences.map((difference) => difference.path)).toEqual(
        INTENTIONAL_DIFFERENCES[fixtureId],
      );
      expect(comparison.formatDifferences.length).toBeGreaterThanOrEqual(0);
    });
  }

  it("renders a light/dark picture pair with a minute-level version query string", () => {
    const rendered = renderStarHistoryBlock({
      starHistory: { repo: "FeatherHunter/dsh-prompt", version: "202610310130" },
    });
    const parsed = parseStarHistoryBlock(rendered);
    expect(parsed.variant).toBe("picture");
    expect(parsed.sources.map((source) => source.media)).toEqual(["dark", "light"]);
    for (const source of parsed.sources) {
      expect(source.src.endsWith("?v=202610310130")).toBe(true);
    }
    expect(parsed.image?.asset).toBe("star-history-light.svg");
    expect(parsed.image?.src.endsWith("?v=202610310130")).toBe(true);
  });

  it("keeps deck's standalone chart page link optional", () => {
    const withLink = renderStarHistoryBlock({ starHistory: starDataOf("deck") });
    expect(withLink).toContain(
      '<a href="https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html">',
    );
    const minimal = renderStarHistoryBlock({
      starHistory: { repo: "FeatherHunter/ilife", version: "202610310130" },
    });
    expect(minimal).not.toContain("<a ");
    expect(minimal).not.toContain("<sub>");
    expect(minimal).not.toContain('width="');
  });

  it("keeps im's width and caption note optional", () => {
    const rendered = renderStarHistoryBlock({ starHistory: starDataOf("im") });
    expect(rendered).toContain('<img alt="Star History Chart" width="720"');
    expect(rendered).toContain("<sub>左轴读总星标（Total Stars），右轴读每日新增（Daily New），每天自动更新。</sub>");
    const english = renderStarHistoryBlock({ starHistory: starDataOf("im-en") });
    expect(english).toContain("<sub>Left axis reads Total Stars, right axis reads Daily New. Refreshed every day.</sub>");
  });

  it("rejects missing data and a non-minute-level version", () => {
    expect(() => renderStarHistoryBlock({})).toThrow(/starHistory data/);
    expect(() =>
      renderStarHistoryBlock({ starHistory: { repo: "FeatherHunter/x", version: "20261030" } }),
    ).toThrow(/YYYYMMDDHHmm/);
    expect(() =>
      renderStarHistoryBlock({ starHistory: { repo: "FeatherHunter/x", version: "2026103101300" } }),
    ).toThrow(/YYYYMMDDHHmm/);
    expect(() =>
      renderStarHistoryBlock({ starHistory: { repo: "not-a-repo", version: "202610310130" } }),
    ).toThrow(/owner\/repo/);
  });

  it("accepts a custom branch, chart paths, alt text and width", () => {
    const rendered = renderStarHistoryBlock({
      starHistory: {
        repo: "FeatherHunter/dsh-im-companion",
        version: "202610310130",
        branch: "master",
        darkPath: "docs/charts/dark.svg",
        lightPath: "/docs/charts/light.svg",
        alt: "Chart",
        width: 640,
      },
    });
    expect(rendered).toContain(
      "https://raw.githubusercontent.com/FeatherHunter/dsh-im-companion/master/docs/charts/dark.svg?v=202610310130",
    );
    expect(rendered).toContain(
      "https://raw.githubusercontent.com/FeatherHunter/dsh-im-companion/master/docs/charts/light.svg?v=202610310130",
    );
    expect(rendered).toContain('<img alt="Chart" width="640"');
  });
});
