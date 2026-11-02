import { describe, expect, it } from "vitest";
import { BASELINE } from "../src/core/index";
import type { Manifest } from "../src/core/types";
import { compareBlocks, renderContactBlock } from "../src/node/index";
import {
  CDN_BASE,
  cardUrl,
  expectMigratedContactSources,
  fixtureContactRaw,
} from "./readme-helpers";

describe("renderContactBlock", () => {
  it("renders the standard CONNECT variant content-equivalent to the pre-migration fixture", () => {
    const expected = expectMigratedContactSources(fixtureContactRaw("deck"));
    const comparison = compareBlocks("contact", expected, renderContactBlock());
    expect(comparison.contentDifferences).toEqual([]);
    expect(comparison.equivalent).toBe(true);
  });

  it("renders ilife's Markdown heading variant content-equivalent to its fixture", () => {
    const expected = expectMigratedContactSources(fixtureContactRaw("ilife"));
    const rendered = renderContactBlock({ variant: "markdown-heading" });
    const comparison = compareBlocks("contact", expected, rendered);
    expect(comparison.contentDifferences).toEqual([]);
    expect(comparison.equivalent).toBe(true);
    // The Markdown heading needs a centring wrapper: GitHub only centres the
    // HTML h2 through its align attribute, so the sync keeps the same wrapper
    // the repository's other headings use.
    expect(rendered.startsWith('<div align="center">\n\n## 反馈与联系\n\n</div>')).toBe(true);
  });

  it("centres the Markdown heading variant while keeping its wording", () => {
    const rendered = renderContactBlock({
      variant: "markdown-heading",
      headingText: "反馈与联系 <sub>CONNECT</sub>",
    });
    expect(rendered.startsWith('<div align="center">\n\n## 反馈与联系 <sub>CONNECT</sub>\n\n</div>')).toBe(true);
    expect(rendered).not.toContain("<h2");
  });

  it("renders English headings, titles and alt text for the en fixture", () => {
    const expected = expectMigratedContactSources(fixtureContactRaw("deck-en"));
    const comparison = compareBlocks("contact", expected, renderContactBlock({ lang: "en" }));
    expect(comparison.contentDifferences).toEqual([]);
    expect(comparison.equivalent).toBe(true);
  });

  it("keeps the 260-wide whole-card table and hides modal-only fields", () => {
    const rendered = renderContactBlock();
    expect(rendered).toContain(">反馈与联系<");
    expect(rendered).toContain('<table align="center">');
    expect(rendered).toContain('width="260"');
    expect(rendered.match(/<img /g)).toHaveLength(3);
    expect(rendered).not.toContain("用户418832的组织");
    expect(rendered).not.toContain("该二维码永久有效");
    expect(rendered).not.toContain("扫一扫二维码");
    expect(rendered).not.toContain("qr-feishu");
    expect(rendered).not.toContain("qr-wechat");
  });

  it("builds precise-version absolute https image URLs with the right cache busters", () => {
    const rendered = renderContactBlock();
    const sources = [...rendered.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]!);
    expect(sources).toHaveLength(3);
    for (const src of sources) expect(src.startsWith("https://")).toBe(true);
    expect(sources[0]).toBe(cardUrl("card-feishu.png"));
    expect(sources[1]).toBe(cardUrl("card-qq.png"));
    expect(sources[2]).toBe(cardUrl("card-wechat-2026-10-31.png") + "?v=20261031");
    expect(sources[0]).not.toContain("?v=");
    expect(sources[1]).not.toContain("?v=");
  });

  it("honours a cdnBase and version override", () => {
    const rendered = renderContactBlock({ cdnBase: "https://cdn.example.test/pkg/", version: "1.2.3" });
    expect(rendered).toContain('src="https://cdn.example.test/pkg@1.2.3/data/img/card-feishu.png"');
  });

  it("rejects a relative or non-https cdnBase instead of writing a relative README URL", () => {
    expect(() => renderContactBlock({ cdnBase: "assets/" })).toThrow(/absolute https URL/);
    expect(() => renderContactBlock({ cdnBase: "http://cdn.example.test/pkg" })).toThrow(/absolute https URL/);
  });

  it("dates a limited-time card from manifest.updatedAt when the file name has no date", () => {
    const manifest: Manifest = structuredClone(BASELINE.manifest);
    // Pin the manifest date: this test is about the date source, not about the shipped data.
    manifest.updatedAt = "2026-10-31T00:00:00+08:00";
    const wechat = manifest.groups.find((group) => group.id === "wechat")!;
    wechat.card = "card-wechat.png";
    wechat.validUntil = "2026-10-30";
    expect(renderContactBlock({ manifest })).toContain(
      'src="' + cardUrl("card-wechat.png") + '?v=20261031"',
    );
  });

  it("prefers the date in the card file name over validUntil", () => {
    const manifest: Manifest = structuredClone(BASELINE.manifest);
    const wechat = manifest.groups.find((group) => group.id === "wechat")!;
    wechat.card = "card-wechat-2026-10-30.png";
    wechat.validUntil = "2026-11-06";
    expect(renderContactBlock({ manifest })).toContain(
      'src="' + cardUrl("card-wechat-2026-10-30.png") + '?v=20261030"',
    );
  });
  it("never renders the modal-only title/subtitle/note/qr fields", () => {
    const manifest: Manifest = structuredClone(BASELINE.manifest);
    const group = manifest.groups[0]!;
    group.title = { zh: "联系作者", en: "Contact author" };
    group.subtitle = { zh: "副行专用", en: "Modal subtitle" };
    group.note = { zh: "角注专用", en: "Modal note" };
    group.qr = { kind: "remote", path: "qr-secret.png" };
    manifest.groups = [group];

    const zhRender = renderContactBlock({ manifest, lang: "zh" });
    expect(zhRender).toContain("飞书群（主）");
    for (const hidden of ["联系作者", "副行专用", "角注专用", "qr-secret.png"]) {
      expect(zhRender).not.toContain(hidden);
    }

    const enRender = renderContactBlock({ manifest, lang: "en" });
    expect(enRender).toContain("Feishu Group (Main)");
    for (const hidden of ["Contact author", "Modal subtitle", "Modal note"]) {
      expect(enRender).not.toContain(hidden);
    }
  });
});
