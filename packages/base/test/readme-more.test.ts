import { describe, expect, it } from "vitest";
import { BASELINE, sortByOrder } from "../src/core/index";
import type { Lang, Manifest } from "../src/core/types";
import { compareBlocks, parseMoreBlock, renderMoreBlock } from "../src/node/index";
import { fixtureFile, fixtureMoreRaw } from "./readme-helpers";

/** Canonical plugin rows, straight from the packaged manifest. */
const MANIFEST_ROWS = sortByOrder(BASELINE.manifest.plugins);

function canonicalRows(selfId: string | undefined, lang: Lang): Array<{ name: string; url: string; description: string }> {
  return MANIFEST_ROWS.filter((plugin) => plugin.id !== selfId).map((plugin) => ({
    name: plugin.name,
    url: "https://github.com/" + plugin.repo,
    description: plugin.desc[lang],
  }));
}

/** Render one fixture README's MORE block with the historical conventions preserved. */
function renderForFixture(id: string): string {
  const file = fixtureFile(id);
  const variant = file.blocks.more.raw !== null && /<h2\b/i.test(file.blocks.more.raw) ? "html-heading" : "markdown-heading";
  return renderMoreBlock({
    lang: file.lang,
    selfId: selfIdForFixture(id),
    variant,
    headingText: id === "im-en" ? "More by the author" : undefined,
  });
}

const SELF_BY_FIXTURE: Record<string, string> = {
  deck: "deck",
  "deck-pkg": "deck",
  "deck-en": "deck",
  palette: "palette",
  "palette-pkg": "palette",
  "palette-en": "palette",
  im: "im",
  "im-en": "im",
  prompt: "prompt",
  "prompt-en": "prompt",
};

function selfIdForFixture(id: string): string {
  return SELF_BY_FIXTURE[id]!;
}

describe("renderMoreBlock", () => {
  it("renders the standard zh MORE block from the manifest", () => {
    const rendered = renderMoreBlock({ selfId: "deck" });
    const expected = [
      '<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>',
      "",
      '<div align="left">',
      "",
      "喜欢这个插件的话，这些可能你也用得上：",
      "",
      "**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** —— 经常反复重复的模板化提示词，存成自定义模板，选中后直接注入，不再需要耗费精力。",
      "",
      "**[dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette)** —— 38 款 opencode 经典配色 + 20+自定义主题 一键换装 DSH。",
      "",
      "**[dsh-im-companion](https://github.com/FeatherHunter/dsh-im-companion)** —— 给 dsh-im 加了「助理」和「家」的概念。",
      "",
      "**[ilife](https://github.com/FeatherHunter/ilife)** —— ⚠️建设中⚠️爱生活：居家生活套件，记账、运动、饮食、体重、食谱、物品管理、作息规划、备忘录等。",
      "",
      "</div>",
    ].join("\n");
    expect(rendered).toBe(expected);
  });

  it("excludes the rendering repository and keeps the fixed plugin order", () => {
    for (const [id, selfId] of Object.entries(SELF_BY_FIXTURE)) {
      const file = fixtureFile(id);
      const rows = parseMoreBlock(renderForFixture(id)).items;
      expect(rows.map((row) => row.name), id).toEqual(
        canonicalRows(selfId, file.lang).map((row) => row.name),
      );
      expect(rows.some((row) => row.name === SELF_BY_FIXTURE[id] && row.name === id), id).toBe(false);
    }
  });

  it("keeps the prompt Markdown heading variant and is content-equivalent to its fixture", () => {
    const rendered = renderMoreBlock({ selfId: "prompt", variant: "markdown-heading" });
    expect(rendered.startsWith("## 作者的其他作品 <sub>MORE</sub>")).toBe(true);
    expect(rendered).not.toContain("<h2");
    const comparison = compareBlocks("more", fixtureMoreRaw("prompt"), rendered);
    expect(comparison.contentDifferences).toEqual([]);
    expect(comparison.equivalent).toBe(true);
  });

  it("keeps both historical English heading wordings", () => {
    const standard = renderMoreBlock({ lang: "en", selfId: "deck" });
    expect(standard).toContain('<h2 align="center"><sub>MORE</sub><br>More from the author</h2>');
    const historical = renderMoreBlock({ lang: "en", selfId: "im", headingText: "More by the author" });
    expect(historical).toContain('<h2 align="center"><sub>MORE</sub><br>More by the author</h2>');
    expect(historical).toContain("** — ");
    expect(historical).toContain(
      "**[dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette)** — 38 classic opencode themes + 20+ custom themes — reskin DSH in one click.",
    );
  });

  it("drops deck's sixth English plugin row that is not in the final plugin list", () => {
    const comparison = compareBlocks("more", fixtureMoreRaw("deck-en"), renderForFixture("deck-en"));
    expect(comparison.equivalent).toBe(false);
    const members = comparison.contentDifferences[0]!;
    expect(members.path).toBe("more.items");
    expect(members.expected).toContain("dsh-chinese-skill-patch");
    expect(members.actual).toEqual(canonicalRows("deck", "en").map((row) => row.name));
    const rendered = parseMoreBlock(renderForFixture("deck-en"));
    expect(rendered.items.map((item) => item.name)).toEqual(canonicalRows("deck", "en").map((row) => row.name));
    expect(rendered.items).toHaveLength(4);
    expect(JSON.stringify(rendered)).not.toContain("dsh-chinese-skill-patch");
  });

  it("renders every fixture README with only the documented intentional differences", () => {
    const expectedPaths: Record<string, string[]> = {
      deck: ["more.items"],
      "deck-pkg": ["more.items"],
      "deck-en": [
        "more.items",
        "more.items[0].name",
        "more.items[0].url",
        "more.items[0].description",
        "more.items[1].name",
        "more.items[1].url",
        "more.items[1].description",
        "more.items[2].name",
        "more.items[2].url",
        "more.items[2].description",
        "more.items[3]",
      ],
      palette: ["more.items"],
      "palette-pkg": ["more.items"],
      "palette-en": ["more.items"],
      im: ["more.items"],
      "im-en": ["more.items"],
      prompt: [],
      "prompt-en": [
        "more.items[0].description",
        "more.items[1].description",
        "more.items[2].description",
        "more.items[3].description",
      ],
    };
    for (const [id, paths] of Object.entries(expectedPaths)) {
      const comparison = compareBlocks("more", fixtureMoreRaw(id), renderForFixture(id));
      expect(comparison.contentDifferences.map((difference) => difference.path), id).toEqual(paths);
    }
  });

  it("rejects a manifest without author plugins or with only the rendering plugin", () => {
    const empty: Manifest = { ...structuredClone(BASELINE.manifest), plugins: [] };
    expect(() => renderMoreBlock({ manifest: empty })).toThrow(/at least one plugin/);
    const single: Manifest = { ...structuredClone(BASELINE.manifest), plugins: [BASELINE.manifest.plugins[0]!] };
    expect(() => renderMoreBlock({ manifest: single, selfId: "deck" })).toThrow(/besides/);
  });
});
