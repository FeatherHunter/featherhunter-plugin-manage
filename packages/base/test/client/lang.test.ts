// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { createBaseUI } from "../../src/client/index";
import { makeGroups, resetClientDom } from "./helpers";

let originalLanguages: PropertyDescriptor | undefined;

function setNavigatorLanguages(languages: string[]): void {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    value: languages,
  });
}

beforeEach(() => {
  resetClientDom();
  originalLanguages = Object.getOwnPropertyDescriptor(window.navigator, "languages");
  document.documentElement.removeAttribute("lang");
  setNavigatorLanguages([]);
});

afterEach(() => {
  if (originalLanguages) {
    Object.defineProperty(window.navigator, "languages", originalLanguages);
  }
});

function modalTitle(): string | null {
  return document.querySelector(".dsh-base-modal__title")?.textContent ?? null;
}

function openWith(ui: ReturnType<typeof createBaseUI>): void {
  ui.openContactModal({ groups: makeGroups(1) });
}

describe("language fallback chain", () => {
  it("uses the explicit setting first", () => {
    document.documentElement.lang = "zh-CN";
    setNavigatorLanguages(["zh-CN"]);
    const ui = createBaseUI(React, { lang: "en" });

    openWith(ui);

    expect(modalTitle()).toBe("Feedback and Contact");
  });

  it("falls back to the html lang attribute", () => {
    document.documentElement.lang = "en-US";
    setNavigatorLanguages(["zh-CN"]);
    const ui = createBaseUI(React);

    openWith(ui);

    expect(modalTitle()).toBe("Feedback and Contact");
  });

  it("falls back to navigator.languages when the page has no lang", () => {
    setNavigatorLanguages(["fr-FR", "en-GB"]);
    const ui = createBaseUI(React);

    openWith(ui);

    expect(modalTitle()).toBe("Feedback and Contact");
  });

  it("falls back to Chinese when nothing matches", () => {
    setNavigatorLanguages(["fr-FR"]);
    const ui = createBaseUI(React);

    openWith(ui);

    expect(modalTitle()).toBe("反馈与联系");
  });

  it("lets a single open call override the instance language", () => {
    const ui = createBaseUI(React, { lang: "en" });

    ui.openContactModal({ groups: makeGroups(1), lang: "zh" });

    expect(modalTitle()).toBe("反馈与联系");
  });

  it("applies text overrides on top of the detected language", () => {
    const ui = createBaseUI(React, { lang: "zh", texts: { modalTitle: "找到我们", scanHint: "扫码进群" } });

    openWith(ui);

    expect(modalTitle()).toBe("找到我们");
    expect(document.querySelector(".dsh-base-modal__hint")?.textContent).toBe("扫码进群");
    // Untouched keys keep the built-in copy.
    expect(document.querySelector(".dsh-base-modal__welcome")?.textContent).toContain("欢迎提交PR");
  });
});
