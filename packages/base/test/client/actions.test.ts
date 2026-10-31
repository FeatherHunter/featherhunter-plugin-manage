// @vitest-environment jsdom
import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBaseUI } from "../../src/client/index";
import { installDialogPolyfill, resetClientDom } from "./helpers";

const REPO = "https://github.com/FeatherHunter/dsh-mattpocock-skills-deck";
const ISSUES = "https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues";

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
  vi.useRealTimers();
});

function controls(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".dsh-base-icon-action"));
}

function tips(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>(".dsh-base-tip"));
}

describe("header actions", () => {
  it("renders contact, star and issue in that order with their own links", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionButtons)));

    const [contact, star, issue] = controls();
    expect(contact.tagName).toBe("BUTTON");
    expect(contact.getAttribute("aria-label")).toBe("联系我们");
    expect(star.tagName).toBe("A");
    expect(star.getAttribute("href")).toBe(REPO);
    expect(star.getAttribute("target")).toBe("_blank");
    expect(star.getAttribute("aria-label")).toBe("Star 这个项目");
    expect(issue.getAttribute("href")).toBe(ISSUES);
    expect(issue.getAttribute("aria-label")).toBe("提交 Issue");
    // Every icon is deck-style line art: 24px grid, currentColor, no fill.
    for (const control of controls()) {
      const svg = control.querySelector("svg");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg?.getAttribute("fill")).toBe("none");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
    }
  });

  it("hides star and issue when no repo URL is configured", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ActionButtons)));

    expect(controls()).toHaveLength(1);
    expect(controls()[0].getAttribute("aria-label")).toBe("联系我们");
  });

  it("derives the issues URL from the repo URL and trims trailing slashes", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ActionButtons, { repoUrl: REPO + "/" })));

    const [, , issue] = controls();
    expect(issue.getAttribute("href")).toBe(ISSUES);
  });

  it("loads its links, sizes and English copy from the component props", () => {
    const ui = createBaseUI(React, { lang: "en", repoUrl: "https://example.com/other-repo" });
    act(() =>
      root.render(
        React.createElement(ui.ActionButtons, {
          size: 18,
          issuesUrl: "https://example.com/tracker",
        }),
      ),
    );

    const [contact, star, issue] = controls();
    expect(star.getAttribute("href")).toBe("https://example.com/other-repo");
    expect(issue.getAttribute("href")).toBe("https://example.com/tracker");
    expect(star.getAttribute("aria-label")).toBe("Star this project");
    expect(issue.getAttribute("aria-label")).toBe("Open an issue");
    expect(contact.querySelector("svg")?.getAttribute("width")).toBe("18");
  });

  it("packs all three into one bordered capsule", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionGroup)));

    const group = container.querySelector<HTMLElement>(".dsh-base-actions--group");
    expect(group).not.toBeNull();
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.getAttribute("aria-label")).toBe("联系、Star 与 Issue");
    expect(group?.children).toHaveLength(3);
    expect(group?.querySelectorAll(".dsh-base-icon-action")).toHaveLength(3);
  });
});

describe("hover tips", () => {
  it("shows the designed copy above each action on hover and hides on leave", async () => {
    vi.useFakeTimers();
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionButtons)));
    const [, star] = controls();

    act(() => {
      star.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(tips()).toHaveLength(1);
    expect(tips()[0].textContent).toBe("您的🌟是我夜空中最亮的星🌹");
    expect(tips()[0].getAttribute("role")).toBe("tooltip");

    act(() => {
      star.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    expect(tips()).toHaveLength(0);
  });

  it("keeps a single tooltip alive across triggers", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionButtons)));
    const [contact, star] = controls();

    act(() => {
      contact.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(tips()).toHaveLength(1);
    expect(tips()[0].textContent).toBe("扫码加入交流群，反馈、建议、idea 都欢迎");

    act(() => {
      contact.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      star.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(tips()).toHaveLength(1);
    expect(tips()[0].textContent).toBe("您的🌟是我夜空中最亮的星🌹");
  });

  it("ships a public controlled HoverTip that Escape dismisses", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() =>
      root.render(
        React.createElement(
          ui.HoverTip,
          { content: "任何功能需求、故障、建议、意见都可以提 ISSUE", visible: true },
          React.createElement("button", { type: "button" }, "issue"),
        ),
      ),
    );

    expect(tips()).toHaveLength(1);
    expect(tips()[0].textContent).toBe("任何功能需求、故障、建议、意见都可以提 ISSUE");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(tips()).toHaveLength(0);
  });
});
