// @vitest-environment jsdom
import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBaseUI } from "../../src/client/index";
import { BASE_CSS } from "../../src/client/styles";
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

function buttons(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".dsh-base-cluster__btn"));
}

function tips(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>(".dsh-base-tip"));
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".dsh-base-cluster__menu");
}

describe("action cluster", () => {
  it("renders one container with three independent coloured buttons, no wrapper", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionCluster)));

    const cluster = container.querySelector<HTMLElement>(".dsh-base-cluster");
    expect(cluster).not.toBeNull();
    expect(cluster?.getAttribute("role")).toBe("group");
    expect(cluster?.getAttribute("aria-label")).toBe("快捷操作");
    // B quiet cluster: no legacy tray class, 4px gap, no HoverTip span wrappers.
    expect(cluster?.className).not.toContain("dsh-base-actions--group");
    expect(cluster?.className).not.toContain("dsh-base-cluster--tray");
    expect((cluster as HTMLElement).style.gap).toBe("4px");
    expect(cluster?.querySelector(".dsh-base-tip-anchor")).toBeNull();
    expect(cluster?.querySelector(".dsh-base-icon-action")).toBeNull();
    // Every direct child is a real control: the buttons are not segments.
    for (const child of Array.from(cluster?.children ?? [])) {
      expect(["BUTTON", "A"]).toContain(child.tagName);
    }

    const [contact, star, issue] = buttons();
    expect(contact.getAttribute("aria-label")).toBe("联系我们");
    expect(contact.getAttribute("data-cluster-item")).toBe("contact");
    expect(star.tagName).toBe("A");
    expect(star.getAttribute("href")).toBe(REPO);
    expect(star.getAttribute("target")).toBe("_blank");
    expect(star.getAttribute("rel")).toBe("noreferrer noopener");
    // Coloured icons, not the 0.1.1 line-art grammar.
    expect(contact.querySelector("svg")?.getAttribute("class")).toContain("dsh-base-cluster__svg--contact");
    expect(contact.querySelector("linearGradient")).not.toBeNull();
    expect(star.querySelector("radialGradient")).not.toBeNull();
    expect(issue.querySelector("linearGradient")).not.toBeNull();
    expect(contact.querySelector("svg")?.getAttribute("fill")).not.toBe("none");
  });

  it("defaults the issue target to the issue list, not /issues/new", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO + "/" });
    act(() => root.render(React.createElement(ui.ActionCluster)));

    const [, , issue] = buttons();
    expect(issue.getAttribute("href")).toBe(ISSUES);
    expect(issue.getAttribute("href")).not.toContain("/issues/new");
  });

  it("keeps the star and issue entries out when no repo is configured", () => {
    const ui = createBaseUI(React, { lang: "zh" });
    act(() => root.render(React.createElement(ui.ActionCluster)));

    expect(buttons()).toHaveLength(1);
    expect(buttons()[0].getAttribute("aria-label")).toBe("联系我们");
  });

  it("honours size and gap props on the buttons and the container", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionCluster, { size: 14, gap: 8 })));

    const [contact] = buttons();
    expect((contact as HTMLElement).style.width).toBe("26px");
    expect((contact as HTMLElement).style.height).toBe("26px");
    expect(container.querySelector<HTMLElement>(".dsh-base-cluster")?.style.gap).toBe("8px");
    expect(contact.querySelector("svg")?.getAttribute("width")).toBe("14");

    act(() => root.render(React.createElement(ui.ActionCluster, { size: 18 })));
    expect((buttons()[0] as HTMLElement).style.width).toBe("30px");
    expect(buttons()[0].querySelector("svg")?.getAttribute("height")).toBe("18");
  });

  it("still offers the legacy tray frame through the variant prop", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionCluster, { variant: "tray" })));

    const cluster = container.querySelector<HTMLElement>(".dsh-base-cluster");
    expect(cluster?.className).toContain("dsh-base-cluster--tray");
    expect(cluster?.className).not.toContain("dsh-base-actions");
  });

  it("opens the contact dialog from the contact button", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionCluster)));

    const [contact] = buttons();
    act(() => {
      contact.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector<HTMLDialogElement>(".dsh-base-modal");
    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute("open")).toBe(true);
  });

  it("shows the shared tooltip with aria-describedby on hover and hides on leave", () => {
    vi.useFakeTimers();
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() => root.render(React.createElement(ui.ActionCluster)));
    const [, star] = buttons();

    act(() => {
      star.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(tips()).toHaveLength(1);
    expect(tips()[0].textContent).toBe("您的🌟是我夜空中最亮的星🌹");
    expect(tips()[0].getAttribute("role")).toBe("tooltip");
    expect(star.getAttribute("aria-describedby")).toBe(tips()[0].id);

    act(() => {
      star.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    expect(tips()).toHaveLength(0);
    expect(star.hasAttribute("aria-describedby")).toBe(false);
  });

  it("supports disabled entries that never fire", () => {
    const onClick = vi.fn();
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() =>
      root.render(
        React.createElement(ui.ActionCluster, {
          items: [
            { id: "contact", icon: ui.clusterIcons.contact(16), label: "联系我们", tip: "tip", onClick, disabled: true },
          ],
        }),
      ),
    );

    const [contact] = buttons();
    expect(contact.tagName).toBe("BUTTON");
    expect(contact.hasAttribute("disabled")).toBe(true);
    act(() => {
      contact.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("collapses entries beyond maxVisible into the more menu", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() =>
      root.render(
        React.createElement(ui.ActionCluster, {
          maxVisible: 3,
          items: [
            { id: "contact", icon: ui.clusterIcons.contact(16), label: "联系我们", tip: "a" },
            { id: "star", icon: ui.clusterIcons.star(16), label: "Star", tip: "b", href: REPO },
            { id: "issue", icon: ui.clusterIcons.issue(16), label: "Issue", tip: "c", href: ISSUES },
            { id: "survey", icon: ui.clusterIcons.issue(16), label: "反馈问卷", tip: "d", href: REPO + "/discussions" },
          ],
        }),
      ),
    );

    const controls = buttons();
    expect(controls).toHaveLength(4);
    expect(controls[3].getAttribute("aria-label")).toBe("更多操作");
    expect(controls[3].getAttribute("aria-haspopup")).toBe("menu");
    expect(controls[3].getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();

    act(() => {
      controls[3].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const opened = menu();
    expect(opened).not.toBeNull();
    expect(controls[3].getAttribute("aria-expanded")).toBe("true");
    expect(opened?.textContent).toContain("反馈问卷");
    expect(opened?.querySelectorAll("[role='menuitem']")).toHaveLength(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(menu()).toBeNull();
  });

  it("closes the more menu on an outside pointerdown", () => {
    const ui = createBaseUI(React, { lang: "zh", repoUrl: REPO });
    act(() =>
      root.render(
        React.createElement(ui.ActionCluster, {
          maxVisible: 1,
          items: [
            { id: "contact", icon: ui.clusterIcons.contact(16), label: "联系我们", tip: "a" },
            { id: "star", icon: ui.clusterIcons.star(16), label: "Star", tip: "b", href: REPO },
          ],
        }),
      ),
    );

    const more = buttons()[1];
    act(() => {
      more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(menu()).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it("uses the English copy for the group and overflow labels", () => {
    const ui = createBaseUI(React, { lang: "en", repoUrl: REPO });
    act(() =>
      root.render(
        React.createElement(ui.ActionCluster, {
          maxVisible: 1,
          items: [
            { id: "contact", icon: ui.clusterIcons.contact(16), label: "Contact us", tip: "a" },
            { id: "star", icon: ui.clusterIcons.star(16), label: "Star", tip: "b", href: REPO },
          ],
        }),
      ),
    );

    expect(container.querySelector(".dsh-base-cluster")?.getAttribute("aria-label")).toBe("Quick actions");
    expect(buttons()[1].getAttribute("aria-label")).toBe("More actions");
  });

  it("ships the quiet-cluster stylesheet contract", () => {
    expect(BASE_CSS).toContain(".dsh-base-cluster{");
    expect(BASE_CSS).toContain("gap:var(--dsh-base-cluster-gap,4px)");
    expect(BASE_CSS).toContain(".dsh-base-cluster__btn--contact{--dsh-base-glow:rgba(79,139,255,.55)}");
    expect(BASE_CSS).toContain("@keyframes dsh-base-cluster-twinkle");
    expect(BASE_CSS).toContain("@keyframes dsh-base-cluster-floaty");
    expect(BASE_CSS).toContain("@keyframes dsh-base-cluster-wiggle");
    expect(BASE_CSS).toContain("prefers-reduced-motion");
    expect(BASE_CSS).toContain(".dsh-base-cluster__btn svg *{animation:none!important");
    // The container never answers hover: no rule targets .dsh-base-cluster:hover.
    expect(BASE_CSS).not.toContain(".dsh-base-cluster:hover");
    // No grey fill on hover/active: the motion + glow replace the old skin.
    expect(BASE_CSS).not.toContain(".dsh-base-cluster__btn:hover{background");
  });
});
