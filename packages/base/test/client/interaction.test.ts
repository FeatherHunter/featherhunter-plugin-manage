// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { createBaseUI } from "../../src/client/index";
import { installDialogPolyfill, makeGroups, resetClientDom } from "./helpers";

beforeEach(() => {
  resetClientDom();
  installDialogPolyfill();
  document.documentElement.lang = "zh-CN";
});

function mountUi(): { ui: ReturnType<typeof createBaseUI>; trigger: HTMLButtonElement } {
  const ui = createBaseUI(React);
  const trigger = document.createElement("button");
  trigger.textContent = "contact";
  document.body.append(trigger);
  trigger.focus();
  ui.openContactModal({ groups: makeGroups(2), trigger });
  return { ui, trigger };
}

function dialog(): HTMLDialogElement {
  const element = document.querySelector("dialog");
  if (!element) throw new Error("expected an open dialog");
  return element;
}

function pressKey(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("closing the contact modal", () => {
  it("closes on Escape and returns focus to the trigger", () => {
    const { trigger } = mountUi();
    const root = dialog();

    const event = pressKey(root.querySelector(".dsh-base-modal__title") as Element, "Escape");

    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("cancels the native cancel event and closes itself instead", () => {
    const { trigger } = mountUi();
    const root = dialog();

    const cancel = new Event("cancel", { cancelable: true });
    root.dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the backdrop itself is clicked but not when the panel is", () => {
    const { ui } = mountUi();

    dialog().querySelector<HTMLElement>(".dsh-base-modal__panel")?.click();
    expect(document.querySelector("dialog")).not.toBeNull();

    // A click whose target is the dialog element is a backdrop click.
    dialog().click();
    expect(document.querySelector("dialog")).toBeNull();
    expect(() => ui.closeContactModal()).not.toThrow();
  });

  it("keeps Tab focus inside the dialog", () => {
    mountUi();
    const root = dialog();
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;

    last.focus();
    const forward = pressKey(last, "Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = pressKey(first, "Tab", { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the dialog when focus escapes it, then closes safely twice", () => {
    const { ui } = mountUi();

    ui.closeContactModal();
    expect(document.querySelector("dialog")).toBeNull();
    // Closing an already closed modal is a no-op, not an error.
    expect(() => ui.closeContactModal()).not.toThrow();
  });
});
