// @vitest-environment jsdom
import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
  type FetchLike,
  type FetchResponseLike,
} from "../../src/client/content";
import { BASE_CSS, createBaseUI } from "../../src/client/index";
import { BASE_STYLE_ID } from "../../src/client/styles";
import { BASELINE } from "../../src/core/index";
import type { PluginEntry } from "../../src/core/types";
import { installDialogPolyfill, resetClientDom } from "./helpers";

const MANIFEST_URL = "https://unpkg.com/" + PACKAGE_NAME + "@latest/data/manifest.json";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetClientDom();
  installDialogPolyfill();
  document.documentElement.lang = "zh-CN";
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Bundled row names in render order, capped like the default widget. */
function baselineNames(): string[] {
  return [...BASELINE.manifest.plugins]
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)
    .map((plugin) => plugin.name);
}

function rowNames(): string[] {
  return Array.from(container.querySelectorAll(".dsh-base-plugins__name")).map(
    (node) => node.textContent ?? "",
  );
}

function remotePlugin(): PluginEntry {
  return {
    id: "remote",
    order: 10,
    verifiedAt: "2026-10-30",
    name: "dsh-remote",
    repo: "FeatherHunter/dsh-remote",
    desc: { zh: "远程插件", en: "remote plugin" },
  };
}

function remoteManifest(plugin: PluginEntry = remotePlugin()): Record<string, unknown> {
  return {
    schema: 1,
    version: "1.2.3",
    revision: 7,
    updatedAt: "2026-10-30T00:00:00+08:00",
    fallbackUrl: "https://github.com/FeatherHunter/featherhunter-plugin-manage",
    groups: [
      {
        id: "feishu",
        platform: "feishu",
        order: 10,
        readmeTitle: { zh: "飞书群", en: "Feishu group" },
        alt: { zh: "飞书群二维码", en: "Feishu QR" },
        card: "card-feishu.png",
        qr: { kind: "bundled", key: "qr-feishu" },
        title: { zh: "飞书群", en: "Feishu group" },
      },
    ],
    plugins: [plugin],
  };
}

function jsonResponse(body: unknown): FetchResponseLike {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

/** Let the loader promise chain and the resulting React update settle. */
async function settle(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function button(selector = "button"): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(selector);
}

describe("contact button", () => {
  it("renders an icon-only button named by the localised contact text", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ContactButton)));

    const trigger = button("button.dsh-base-contact-button");
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-label")).toBe("联系我们");
    expect(trigger?.getAttribute("title")).toBe("联系我们");
    expect(trigger?.getAttribute("type")).toBe("button");

    const svg = trigger?.querySelector("svg") ?? null;
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    // No visible text: the name is exposed through aria / title only.
    expect(container.textContent).toBe("");
  });

  it("honours the size and className props", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() =>
      root.render(React.createElement(ui.ContactButton, { size: 18, className: "my-trigger" })),
    );

    const trigger = button("button.dsh-base-contact-button");
    expect(trigger?.classList.contains("my-trigger")).toBe(true);
    expect(trigger?.querySelector("svg")?.getAttribute("width")).toBe("18");
    expect(trigger?.querySelector("svg")?.getAttribute("height")).toBe("18");

    act(() => root.render(React.createElement(ui.ContactButton)));
    expect(button("button.dsh-base-contact-button")?.querySelector("svg")?.getAttribute("width")).toBe("16");
  });

  it("opens the dialog and moves focus back on close", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ContactButton)));
    const trigger = button("button.dsh-base-contact-button");

    act(() => trigger?.click());
    expect(document.querySelector("dialog")).not.toBeNull();

    act(() => document.querySelector<HTMLElement>(".dsh-base-modal__close")?.click());
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("contact row", () => {
  it("is one whole-row button with icon, label and external-link arrow", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ContactRow, { hint: "群聊" })));

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    const row = buttons[0];
    expect(container.firstElementChild).toBe(row);
    expect(row.getAttribute("type")).toBe("button");
    expect(row.classList.contains("dsh-base-contact-row")).toBe(true);
    // Contact icon + external-link arrow: exactly two glyphs.
    expect(row.querySelectorAll("svg")).toHaveLength(2);
    expect(row.querySelector(".dsh-base-contact-row__icon svg")).not.toBeNull();
    expect(row.querySelector(".dsh-base-contact-row__ext svg")).not.toBeNull();
    expect(row.textContent).toContain("联系我们");
    expect(row.textContent).toContain("群聊");
  });

  it("opens the dialog when the whole row is clicked", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ContactRow)));

    act(() => button("button.dsh-base-contact-row")?.click());
    expect(document.querySelector("dialog")).not.toBeNull();
  });
});

describe("author plugin card data", () => {
  it("paints the bundled baseline first and silently swaps in the remote list", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      if (url === MANIFEST_URL) return jsonResponse(remoteManifest());
      throw new Error("unexpected request: " + url);
    };
    const ui = createBaseUI(React, { lang: "zh", manifestUrl: MANIFEST_URL, fetchImpl });

    act(() => root.render(React.createElement(ui.AuthorPlugins)));
    // First paint is the bundle: no spinner, no empty card.
    expect(rowNames()).toEqual(baselineNames());
    expect(calls).toContain(MANIFEST_URL);

    await act(async () => {
      await settle();
    });
    expect(rowNames()).toEqual(["dsh-remote"]);
  });

  it("keeps the baseline when the remote manifest never arrives", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("offline");
    };
    const ui = createBaseUI(React, { lang: "zh", manifestUrl: MANIFEST_URL, fetchImpl });

    act(() => root.render(React.createElement(ui.AuthorPlugins)));
    await act(async () => {
      await settle();
    });
    expect(rowNames()).toEqual(baselineNames());
    expect(container.textContent).not.toContain("offline");
  });

  it("does not fetch anything when plugins are passed explicitly", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return jsonResponse(remoteManifest());
    };
    const explicit: PluginEntry[] = [
      { ...remotePlugin(), id: "explicit", name: "dsh-explicit" },
    ];
    const ui = createBaseUI(React, { lang: "zh", manifestUrl: MANIFEST_URL, fetchImpl });

    act(() => root.render(React.createElement(ui.AuthorPlugins, { plugins: explicit })));
    await act(async () => {
      await settle();
    });
    expect(calls).toHaveLength(0);
    expect(rowNames()).toEqual(["dsh-explicit"]);
  });
});

describe("stylesheet contract", () => {
  it("injects one stylesheet under the fixed id from the spec", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.AuthorPlugins)));

    expect(document.getElementById(BASE_STYLE_ID)).not.toBeNull();
    expect(document.querySelectorAll("#" + BASE_STYLE_ID)).toHaveLength(1);
    // The pre-spec id must never come back: hosts key their CSP on the new one.
    expect(document.getElementById("dsh-base-style")).toBeNull();
  });

  it("ships the icon button, shared row skin and dialog token rules", () => {
    expect(BASE_CSS).toContain(".dsh-base-contact-button{display:inline-flex");
    expect(BASE_CSS).toContain("padding:6px;border:0;border-radius:6px;background:transparent");
    expect(BASE_CSS).toContain(".dsh-base-contact-button:hover{background:var(--dsw-alias-bg-layer-2,");
    // One row-skin rule body, reused by the contact row and the plugin rows.
    const rowSkin =
      "{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 4px;border-radius:6px;color:inherit;text-decoration:none;transition:background .15s ease}";
    expect(BASE_CSS).toContain(".dsh-base-contact-row" + rowSkin);
    expect(BASE_CSS).toContain(".dsh-base-plugins__row" + rowSkin);
    expect(BASE_CSS).toContain("background:var(--dsw-alias-bg-layer-2,#fff)");
    expect(BASE_CSS).toContain("color:var(--dsw-alias-label-primary,#1f2329)");
    expect(BASE_CSS).toContain("--dsw-alias-label-secondary");
    expect(BASE_CSS).toContain("--dsw-alias-label-tertiary");
    expect(BASE_CSS).toContain("var(--dsw-alias-border-l1,");
    expect(BASE_CSS).toContain("var(--dsw-alias-border-l2,");
  });

  it("themes expired cards, copied numbers and links through host tokens", () => {
    // Warning intent: the expired card and its caption follow the host warning palette.
    expect(BASE_CSS).toContain(
      ".dsh-base-modal__card--expired{background:var(--dsw-alias-state-warn-tertiary,",
    );
    expect(BASE_CSS).toContain("border-color:var(--dsw-alias-state-warn-secondary,");
    expect(BASE_CSS).toContain(
      ".dsh-base-modal__card-expired{margin-top:2px;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-state-warn-label,",
    );
    // Accent intent: copied confirmation, fallback links and focus rings use the brand colour.
    expect(BASE_CSS).toContain(
      ".dsh-base-modal__card-subtitle[data-copied='true']{color:var(--dsw-alias-link,",
    );
    expect(BASE_CSS).toContain("border-radius:8px;color:var(--dsw-alias-link,");
    expect(BASE_CSS).toContain("outline:2px solid var(--dsw-alias-link,");
    // No rule may paint these theme surfaces with a bare literal any more.
    expect(BASE_CSS).not.toContain("background:#fffaf3");
    expect(BASE_CSS).not.toContain("color:#b45309");
    expect(BASE_CSS).not.toContain("color:#4d6bfe}");
    expect(BASE_CSS).not.toContain("background:rgba(0,0,0,.06)");
    expect(BASE_CSS).not.toContain("background:rgba(77,107,254,.08)");
  });
});
