// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { channelBadge } from "../../src/client/channel-badges";
import { createBaseUI } from "../../src/client/index";
import { resolveText } from "../../src/client/texts";
import { BASELINE, formatValidity } from "../../src/core/index";
import { installDialogPolyfill, resetClientDom } from "./helpers";

let polyfill: ReturnType<typeof installDialogPolyfill>;

beforeEach(() => {
  resetClientDom();
  polyfill = installDialogPolyfill();
  document.documentElement.lang = "zh-CN";
});

function openDialog(
  ui: ReturnType<typeof createBaseUI>,
  options?: Parameters<ReturnType<typeof createBaseUI>["openContactModal"]>[0],
): HTMLDialogElement {
  ui.openContactModal(options);
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("expected a <dialog> element");
  return dialog;
}

describe("contact modal lifecycle", () => {
  it("opens with no arguments, shows the baseline groups and dialog semantics", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    const dialog = openDialog(ui);

    // It went through the native top-layer entry point, not just [open].
    expect(polyfill.showModalCalls()).toHaveLength(1);
    expect(polyfill.showModalCalls()[0]).toBe(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);

    // Dialog semantics.
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy ?? "");
    expect(heading?.tagName).toBe("H2");
    expect(heading?.textContent).toBe("反馈与联系");
    const describedBy = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(describedBy?.tagName).toBe("P");
    expect(describedBy?.textContent).toContain("欢迎提交PR");

    // Copy: kicker, welcome, scan hint, one card per baseline group.
    expect(dialog.textContent).toContain("CONNECT");
    expect(dialog.textContent).toContain("欢迎提交PR");
    expect(dialog.textContent).toContain("扫描二维码加入我们");
    const cards = dialog.querySelectorAll(".dsh-base-modal__card");
    expect(cards).toHaveLength(BASELINE.manifest.groups.length);
    for (const card of cards) {
      expect(card.querySelector("h3")?.textContent?.length).toBeGreaterThan(0);
    }

    // Initial focus lands on the close button, which has an accessible name.
    const close = dialog.querySelector<HTMLElement>(".dsh-base-modal__close");
    expect(close?.getAttribute("aria-label")).toBe("关闭");
    expect(document.activeElement).toBe(close);
  });

  it("locks page scroll while open and restores the previous value after close", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    document.body.style.overflow = "auto";

    ui.openContactModal();
    expect(document.body.style.overflow).toBe("hidden");

    ui.closeContactModal();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("closes from the close button, removes the node and returns focus to the trigger", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    const trigger = document.createElement("button");
    trigger.textContent = "contact";
    document.body.append(trigger);
    trigger.focus();

    ui.openContactModal({ trigger });
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();

    dialog?.querySelector<HTMLElement>(".dsh-base-modal__close")?.click();

    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps a single dialog when opened twice in a row", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    openDialog(ui);
    ui.openContactModal();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
  });

  it("keeps a single dialog across two UI instances", () => {
    const first = createBaseUI(React, { lang: "zh" });
    const second = createBaseUI(React, { lang: "en" });

    first.openContactModal();
    second.openContactModal();

    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.querySelector(".dsh-base-modal__title")?.textContent).toBe("Feedback and Contact");

    first.closeContactModal();
    second.closeContactModal();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("puts the channel badge in front of the card title and drops the redundant WeChat subtitle", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    const now = new Date("2026-11-01T00:00:00+08:00");
    const dialog = openDialog(ui, { now });

    for (const group of BASELINE.manifest.groups) {
      const title = dialog.querySelector<HTMLElement>(
        `[data-group-id="${group.id}"] .dsh-base-modal__card-title`,
      );
      expect(title, "missing title for group " + group.id).not.toBeNull();
      // Badge first, then the visually hidden channel name, then the visible name.
      expect(title?.firstElementChild?.classList.contains("dsh-base-modal__card-badge")).toBe(true);
      const badge = channelBadge(group.platform);
      expect(badge, "missing channel badge for " + group.platform).toBeDefined();
      expect(title?.querySelector(".dsh-base-visually-hidden")?.textContent).toBe(
        resolveText(badge!.labelKey, "zh"),
      );
      expect(title?.querySelector(".dsh-base-modal__card-name")?.textContent).toBe(group.title.zh);
    }

    // WeChat's "群聊：DSH 插件交流群" repeated the title, so it is gone from the card.
    const wechat = dialog.querySelector<HTMLElement>('[data-group-id="wechat"]');
    expect(wechat?.querySelector(".dsh-base-modal__card-subtitle")).toBeNull();
    // QQ keeps its real group number.
    const qq = dialog.querySelector<HTMLElement>('[data-group-id="qq"]');
    expect(qq?.querySelector(".dsh-base-modal__card-subtitle")?.textContent).toContain("1020866453");

    // WeChat's limited-time note is exactly the formatter output: no promise
    // that reopening the dialog refreshes the QR code.
    const wechatGroup = BASELINE.manifest.groups.find((group) => group.id === "wechat");
    const wechatNote =
      wechat?.querySelector<HTMLElement>(".dsh-base-modal__card-note")?.textContent ?? "";
    expect(wechatNote).toBe(formatValidity(wechatGroup?.validUntil, { lang: "zh", now }));
    expect(wechatNote).not.toContain("重新进入");

    // Every card keeps one subtitle slot between title and QR code: the
    // copyable subtitle button when present, an aria-hidden spacer otherwise,
    // so all QR codes start on the same horizontal line.
    for (const card of dialog.querySelectorAll<HTMLElement>(".dsh-base-modal__card")) {
      const slot = card.children.item(1);
      expect(slot, "missing subtitle slot in " + card.dataset.groupId).not.toBeNull();
      const isSubtitle = slot!.classList.contains("dsh-base-modal__card-subtitle");
      const isGap = slot!.classList.contains("dsh-base-modal__card-subtitle-gap");
      expect(isSubtitle || isGap, "unexpected subtitle slot in " + card.dataset.groupId).toBe(true);
      if (isGap) {
        expect(slot!.getAttribute("aria-hidden")).toBe("true");
        expect(slot!.textContent).toBe("");
        expect(slot!.children).toHaveLength(0);
      }
    }
  });
});
