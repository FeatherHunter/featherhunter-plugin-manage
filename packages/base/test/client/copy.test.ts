// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { createBaseUI } from "../../src/client/index";
import {
  installClipboard,
  makeGroup,
  registerBaselineQr,
  removeClipboard,
  resetClientDom,
} from "./helpers";

beforeEach(() => {
  resetClientDom();
  document.documentElement.lang = "zh-CN";
});

afterEach(() => {
  removeClipboard();
});

function openOne(): ReturnType<typeof createBaseUI> {
  registerBaselineQr("qr-copy");
  const ui = createBaseUI(React);
  ui.openContactModal({ groups: [makeGroup({ id: "copy" })] });
  return ui;
}

describe("copying the group id", () => {
  it("copies the subtitle to the clipboard and marks the button", async () => {
    const clipboard = installClipboard();
    openOne();

    const button = document.querySelector<HTMLButtonElement>(".dsh-base-modal__card-subtitle");
    expect(button?.textContent).toBe("群号：copy");
    button?.click();

    expect(clipboard.writeText).toHaveBeenCalledWith("群号：copy");
    await Promise.resolve();
    await Promise.resolve();
    expect(button?.dataset.copied).toBe("true");
    expect(button?.getAttribute("aria-label")).toBe("已复制");
  });

  it("selects the text when the clipboard API is unavailable", () => {
    removeClipboard();
    openOne();

    const button = document.querySelector<HTMLButtonElement>(".dsh-base-modal__card-subtitle");
    button?.click();

    expect(window.getSelection()?.toString()).toContain("群号：copy");
  });
});
