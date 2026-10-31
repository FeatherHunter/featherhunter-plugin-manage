// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { createBaseUI } from "../../src/client/index";
import { BASE_CSS } from "../../src/client/styles";
import { makeGroups, resetClientDom } from "./helpers";

beforeEach(() => {
  resetClientDom();
  document.documentElement.lang = "zh-CN";
});

function gridOf(ui: ReturnType<typeof createBaseUI>): HTMLElement {
  const grid = document.querySelector<HTMLElement>(".dsh-base-modal__grid");
  if (!grid) throw new Error("expected a modal grid");
  return grid;
}

describe("contact grid layout", () => {
  it("defaults to one column per group, capped at four", () => {
    const ui = createBaseUI(React);

    ui.openContactModal({ groups: makeGroups(3) });
    expect(gridOf(ui).style.getPropertyValue("--dsh-base-columns")).toBe("3");
    ui.closeContactModal();

    ui.openContactModal({ groups: makeGroups(7) });
    expect(gridOf(ui).style.getPropertyValue("--dsh-base-columns")).toBe("4");
  });

  it("honours the columns option below the ceiling and clamps hard above it", () => {
    const ui = createBaseUI(React);
    const groups = makeGroups(7);

    ui.openContactModal({ groups, columns: 2 });
    expect(gridOf(ui).style.getPropertyValue("--dsh-base-columns")).toBe("2");
    ui.closeContactModal();

    // The ceiling is hard: asking for 9 columns yields 4, not 7 and not 9.
    ui.openContactModal({ groups, columns: 9 });
    expect(gridOf(ui).style.getPropertyValue("--dsh-base-columns")).toBe("4");
    ui.closeContactModal();

    // Garbage columns degrade to the smallest sensible grid instead of NaN.
    ui.openContactModal({ groups, columns: 0 });
    expect(gridOf(ui).style.getPropertyValue("--dsh-base-columns")).toBe("1");
  });

  it("lays the grid out with the column variable and collapses on narrow screens", () => {
    const compact = BASE_CSS.replace(/\s+/g, "");

    expect(compact).toContain("grid-template-columns:repeat(var(--dsh-base-columns,4),minmax(0,1fr))");
    // Under 720px the grid drops to two columns, under 480px to a single one.
    expect(compact).toMatch(
      /@media\(max-width:719px\)\{\.dsh-base-modal__grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/,
    );
    expect(compact).toMatch(
      /@media\(max-width:479px\)\{\.dsh-base-modal__grid\{grid-template-columns:minmax\(0,1fr\)\}\}/,
    );
  });

  it("sizes the panel like the README cards, with a scrollable body", () => {
    const compact = BASE_CSS.replace(/\s+/g, "");

    expect(compact).toContain("width:min(800px,92vw)");
    expect(compact).toContain(".dsh-base-modal__body{");
    expect(compact).toMatch(/\.dsh-base-modal__body\{[^}]*overflow:auto/);
    expect(compact).toMatch(/\.dsh-base-modal__qr\{[^}]*width:100%/);
    // The white 6px quiet zone must live inside the column: content-box padded the
    // image 12px wider than its cell and pushed the QR off-centre to the right.
    expect(compact).toMatch(/\.dsh-base-modal__qr\{[^}]*box-sizing:border-box/);
    expect(compact).toMatch(/\.dsh-base-modal__qr\{[^}]*max-width:100%/);
    expect(compact).toContain("image-rendering:pixelated");
  });
});
