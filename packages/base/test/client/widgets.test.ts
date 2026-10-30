// @vitest-environment jsdom
import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBaseUI } from "../../src/client/index";
import { BASELINE } from "../../src/core/index";
import { installDialogPolyfill, resetClientDom } from "./helpers";

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

describe("settings-panel widgets", () => {
  it("opens the modal from the contact button and moves focus back on close", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ContactButton)));

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe("联系我们");

    act(() => button?.click());
    expect(document.querySelector("dialog")).not.toBeNull();

    act(() => document.querySelector<HTMLElement>(".dsh-base-modal__close")?.click());
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("renders the contact row with a button", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ContactRow, { hint: "群聊" })));

    expect(container.textContent).toContain("联系我们");
    expect(container.textContent).toContain("群聊");
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("lists author plugins without the host plugin", () => {
    const ui = createBaseUI(React, { lang: "zh", selfId: "deck", maxRows: 3 });
    act(() => root.render(React.createElement(ui.AuthorPlugins)));

    const items = container.querySelectorAll(".dsh-base-plugins__item");
    expect(items).toHaveLength(3);
    const expected = BASELINE.manifest.plugins
      .filter((plugin) => plugin.id !== "deck")
      .sort((a, b) => a.order - b.order)
      .slice(0, 3)
      .map((plugin) => plugin.name);
    expect(Array.from(items).map((item) => item.querySelector(".dsh-base-plugins__name")?.textContent)).toEqual(expected);
    expect(container.textContent).not.toContain("deck");
  });
});
