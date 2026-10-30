// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { createBaseUI } from "../../src/client/index";
import {
  PACKAGE_NAME,
  imageUrls,
  type FetchLike,
  type FetchResponseLike,
} from "../../src/client/content";
import { BASELINE } from "../../src/core/index";
import { installDialogPolyfill, resetClientDom } from "./helpers";

const NOW = new Date("2026-10-31T00:00:00+08:00");
const UNPKG_URL = "https://unpkg.com/" + PACKAGE_NAME + "@latest/data/manifest.json";

let polyfill: ReturnType<typeof installDialogPolyfill>;

beforeEach(() => {
  resetClientDom();
  polyfill = installDialogPolyfill();
  document.documentElement.lang = "zh-CN";
});

function jsonResponse(body: unknown, status = 200): FetchResponseLike {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

function imageResponse(bytes = 32): FetchResponseLike {
  const buffer = new Uint8Array(bytes);
  buffer.fill(7);
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => {
        const key = name.toLowerCase();
        if (key === "content-type") return "image/png";
        if (key === "content-length") return String(bytes);
        return null;
      },
    },
    text: async () => "",
    arrayBuffer: async () => buffer.buffer,
  };
}

function plugin(): Record<string, unknown> {
  return {
    id: "deck",
    order: 10,
    verifiedAt: "2026-10-30",
    name: "deck",
    repo: "FeatherHunter/dsh-mattpocock-skills-deck",
    desc: { zh: "deck 插件", en: "deck plugin" },
  };
}

function remoteManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    version: "0.0.1",
    revision: 2,
    updatedAt: "2026-10-23T00:00:00+08:00",
    fallbackUrl: "https://example.com/latest-groups",
    groups: [
      {
        id: "feishu",
        platform: "feishu",
        order: 10,
        readmeTitle: { zh: "飞书群（主）", en: "Feishu (main)" },
        alt: { zh: "飞书群二维码", en: "Feishu QR" },
        card: "card-feishu.png",
        qr: { kind: "remote", path: "qr-feishu.png" },
        title: { zh: "DSH 插件交流群", en: "DSH plugin community" },
        note: { zh: "该二维码永久有效", en: "Never expires" },
      },
      {
        id: "wechat",
        platform: "wechat",
        order: 30,
        readmeTitle: { zh: "微信群（新）", en: "WeChat (new)" },
        alt: { zh: "微信群二维码", en: "WeChat QR" },
        card: "card-wechat.png",
        qr: { kind: "remote", path: "qr-wechat.png" },
        title: { zh: "微信群", en: "WeChat group" },
        subtitle: { zh: "群号：999", en: "Group ID: 999" },
        validUntil: "2026-11-07",
      },
    ],
    plugins: [plugin()],
    ...overrides,
  };
}

/** Serve the manifest on unpkg plus the QR images on jsDelivr. */
function serveRemote(manifest: Record<string, unknown> = remoteManifest()): {
  fetch: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    if (url === UNPKG_URL) return jsonResponse(manifest);
    if (imageUrls("0.0.1", "qr-feishu.png").includes(url)) return imageResponse();
    if (imageUrls("0.0.1", "qr-wechat.png").includes(url)) return imageResponse();
    throw new Error("unexpected request " + url);
  };
  return { fetch, calls };
}

async function settle(ticks = 8): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".dsh-base-modal__card"));
}

function cardFor(groupId: string): HTMLElement {
  const card = document.querySelector<HTMLElement>('.dsh-base-modal__card[data-group-id="' + groupId + '"]');
  if (!card) throw new Error("missing card for " + groupId);
  return card;
}

describe("remote manifest refresh", () => {
  it("paints the baseline first and then swaps in the published manifest", async () => {
    const { fetch, calls } = serveRemote();
    const ui = createBaseUI(React, { lang: "zh", fetchImpl: fetch });
    ui.openContactModal({ now: NOW });

    // First frame: bundled baseline only, no request finished yet.
    expect(cards()).toHaveLength(BASELINE.manifest.groups.length);

    await settle();

    // The published groups replaced the baseline in the same dialog.
    expect(cards().map((card) => card.dataset.groupId)).toEqual(["feishu", "wechat"]);
    expect(polyfill.showModalCalls()).toHaveLength(1);
    expect(calls[0]).toBe(UNPKG_URL);

    // The wechat card uses prefetched image bytes, not a remote <img src>.
    const image = cardFor("wechat").querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")?.startsWith("data:image/png;base64,")).toBe(true);
    expect(image?.getAttribute("alt")).toBe("微信群二维码");

    // Validity text comes from validUntil, not from the data.
    expect(cardFor("wechat").textContent).toContain("11 月 7 日");
    expect(cardFor("wechat").classList.contains("dsh-base-modal__card--expired")).toBe(false);
  });

  it("degrades an expired remote code to the manifest fallback link", async () => {
    const manifest = remoteManifest({
      groups: [
        {
          id: "wechat",
          platform: "wechat",
          order: 30,
          readmeTitle: { zh: "微信群", en: "WeChat" },
          alt: { zh: "微信群二维码", en: "WeChat QR" },
          card: "card-wechat.png",
          qr: { kind: "remote", path: "qr-wechat.png" },
          title: { zh: "微信群", en: "WeChat group" },
          validUntil: "2026-10-30",
        },
      ],
    });
    const { fetch } = serveRemote(manifest);
    const ui = createBaseUI(React, { lang: "zh", fetchImpl: fetch });
    ui.openContactModal({ now: NOW });
    await settle();

    const card = cardFor("wechat");
    expect(card.classList.contains("dsh-base-modal__card--expired")).toBe(true);
    expect(card.querySelector("img")).toBeNull();
    const link = card.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/latest-groups");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the baseline when the CDN is unreachable, without surfacing an error", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("offline");
    };
    const ui = createBaseUI(React, { lang: "zh", fetchImpl: fetch });
    ui.openContactModal({ now: NOW });
    await settle();
    expect(cards()).toHaveLength(BASELINE.manifest.groups.length);
    expect(cards().map((card) => card.dataset.groupId)).toEqual(
      BASELINE.manifest.groups.map((group) => group.id),
    );
  });

  it("does not clobber an explicit group override", async () => {
    const { fetch } = serveRemote();
    const ui = createBaseUI(React, { lang: "zh", fetchImpl: fetch });
    const custom = [
      {
        id: "custom",
        platform: "custom",
        order: 10,
        readmeTitle: { zh: "自定义", en: "Custom" },
        alt: { zh: "自定义码", en: "Custom code" },
        card: "card-custom.png",
        qr: { kind: "bundled" as const, key: "qr-feishu" },
        title: { zh: "自定义群", en: "Custom group" },
      },
    ];
    ui.openContactModal({ groups: custom, now: NOW });
    await settle();
    expect(cards().map((card) => card.dataset.groupId)).toEqual(["custom"]);
  });
});

describe("remote manifest cache", () => {
  it("does not refetch when the dialog is reopened inside 30 minutes", async () => {
    const { fetch, calls } = serveRemote();
    const ui = createBaseUI(React, { lang: "zh", fetchImpl: fetch });
    ui.openContactModal({ now: NOW });
    await settle();
    const afterFirstOpen = calls.length;
    expect(afterFirstOpen).toBeGreaterThan(1);

    ui.closeContactModal();
    ui.openContactModal({ now: NOW });
    await settle();
    expect(calls.length).toBe(afterFirstOpen);
    expect(cards().map((card) => card.dataset.groupId)).toEqual(["feishu", "wechat"]);
  });

  it("preloadContent() warms manifest and images so the next open is instant", async () => {
    const { fetch, calls } = serveRemote();
    const ui = createBaseUI(React, { lang: "zh", fetchImpl: fetch });
    await ui.preloadContent();
    const warmed = calls.length;

    ui.openContactModal({ now: NOW });
    await settle();
    // Only the cached content is used: no extra request after preload.
    expect(calls.length).toBe(warmed);
    expect(cards().map((card) => card.dataset.groupId)).toEqual(["feishu", "wechat"]);
    expect(cardFor("wechat").querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png/);
  });
});

describe("dialog teardown while the manifest is in flight", () => {
  it("closes cleanly before the manifest arrives", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      await gate;
      return jsonResponse(remoteManifest());
    };
    const ui = createBaseUI(React, { lang: "zh", fetchImpl: fetch });
    ui.openContactModal({ now: NOW });
    ui.closeContactModal();
    expect(document.querySelector("dialog")).toBeNull();
    release();
    await settle();
    // The late response must not resurrect a dialog or throw.
    expect(document.querySelector("dialog")).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
  });
});