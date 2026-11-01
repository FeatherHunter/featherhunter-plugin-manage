// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  channelBadge,
  createChannelBadge,
  type ChannelBadgeSpec,
} from "../../src/client/channel-badges";
import { resolveText } from "../../src/client/texts";
import { BASELINE } from "../../src/core/index";
import { resetClientDom } from "./helpers";

beforeEach(() => {
  resetClientDom();
});

/** Platforms the bundled cards can actually show, without repeats. */
function bundledPlatforms(): string[] {
  return [...new Set(BASELINE.manifest.groups.map((group) => group.platform))];
}

describe("channel badge table", () => {
  it("covers every platform the bundled cards can show", () => {
    const platforms = bundledPlatforms();
    expect(platforms.length).toBeGreaterThan(0);
    for (const platform of platforms) {
      expect(channelBadge(platform), 'missing channel badge for "' + platform + '"').toBeDefined();
    }
  });

  it("keeps one row per platform, with a brand colour, a viewBox, mark paths and names", () => {
    for (const platform of bundledPlatforms()) {
      const badge = channelBadge(platform);
      expect(badge).toBeDefined();
      expect(badge?.platform).toBe(platform);
      expect(badge?.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(badge?.viewBox).toMatch(/^0 0 \d+ \d+$/);
      expect(badge?.paths.length).toBeGreaterThan(0);
      expect(resolveText(badge!.labelKey, "zh")).not.toBe("");
      expect(resolveText(badge!.labelKey, "en")).not.toBe("");
    }
  });

  it("treats unknown or inherited keys as channels without a badge", () => {
    expect(channelBadge("unknown-channel")).toBeUndefined();
    expect(channelBadge("toString")).toBeUndefined();
  });
});

describe("channel badge rendering", () => {
  it("paints the white mark on the WeChat brand colour, decorative to assistive tech", () => {
    const badge = channelBadge("wechat");
    expect(badge).toBeDefined();
    const tile = createChannelBadge(document, badge!);

    expect(tile.className).toBe("dsh-base-modal__card-badge");
    expect(tile.dataset.platform).toBe("wechat");
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.style.getPropertyValue("--dsh-base-badge-color")).toBe("#07C160");

    const svg = tile.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(svg?.getAttribute("role")).toBe("presentation");
    const paths = svg?.querySelectorAll("path") ?? [];
    expect(paths).toHaveLength(badge!.paths.length);
    for (const path of paths) {
      expect(path.getAttribute("fill")).toBe("currentColor");
      expect(path.getAttribute("fill-rule")).toBeNull();
    }
  });

  it("renders any table row without a renderer change (adding a channel = adding data)", () => {
    const row: ChannelBadgeSpec = {
      platform: "demo",
      labelKey: "channelQq",
      color: "#123456",
      viewBox: "0 0 10 10",
      paths: ["M0 0h10v10H0z"],
      fillRule: "evenodd",
    };
    const tile = createChannelBadge(document, row);

    expect(tile.dataset.platform).toBe("demo");
    expect(tile.style.getPropertyValue("--dsh-base-badge-color")).toBe("#123456");
    const path = tile.querySelector("path");
    expect(path?.getAttribute("d")).toBe("M0 0h10v10H0z");
    expect(path?.getAttribute("fill-rule")).toBe("evenodd");
  });
});

describe("channel name messages", () => {
  it("localizes the screen-reader name and honours host overrides", () => {
    const badge = channelBadge("feishu");
    expect(badge).toBeDefined();
    expect(resolveText(badge!.labelKey, "zh")).toBe("飞书群");
    expect(resolveText(badge!.labelKey, "en")).toBe("Feishu group");
    expect(resolveText(badge!.labelKey, "zh", { channelFeishu: "自定义渠道" })).toBe("自定义渠道");
  });
});
