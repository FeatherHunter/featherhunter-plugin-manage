import { describe, expect, it } from "vitest";
import {
  locateReadmeBlocks,
  type LocatedBlocks,
  type ReadmeBlockKind,
  type SuspiciousLine,
} from "../src/node/readme-compare";
import fixtureData from "./fixtures/readme-blocks.json";

/**
 * Synthetic README that mirrors the structural variety found in the five
 * plugin repos (HTML h2 blocks, markdown headings, thanks markers, star image
 * wrapped in a centered div). Tests never read the external repositories.
 */
const SAMPLE_README = `# Plugin

## Features

Some features.

<h2 align="center"><sub>THANKS</sub><br>致谢</h2>

<div align="left">

感谢每一位提交 Issue 的朋友。

<!-- THANKS-TABLE-ZH-START -->
| 贡献者 | 致敬 | 贡献 |
| --- | --- | --- |
| [@alice](https://github.com/alice) | 🌹🌹 | [#1](https://github.com/owner/repo/issues/1) |
<!-- THANKS-TABLE-ZH-END -->

</div>

<h2 align="center"><sub>CONNECT</sub><br>反馈与联系</h2>

<div align="center">

欢迎进群交流。

<table align="center"><tr><td align="center"><b>飞书群（主）</b></td></tr><tr><td><img src="assets/contact-feishu-permanent.png" width="260" alt="飞书群二维码" /></td></tr></table>

</div>

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://example.com/star-history-dark.svg?v=20261030" />
  <img alt="Star History Chart" src="https://example.com/star-history-light.svg?v=20261030" />
</picture>

</div>

<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>

<div align="left">

**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** —— 模板化提示词。

</div>
`;

describe("locateReadmeBlocks", () => {
  it("finds all four blocks and reports their order", () => {
    const located = locateReadmeBlocks(SAMPLE_README);
    expect(located.order).toEqual(["thanks", "contact", "star-history", "more"]);
    expect(located.blocks.thanks).toBeTruthy();
    expect(located.blocks.contact).toBeTruthy();
    expect(located.blocks["star-history"]).toBeTruthy();
    expect(located.blocks.more).toBeTruthy();
  });

  it("keeps each block separate and drops surrounding prose", () => {
    const located = locateReadmeBlocks(SAMPLE_README);
    expect(located.blocks.thanks).toContain("THANKS-TABLE-ZH-START");
    expect(located.blocks.thanks).not.toContain("CONNECT");
    expect(located.blocks.contact).toContain("contact-feishu-permanent.png");
    expect(located.blocks.contact).not.toContain("<picture>");
    expect(located.blocks["star-history"]).toContain("<picture>");
    expect(located.blocks["star-history"]).not.toContain("MORE");
    expect(located.blocks.more).toContain("dsh-prompt");
    expect(located.blocks.more).not.toContain("## Features");
  });

  it("understands markdown heading variants", () => {
    const markdown = `# Plugin

## 致谢

感谢。

<!-- THANKS-TABLE-ZH-START -->
| 贡献者 | 致敬 | 贡献 |
| --- | --- | --- |
<!-- THANKS-TABLE-ZH-END -->

## 反馈与联系

<div align="center">

<table align="center"><tr><td align="center"><b>飞书群（主）</b></td></tr><tr><td><img src="assets/contact-feishu-permanent.png" width="260" alt="飞书群二维码" /></td></tr></table>

</div>
`;
    const located = locateReadmeBlocks(markdown);
    expect(located.blocks.contact).toContain("## 反馈与联系");
    expect(located.blocks.thanks).toContain("## 致谢");
    expect(located.blocks["star-history"]).toBeNull();
    expect(located.blocks.more).toBeNull();
  });
});

import { parseContactBlock } from "../src/node/readme-compare";

const HTML_CONTACT = `<h2 align="center"><sub>CONNECT</sub><br>反馈与联系</h2>

<div align="center">

👏欢迎提交PR、ISSUE。星星之火可以燎原🔥有任何建议、意见、想法、吐槽、idea都可以进群交流。

<table align="center"><tr><td align="center"><b>飞书群（主）</b></td><td align="center"><b>QQ群（新）</b></td><td align="center"><b>微信群（新）</b></td></tr><tr><td><img src="assets/contact-feishu-permanent.png" width="260" alt="DSH 插件交流群 飞书群二维码" /></td><td><img src="assets/contact-qq-permanent.png" width="260" alt="DSH 插件交流群 QQ 群二维码" /></td><td><img src="assets/contact-wechat-weekly.png" width="260" alt="DSH 插件交流群微信群二维码" /></td></tr></table>

</div>`;

const MARKDOWN_CONTACT = `## 反馈与联系

<div align="center">

👏欢迎提交PR、ISSUE。星星之火可以燎原🔥有任何建议、意见、想法、吐槽、idea都可以进群交流。

<table align="center"><tr><td align="center"><b>飞书群（主）</b></td><td align="center"><b>QQ群（新）</b></td><td align="center"><b>微信群（新）</b></td></tr><tr><td><img src="../../assets/contact-feishu-permanent.png" width="260" alt="DSH 插件交流群 飞书群二维码" /></td><td><img src="../../assets/contact-qq-permanent.jpg" width="260" alt="DSH 插件交流群 QQ 群二维码" /></td><td><img src="../../assets/contact-wechat-weekly.png" width="260" alt="DSH 插件交流群微信群二维码" /></td></tr></table>

</div>`;

describe("parseContactBlock", () => {
  it("parses the standard HTML heading variant", () => {
    const parsed = parseContactBlock(HTML_CONTACT);
    expect(parsed.variant).toBe("html-heading");
    expect(parsed.heading).toEqual({ sub: "CONNECT", text: "反馈与联系" });
    expect(parsed.welcome).toContain("星星之火可以燎原");
    expect(parsed.groups).toHaveLength(3);
    expect(parsed.groups[0]).toEqual({
      title: "飞书群（主）",
      src: "assets/contact-feishu-permanent.png",
      asset: "contact-feishu-permanent.png",
      width: 260,
      alt: "DSH 插件交流群 飞书群二维码",
    });
    expect(parsed.groups.map((group) => group.asset)).toEqual([
      "contact-feishu-permanent.png",
      "contact-qq-permanent.png",
      "contact-wechat-weekly.png",
    ]);
  });

  it("parses the markdown heading variant used by ilife", () => {
    const parsed = parseContactBlock(MARKDOWN_CONTACT);
    expect(parsed.variant).toBe("markdown-heading");
    expect(parsed.heading).toEqual({ sub: null, text: "反馈与联系" });
    expect(parsed.groups).toHaveLength(3);
    expect(parsed.groups.map((group) => group.asset)).toEqual([
      "contact-feishu-permanent.png",
      "contact-qq-permanent.jpg",
      "contact-wechat-weekly.png",
    ]);
    expect(parsed.groups.every((group) => group.width === 260)).toBe(true);
  });
});

import { parseStarHistoryBlock } from "../src/node/readme-compare";

const STARS_PICTURE_LINKED = `<div align="center">

<a href="https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-dark.svg?v=20261030" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20261030" />
    <img alt="Star History Chart" src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20261030" />
  </picture>
</a>

</div>`;

const STARS_PICTURE_CAPTION = `<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-im-companion/master/docs/star-history-dark.svg?v=20261024" />
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-im-companion/master/docs/star-history-light.svg?v=20261024" />
  <img alt="Star History Chart" width="720" src="https://raw.githubusercontent.com/FeatherHunter/dsh-im-companion/master/docs/star-history-light.svg?v=20261024" />
</picture>

<sub>左轴读总星标（Total Stars），右轴读每日新增（Daily New），每天自动更新。</sub>

</div>`;

const STARS_MARKDOWN = `<div align="center">

![星标增长曲线：左轴累计星标、右轴每日新增](https://raw.githubusercontent.com/FeatherHunter/dsh-opencode-palette/main/docs/star-history.svg?v=202610232036)

</div>`;

describe("parseStarHistoryBlock", () => {
  it("parses the linked picture variant and keeps the external link target", () => {
    const parsed = parseStarHistoryBlock(STARS_PICTURE_LINKED);
    expect(parsed.variant).toBe("picture-link");
    expect(parsed.link).toBe("https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html");
    expect(parsed.sources).toEqual([
      { media: "dark", src: "https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-dark.svg?v=20261030", asset: "star-history-dark.svg" },
      { media: "light", src: "https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20261030", asset: "star-history-light.svg" },
    ]);
    expect(parsed.image).toEqual({
      alt: "Star History Chart",
      src: "https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20261030",
      asset: "star-history-light.svg",
      width: null,
    });
    expect(parsed.caption).toBeNull();
  });

  it("parses the picture variant with width and caption", () => {
    const parsed = parseStarHistoryBlock(STARS_PICTURE_CAPTION);
    expect(parsed.variant).toBe("picture");
    expect(parsed.link).toBeNull();
    expect(parsed.image?.width).toBe(720);
    expect(parsed.image?.asset).toBe("star-history-light.svg");
    expect(parsed.caption).toContain("左轴读总星标");
    expect(parsed.sources.map((source) => source.media)).toEqual(["dark", "light"]);
  });

  it("parses the single markdown image variant", () => {
    const parsed = parseStarHistoryBlock(STARS_MARKDOWN);
    expect(parsed.variant).toBe("markdown-image");
    expect(parsed.link).toBeNull();
    expect(parsed.sources).toEqual([]);
    expect(parsed.image).toEqual({
      alt: "星标增长曲线：左轴累计星标、右轴每日新增",
      src: "https://raw.githubusercontent.com/FeatherHunter/dsh-opencode-palette/main/docs/star-history.svg?v=202610232036",
      asset: "star-history.svg",
      width: null,
    });
    expect(parsed.caption).toBeNull();
  });
});

import { parseMoreBlock, parseThanksBlock } from "../src/node/readme-compare";

const THANKS_HTML_ZH = `<h2 align="center"><sub>THANKS</sub><br>致谢</h2>

<div align="left">

感谢每一位提交 Issue 的朋友。

<!-- THANKS-TABLE-ZH-START -->
| 贡献者 | 致敬 | 贡献 |
| --- | --- | --- |
| [@alice](https://github.com/alice) | 🌹🌹 | [#1](https://github.com/owner/repo/issues/1) [#2](https://github.com/owner/repo/pull/2) |
<!-- THANKS-TABLE-ZH-END -->

</div>`;

const THANKS_MARKDOWN_EMPTY = `## 致谢

感谢每一位提交 Issue、PR 与参与讨论的朋友，是你们让这个插件一点点变好。

<!-- THANKS-TABLE-ZH-START -->
| 贡献者 | 致敬 | 贡献 |
| --- | --- | --- |
<!-- THANKS-TABLE-ZH-END -->

也感谢在评论区与讨论区留下想法的每一位朋友。

<!-- 英文表预留 -->

## 反馈与联系`;

const THANKS_HTML_EN = `<h2 align="center"><sub>THANKS</sub><br>Contributors</h2>

<!-- THANKS-TABLE-EN-START -->
| Contributor | Tribute | Contributions |
| --- | --- | --- |
| [@alice](https://github.com/alice) | 🌹 | [#1](https://github.com/owner/repo/issues/1) |
<!-- THANKS-TABLE-EN-END -->`;

describe("parseThanksBlock", () => {
  it("parses the HTML heading variant with marker language and table data", () => {
    const parsed = parseThanksBlock(THANKS_HTML_ZH);
    expect(parsed.variant).toBe("html-heading");
    expect(parsed.heading).toEqual({ sub: "THANKS", text: "致谢" });
    expect(parsed.lang).toBe("zh");
    expect(parsed.headers).toEqual(["贡献者", "致敬", "贡献"]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.cells).toEqual([
      { text: "@alice", links: ["https://github.com/alice"] },
      { text: "🌹🌹", links: [] },
      { text: "#1 #2", links: ["https://github.com/owner/repo/issues/1", "https://github.com/owner/repo/pull/2"] },
    ]);
    expect(parsed.prose).toContain("感谢每一位提交 Issue 的朋友");
  });

  it("parses the markdown heading variant and tolerates an empty table", () => {
    const parsed = parseThanksBlock(THANKS_MARKDOWN_EMPTY);
    expect(parsed.variant).toBe("markdown-heading");
    expect(parsed.heading).toEqual({ sub: null, text: "致谢" });
    expect(parsed.headers).toEqual(["贡献者", "致敬", "贡献"]);
    expect(parsed.rows).toEqual([]);
  });

  it("parses the English table markers", () => {
    const parsed = parseThanksBlock(THANKS_HTML_EN);
    expect(parsed.lang).toBe("en");
    expect(parsed.headers).toEqual(["Contributor", "Tribute", "Contributions"]);
    expect(parsed.rows).toHaveLength(1);
  });
});

const MORE_HTML_ZH = `<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>

<div align="left">

**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** —— 模板化提示词。

**[dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette)** —— 38 款经典配色。

</div>`;

const MORE_MARKDOWN_ZH = `<div align="center">

## 作者的其他作品 <sub>MORE</sub>

</div>

<div align="left">

**[dsh-mattpocock-skills-deck](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck)** —— 27 个技能。

**[dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette)** —— 38 款经典配色。

**[dsh-im-companion](https://github.com/FeatherHunter/dsh-im-companion)** —— 「助理」和「家」。

**[ilife](https://github.com/FeatherHunter/ilife)** —— 爱生活套件。

</div>`;

const MORE_HTML_EN_FOOTER = `<h2 align="center"><sub>MORE</sub><br>More from the author</h2>

<div align="center">

If you like this plugin, these might help too:

**[dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette)** — 34 classic themes

**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** — A prompt toolbox

---

Questions or ideas? [Open an issue](https://github.com/FeatherHunter/dsh-opencode-palette/issues)

A personal project, not affiliated with anyone.
MIT © FeatherHunter

</div>`;

describe("parseMoreBlock", () => {
  it("parses HTML heading rows in order", () => {
    const parsed = parseMoreBlock(MORE_HTML_ZH);
    expect(parsed.variant).toBe("html-heading");
    expect(parsed.heading).toEqual({ sub: "MORE", text: "作者的其他作品" });
    expect(parsed.items).toEqual([
      { name: "dsh-prompt", url: "https://github.com/FeatherHunter/dsh-prompt", description: "模板化提示词。" },
      { name: "dsh-opencode-palette", url: "https://github.com/FeatherHunter/dsh-opencode-palette", description: "38 款经典配色。" },
    ]);
  });

  it("parses the markdown heading variant used by prompt", () => {
    const parsed = parseMoreBlock(MORE_MARKDOWN_ZH);
    expect(parsed.variant).toBe("markdown-heading");
    expect(parsed.heading).toEqual({ sub: "MORE", text: "作者的其他作品" });
    expect(parsed.items.map((item) => item.name)).toEqual([
      "dsh-mattpocock-skills-deck",
      "dsh-opencode-palette",
      "dsh-im-companion",
      "ilife",
    ]);
  });

  it("keeps intro and footer prose separate from the rows", () => {
    const parsed = parseMoreBlock(MORE_HTML_EN_FOOTER);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.intro).toContain("If you like this plugin");
    expect(parsed.footer).toContain("Open an issue");
    expect(parsed.footer).toContain("MIT © FeatherHunter");
  });
});

import {
  canonicalizeMarkup,
  compareBlocks,
  compareReadmeBlocks,
  findSuspiciousLines,
} from "../src/node/readme-compare";

describe("findSuspiciousLines", () => {
  it("flags the merge-conflict residue found in the im README", () => {
    const markdown = ["# R", "", "<div align=\"center\">", "", "</div>>>>>>>> origin/master"].join("\n");
    expect(findSuspiciousLines(markdown)).toEqual([
      { line: 5, text: "</div>>>>>>>> origin/master", reason: "merge-conflict-residue" },
    ]);
  });

  it("flags classic conflict markers", () => {
    const markdown = ["<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> origin/master"].join("\n");
    expect(findSuspiciousLines(markdown).map((entry) => [entry.line, entry.reason])).toEqual([
      [1, "conflict-start"],
      [3, "conflict-separator"],
      [5, "conflict-end"],
    ]);
  });

  it("leaves clean READMEs alone and exposes residue through locateReadmeBlocks", () => {
    expect(findSuspiciousLines(SAMPLE_README)).toEqual([]);
    const located = locateReadmeBlocks(`${SAMPLE_README}\n\n</div>>>>>>>> origin/master\n`);
    expect(located.suspicious).toHaveLength(1);
    expect(located.suspicious[0]!.reason).toBe("merge-conflict-residue");
  });
});

describe("canonicalizeMarkup", () => {
  it("normalizes whitespace, quote style, attribute order and self-closing style", () => {
    const formatted = `<img
  src='assets/contact-feishu-permanent.png'
  width='260'
  alt='飞书群二维码' />`;
    const canonical = `<img alt="飞书群二维码" src="assets/contact-feishu-permanent.png" width="260">`;
    expect(canonicalizeMarkup(formatted)).toBe(canonicalizeMarkup(canonical));
  });

  it("still distinguishes content changes", () => {
    expect(canonicalizeMarkup(`<img src="a.png" alt="A">`)).not.toBe(
      canonicalizeMarkup(`<img src="b.png" alt="A">`),
    );
    expect(canonicalizeMarkup(`<img src="a.png" alt="A">`)).not.toBe(
      canonicalizeMarkup(`<img src="a.png" alt="B">`),
    );
  });
});

describe("compareBlocks", () => {
  it("reports raw-identical blocks as identical and equivalent", () => {
    const comparison = compareBlocks("contact", HTML_CONTACT, HTML_CONTACT);
    expect(comparison).toMatchObject({ kind: "contact", identical: true, equivalent: true });
    expect(comparison.contentDifferences).toEqual([]);
    expect(comparison.formatDifferences).toEqual([]);
  });

  it("classifies pure formatting changes as equivalent with format hints", () => {
    const reformatted = HTML_CONTACT
      .replace(
        '<img src="assets/contact-feishu-permanent.png" width="260" alt="DSH 插件交流群 飞书群二维码" />',
        "<img alt='DSH 插件交流群 飞书群二维码' width='260' src='assets/contact-feishu-permanent.png'>",
      )
      .replace(
        '<img src="assets/contact-qq-permanent.png" width="260" alt="DSH 插件交流群 QQ 群二维码" />',
        '<img width="260" src="assets/contact-qq-permanent.png" alt="DSH 插件交流群 QQ 群二维码" />',
      );
    const comparison = compareBlocks("contact", HTML_CONTACT, reformatted);
    expect(comparison.equivalent).toBe(true);
    expect(comparison.identical).toBe(false);
    expect(comparison.contentDifferences).toEqual([]);
    const hints = comparison.formatDifferences.map((entry) => entry.kind);
    expect(hints).toEqual(expect.arrayContaining(["quotes", "attribute-order", "self-closing"]));
  });

  it("reports content differences with dimensions and paths", () => {
    const changedAlt = HTML_CONTACT.replace("飞书群二维码", "微信群二维码");
    const altComparison = compareBlocks("contact", HTML_CONTACT, changedAlt);
    expect(altComparison.equivalent).toBe(false);
    expect(altComparison.contentDifferences).toContainEqual({
      dimension: "text",
      path: "contact.groups[0].alt",
      expected: "DSH 插件交流群 飞书群二维码",
      actual: "DSH 插件交流群 微信群二维码",
    });

    const changedWidth = HTML_CONTACT.replace('width="260"', 'width="520"');
    expect(compareBlocks("contact", HTML_CONTACT, changedWidth).contentDifferences).toContainEqual({
      dimension: "width",
      path: "contact.groups[0].width",
      expected: 260,
      actual: 520,
    });
  });

  it("reports a missing block as a presence difference", () => {
    const comparison = compareBlocks("more", null, MORE_HTML_ZH);
    expect(comparison.equivalent).toBe(false);
    expect(comparison.contentDifferences).toEqual([
      { dimension: "presence", path: "more", expected: null, actual: "present" },
    ]);
  });

  it("accepts image prefixes and cache busters by default but compares src exactly on demand", () => {
    const markdownA = "![星标增长曲线](assets/star-history.svg?v=1)";
    const markdownB = "![星标增长曲线](https://cdn.example.com/x/star-history.svg?v=2)";
    expect(compareBlocks("star-history", markdownA, markdownB).equivalent).toBe(true);
    const exact = compareBlocks("star-history", markdownA, markdownB, { imageSrc: "exact" });
    expect(exact.equivalent).toBe(false);
    expect(exact.contentDifferences[0]).toMatchObject({ dimension: "image", path: "star-history.image.src" });
  });

  it("treats HTML and Markdown heading variants as content-equivalent", () => {
    const markdownHeading = HTML_CONTACT.replace(
      '<h2 align="center"><sub>CONNECT</sub><br>反馈与联系</h2>',
      "## 反馈与联系",
    );
    const comparison = compareBlocks("contact", HTML_CONTACT, markdownHeading);
    expect(comparison.equivalent).toBe(true);
    expect(comparison.contentDifferences).toEqual([]);
    expect(comparison.formatDifferences.map((entry) => entry.kind)).toContain("heading-variant");
  });

  it("compares thanks table headers, row data and links", () => {
    const changedLink = THANKS_HTML_ZH.replace("issues/1)", "issues/9)");
    const comparison = compareBlocks("thanks", THANKS_HTML_ZH, changedLink);
    expect(comparison.equivalent).toBe(false);
    expect(comparison.contentDifferences).toContainEqual({
      dimension: "links",
      path: "thanks.rows[0].cells[2].links[0]",
      expected: "https://github.com/owner/repo/issues/1",
      actual: "https://github.com/owner/repo/issues/9",
    });

    const changedHeader = THANKS_HTML_ZH.replace("| 致敬 |", "| 感谢 |");
    expect(compareBlocks("thanks", THANKS_HTML_ZH, changedHeader).contentDifferences).toContainEqual({
      dimension: "table",
      path: "thanks.headers[1]",
      expected: "致敬",
      actual: "感谢",
    });
  });

  it("reports MORE member order and member set differences", () => {
    const listA = `**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** —— 模板化提示词。

**[ilife](https://github.com/FeatherHunter/ilife)** —— 爱生活套件。`;
    const listB = `**[ilife](https://github.com/FeatherHunter/ilife)** —— 爱生活套件。

**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** —— 模板化提示词。`;
    const reordered = compareBlocks("more", listA, listB);
    expect(reordered.equivalent).toBe(false);
    expect(reordered.contentDifferences).toContainEqual({
      dimension: "members",
      path: "more.items",
      expected: ["dsh-prompt", "ilife"],
      actual: ["ilife", "dsh-prompt"],
    });

    const shortened = compareBlocks("more", listA, `**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** —— 模板化提示词。`);
    expect(shortened.contentDifferences).toContainEqual({
      dimension: "members",
      path: "more.items",
      expected: ["dsh-prompt", "ilife"],
      actual: ["dsh-prompt"],
    });
  });
});

describe("compareReadmeBlocks", () => {
  const DOC_A = `${MORE_HTML_ZH}\n\n${THANKS_HTML_ZH}`;
  const DOC_B = `${THANKS_HTML_ZH}\n\n${MORE_HTML_ZH}`;

  it("accepts a block order difference without failing content equivalence", () => {
    const comparison = compareReadmeBlocks(DOC_A, DOC_B);
    expect(comparison.equivalent).toBe(true);
    expect(comparison.order.same).toBe(false);
    expect(comparison.blocks.thanks.identical).toBe(true);
    expect(comparison.blocks.contact.identical).toBe(true);
  });

  it("fails equivalence when a nested block content changes", () => {
    const changed = SAMPLE_README.replace("🌹🌹", "🌹");
    const comparison = compareReadmeBlocks(SAMPLE_README, changed);
    expect(comparison.equivalent).toBe(false);
    expect(comparison.blocks.thanks.equivalent).toBe(false);
    expect(comparison.contentDifferences).toContainEqual({
      dimension: "table",
      path: "thanks.rows[0].cells[1].text",
      expected: "🌹🌹",
      actual: "🌹",
    });
  });

  it("reports an added star history block as a presence difference", () => {
    const comparison = compareReadmeBlocks(DOC_A, `${DOC_A}\n\n${STARS_MARKDOWN}`);
    expect(comparison.equivalent).toBe(false);
    expect(comparison.contentDifferences).toContainEqual({
      dimension: "presence",
      path: "star-history",
      expected: null,
      actual: "present",
    });
  });

  it("surfaces suspicious lines for the caller to stop on", () => {
    const comparison = compareReadmeBlocks(DOC_A, `${DOC_A}\n\n</div>>>>>>>> origin/master`);
    expect(comparison.suspicious).toHaveLength(1);
    expect(comparison.suspicious[0]!.reason).toBe("merge-conflict-residue");
  });
});

/**
 * Regression suite for test/fixtures/readme-blocks.json, the read-only snapshot
 * of the four managed blocks in the 11 README files of the five plugin repos.
 * The fixture pins the current form inventory so the migration tickets (09/10)
 * and readme:sync can be validated against real input, not just synthetic docs.
 */
interface FixtureBlock {
  raw: string | null;
  parsed: unknown;
  missing: boolean;
  note?: string;
}

interface FixtureFile {
  id: string;
  repo: string;
  repoPath: string;
  lang: "zh" | "en";
  sha256: string;
  bytes: number;
  lines: number;
  order: ReadmeBlockKind[];
  suspicious: SuspiciousLine[];
  blocks: Record<ReadmeBlockKind, FixtureBlock>;
}

interface FixtureData {
  meta: {
    readOnly: boolean;
    fileCount: number;
    blockKinds: ReadmeBlockKind[];
    missingBlocks: string[];
  };
  files: FixtureFile[];
}

interface ContactParseLike {
  variant: string;
  heading: { text: string };
  groups: { title: string; src: string; asset: string; width: number | null }[];
}

interface ThanksParseLike {
  variant: string;
  heading: { text: string };
  lang: "zh" | "en" | null;
  headers: string[];
  rows: { cells: { text: string; links: string[] }[] }[];
}

interface MoreParseLike {
  variant: string;
  heading: { text: string };
  items: { name: string; url: string; description: string }[];
}

const fixture = fixtureData as unknown as FixtureData;
const FIXTURE_KINDS: ReadmeBlockKind[] = ["contact", "star-history", "thanks", "more"];
const ZH_THANKS_HEADERS = ["贡献者", "致敬", "贡献"];
const EN_THANKS_HEADERS = ["Contributor", "Tribute", "Contributions"];

const FIXTURE_PARSERS: Record<ReadmeBlockKind, (raw: string) => unknown> = {
  contact: parseContactBlock,
  "star-history": parseStarHistoryBlock,
  thanks: parseThanksBlock,
  more: parseMoreBlock,
};

function fileById(id: string): FixtureFile {
  const file = fixture.files.find((candidate) => candidate.id === id);
  if (file === undefined) throw new Error("fixture has no file " + id);
  return file;
}

function parsedFileById(id: string, kind: ReadmeBlockKind): unknown {
  return fileById(id).blocks[kind].parsed;
}

function locatedFrom(file: FixtureFile): LocatedBlocks {
  return {
    blocks: {
      contact: file.blocks.contact.raw,
      "star-history": file.blocks["star-history"].raw,
      thanks: file.blocks.thanks.raw,
      more: file.blocks.more.raw,
    },
    order: file.order,
    suspicious: file.suspicious,
  };
}

function groupIdsByVariant(kind: ReadmeBlockKind): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const file of fixture.files) {
    const block = file.blocks[kind];
    const variant = block.missing ? "missing" : String((block.parsed as { variant: string }).variant);
    (groups[variant] ??= []).push(file.id);
  }
  return groups;
}

function moreItemNames(id: string): string[] | null {
  const parsed = parsedFileById(id, "more") as MoreParseLike | null;
  return parsed === null ? null : parsed.items.map((item) => item.name);
}

function contactImagePrefix(src: string): string {
  if (/^https?:\/\//.test(src)) return "absolute";
  return src.slice(0, src.lastIndexOf("/") + 1);
}

describe("readme fixture (real repositories)", () => {
  it("covers 11 README files with the four managed blocks", () => {
    expect(fixture.meta.readOnly).toBe(true);
    expect(fixture.files).toHaveLength(11);
    expect(fixture.meta.fileCount).toBe(11);
    expect(fixture.meta.blockKinds).toEqual(FIXTURE_KINDS);
    expect(new Set(fixture.files.map((file) => file.id)).size).toBe(11);
    expect(new Set(fixture.files.map((file) => file.repo + "/" + file.repoPath)).size).toBe(11);
    expect(fixture.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);

    let present = 0;
    for (const file of fixture.files) {
      for (const kind of FIXTURE_KINDS) {
        const block = file.blocks[kind];
        expect(block.missing).toBe(block.raw === null);
        expect(block.missing).toBe(block.parsed === null);
        if (block.missing) continue;
        present += 1;
        expect(block.raw!.trim().length).toBeGreaterThan(0);
      }
    }
    expect(present).toBe(42);
    expect(fixture.meta.missingBlocks).toEqual(["ilife.star-history", "ilife.more"]);

    const ilife = fileById("ilife");
    expect(ilife.blocks["star-history"].missing).toBe(true);
    expect(ilife.blocks.more.missing).toBe(true);
    expect(ilife.blocks["star-history"].note).toContain("F21");
    expect(ilife.blocks.more.note).toContain("F21");
  });

  it("records the language and block order of every README", () => {
    expect(Object.fromEntries(fixture.files.map((file) => [file.id, file.lang]))).toEqual({
      deck: "zh",
      "deck-pkg": "zh",
      "deck-en": "en",
      palette: "zh",
      "palette-pkg": "en",
      "palette-en": "en",
      im: "zh",
      "im-en": "en",
      prompt: "zh",
      "prompt-en": "en",
      ilife: "zh",
    });

    const idsByOrder: Record<string, string[]> = {};
    for (const file of fixture.files) {
      (idsByOrder[file.order.join(">")] ??= []).push(file.id);
    }
    expect(idsByOrder).toEqual({
      "thanks>contact>star-history>more": ["deck", "deck-pkg"],
      "more>thanks>contact>star-history": [
        "deck-en",
        "palette",
        "palette-pkg",
        "palette-en",
        "im",
        "im-en",
        "prompt",
        "prompt-en",
      ],
      "thanks>contact": ["ilife"],
    });
  });

  it("captures the variant inventory of each managed block", () => {
    const htmlHeading = [
      "deck",
      "deck-pkg",
      "deck-en",
      "palette",
      "palette-pkg",
      "palette-en",
      "im",
      "im-en",
      "prompt",
      "prompt-en",
    ];
    const htmlBlocks = ["deck", "deck-pkg", "deck-en", "palette", "palette-pkg", "palette-en", "im", "im-en"];

    expect(groupIdsByVariant("contact")).toEqual({
      "html-heading": htmlHeading,
      "markdown-heading": ["ilife"],
    });
    expect(groupIdsByVariant("star-history")).toEqual({
      "picture-link": ["deck", "deck-pkg", "deck-en"],
      picture: ["im", "im-en"],
      "markdown-image": ["palette", "palette-pkg", "palette-en", "prompt", "prompt-en"],
      missing: ["ilife"],
    });
    expect(groupIdsByVariant("thanks")).toEqual({
      "html-heading": htmlBlocks,
      "markdown-heading": ["prompt", "prompt-en", "ilife"],
    });
    expect(groupIdsByVariant("more")).toEqual({
      "html-heading": htmlBlocks,
      "markdown-heading": ["prompt", "prompt-en"],
      missing: ["ilife"],
    });
  });

  it("records the six MORE row-set orders", () => {
    expect(moreItemNames("deck")).toEqual(["dsh-opencode-palette", "dsh-prompt", "dsh-im-companion", "ilife"]);
    expect(moreItemNames("deck-pkg")).toEqual(moreItemNames("deck"));
    expect(moreItemNames("deck-en")).toEqual([
      "dsh-opencode-palette",
      "dsh-prompt",
      "dsh-chinese-skill-patch",
    ]);
    const paletteOrder = ["dsh-prompt", "dsh-mattpocock-skills-deck", "dsh-im-companion", "ilife"];
    expect(moreItemNames("palette")).toEqual(paletteOrder);
    expect(moreItemNames("palette-pkg")).toEqual(paletteOrder);
    expect(moreItemNames("palette-en")).toEqual(paletteOrder);
    const imOrder = ["dsh-opencode-palette", "dsh-mattpocock-skills-deck", "dsh-prompt", "ilife"];
    expect(moreItemNames("im")).toEqual(imOrder);
    expect(moreItemNames("im-en")).toEqual(imOrder);
    const promptOrder = ["dsh-mattpocock-skills-deck", "dsh-opencode-palette", "dsh-im-companion", "ilife"];
    expect(moreItemNames("prompt")).toEqual(promptOrder);
    expect(moreItemNames("prompt-en")).toEqual(promptOrder);
    expect(moreItemNames("ilife")).toBeNull();
  });

  it("records the three MORE heading wordings", () => {
    const headings = new Set<string>();
    for (const file of fixture.files) {
      const parsed = file.blocks.more.parsed as MoreParseLike | null;
      if (parsed !== null) headings.add(parsed.heading.text);
    }
    expect([...headings].sort()).toEqual(["More by the author", "More from the author", "作者的其他作品"].sort());
  });

  it("confirms the thanks block is one template across all five repos", () => {
    const rowCounts: Record<string, number> = {};
    for (const file of fixture.files) {
      const parsed = file.blocks.thanks.parsed as ThanksParseLike;
      expect(parsed.heading.text).toBe(parsed.lang === "en" ? (file.id.startsWith("palette") ? "Contributors" : "Thanks") : "致谢");
      expect(parsed.headers).toEqual(parsed.lang === "en" ? EN_THANKS_HEADERS : ZH_THANKS_HEADERS);
      expect(parsed.rows.every((row) => row.cells.length === 3)).toBe(true);
      expect(parsed.rows.every((row) => row.cells.every((cell, index) => (index === 1 ? true : cell.text.length > 0)))).toBe(true);
      rowCounts[file.id] = parsed.rows.length;
    }
    expect(rowCounts).toEqual({
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
    });
  });

  it("keeps every non-missing raw block re-parseable to the stored structure", () => {
    let checked = 0;
    for (const file of fixture.files) {
      for (const kind of FIXTURE_KINDS) {
        const block = file.blocks[kind];
        if (block.missing) continue;
        expect(FIXTURE_PARSERS[kind](block.raw!)).toEqual(block.parsed);
        checked += 1;
      }
    }
    expect(checked).toBe(42);
  });

  it("treats every fixture block as identical to itself", () => {
    for (const file of fixture.files) {
      for (const kind of FIXTURE_KINDS) {
        const block = file.blocks[kind];
        if (block.missing) continue;
        const comparison = compareBlocks(kind, block.raw, block.raw);
        expect(comparison.identical).toBe(true);
        expect(comparison.equivalent).toBe(true);
        expect(comparison.contentDifferences).toEqual([]);
        expect(comparison.formatDifferences).toEqual([]);
      }
    }
  });

  it("self-compares every real README as equivalent", () => {
    for (const file of fixture.files) {
      const comparison = compareReadmeBlocks(locatedFrom(file), locatedFrom(file));
      expect(comparison.equivalent).toBe(true);
      expect(comparison.order.same).toBe(true);
      expect(comparison.contentDifferences).toEqual([]);
      expect(comparison.suspicious).toEqual(file.suspicious);
    }
  });

  it("absorbs CRLF and trailing-whitespace reflow in every real block", () => {
    for (const file of fixture.files) {
      for (const kind of FIXTURE_KINDS) {
        const block = file.blocks[kind];
        if (block.missing) continue;
        const reflowed = block.raw!.replace(/\r?\n/g, "\r\n").replace(/[ \t]+$/gm, "");
        const comparison = compareBlocks(kind, block.raw, reflowed);
        expect(comparison.equivalent).toBe(true);
        expect(comparison.contentDifferences).toEqual([]);
        expect(comparison.formatDifferences.length).toBeGreaterThan(0);
      }
    }
  });

  it("captures the contact image prefixes, including one absolute upstream URL", () => {
    const prefixes = new Set<string>();
    for (const file of fixture.files) {
      if (file.blocks.contact.missing) continue;
      const parsed = file.blocks.contact.parsed as ContactParseLike;
      expect(parsed.groups).toHaveLength(3);
      expect(parsed.groups.every((group) => group.width === 260)).toBe(true);
      for (const group of parsed.groups) prefixes.add(contactImagePrefix(group.src));
    }
    expect([...prefixes].sort()).toEqual([
      "../assets/",
      "../assets/readme/",
      "absolute",
      "assets/",
      "assets/readme/",
    ]);

    const deckPkg = fileById("deck-pkg").blocks.contact.parsed as ContactParseLike;
    expect(deckPkg.groups.every((group) => group.src.startsWith("https://github.com/"))).toBe(true);

    const qqAssets = new Set<string>();
    for (const file of fixture.files) {
      if (file.blocks.contact.missing) continue;
      const parsed = file.blocks.contact.parsed as ContactParseLike;
      const qq = parsed.groups.find((group) => group.asset.includes("contact-qq-permanent"));
      if (qq !== undefined) qqAssets.add(qq.asset);
    }
    expect([...qqAssets].sort()).toEqual(["contact-qq-permanent.jpg", "contact-qq-permanent.png"]);
  });

  it("flags the dsh-im-companion merge-conflict residue as a hard stop line", () => {
    const flagged = fixture.files.filter((file) => file.suspicious.length > 0);
    expect(flagged.map((file) => file.id)).toEqual(["im"]);
    expect(flagged[0]!.suspicious).toEqual([
      { line: 262, text: "</div>>>>>>>> origin/master", reason: "merge-conflict-residue" },
    ]);

    const located = locatedFrom(fileById("im"));
    const comparison = compareReadmeBlocks(located, located);
    expect(comparison.suspicious).toHaveLength(1);
    expect(comparison.suspicious[0]!.reason).toBe("merge-conflict-residue");
  });
});
