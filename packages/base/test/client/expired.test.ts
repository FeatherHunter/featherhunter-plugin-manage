// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createBaseUI } from "../../src/client/index";
import {
  FALLBACK_URL,
  PNG_DATA_URI,
  makeGroup,
  registerBaselineQr,
  resetClientDom,
} from "./helpers";

const NOW = new Date("2024-06-01T12:00:00Z");

beforeEach(() => {
  resetClientDom();
  document.documentElement.lang = "zh-CN";
});

describe("expired and missing QR codes", () => {
  it("degrades an expired group to a fallback link and never renders its code", () => {
    registerBaselineQr("qr-old");
    const resolveQr = vi.fn(() => PNG_DATA_URI);
    const ui = createBaseUI(React);

    ui.openContactModal({
      groups: [makeGroup({ id: "old", validUntil: "2020-01-01" })],
      now: NOW,
      fallbackUrl: FALLBACK_URL,
      resolveQr,
    });

    const card = document.querySelector(".dsh-base-modal__card");
    expect(card?.className).toContain("dsh-base-modal__card--expired");
    // The expired image is not even resolved, let alone rendered.
    expect(resolveQr).not.toHaveBeenCalled();
    expect(document.querySelector("img.dsh-base-modal__qr")).toBeNull();
    expect(card?.textContent).toContain("该二维码已过期");
    const link = card?.querySelector<HTMLAnchorElement>(".dsh-base-modal__card-link");
    expect(link?.getAttribute("href")).toBe(FALLBACK_URL);
    expect(link?.textContent).toContain("点此获取最新群二维码");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("treats validUntil as inclusive: a code is usable through its last day", () => {
    registerBaselineQr("qr-today");
    const ui = createBaseUI(React);

    ui.openContactModal({
      groups: [makeGroup({ id: "today", validUntil: "2024-06-01" })],
      now: NOW,
    });

    const card = document.querySelector(".dsh-base-modal__card");
    expect(card?.className).not.toContain("dsh-base-modal__card--expired");
    expect(card?.querySelector("img.dsh-base-modal__qr")).not.toBeNull();
    expect(card?.querySelector(".dsh-base-modal__card-link")).toBeNull();
    expect(card?.querySelector(".dsh-base-modal__card-note")?.textContent).toContain("该二维码");
  });

  it("falls back to the link when the bundled image is missing", () => {
    const ui = createBaseUI(React);

    ui.openContactModal({
      groups: [makeGroup({ id: "nog", qr: { kind: "bundled", key: "qr-not-registered" } })],
      fallbackUrl: FALLBACK_URL,
    });

    expect(document.querySelector("img.dsh-base-modal__qr")).toBeNull();
    expect(
      document.querySelector<HTMLAnchorElement>(".dsh-base-modal__card-link")?.getAttribute("href"),
    ).toBe(FALLBACK_URL);
  });

  it("renders remote codes through the injected resolver", () => {
    const group = makeGroup({ id: "remote", qr: { kind: "remote", path: "remote.png" } });
    const resolveQr = vi.fn(() => PNG_DATA_URI);
    const ui = createBaseUI(React);

    ui.openContactModal({ groups: [group], resolveQr });

    expect(resolveQr).toHaveBeenCalledWith(group);
    const image = document.querySelector<HTMLImageElement>("img.dsh-base-modal__qr");
    expect(image?.getAttribute("src")).toBe(PNG_DATA_URI);
    expect(document.querySelector(".dsh-base-modal__card-link")).toBeNull();
  });
});
