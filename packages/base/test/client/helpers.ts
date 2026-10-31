import { vi } from "vitest";
import { resetContentCache } from "../../src/client/content";
import { BASE_STYLE_ID } from "../../src/client/styles";
import { BASELINE } from "../../src/core/index";
import type { Group } from "../../src/core/types";

/**
 * jsdom does not implement HTMLDialogElement.showModal / close. The modal code
 * is only allowed to rely on browser behaviour, so the tests install a minimal
 * polyfill and record showModal() calls as an observable behaviour.
 */
export interface DialogPolyfill {
  showModalCalls: () => HTMLDialogElement[];
  resetShowModalCalls: () => void;
}

export function installDialogPolyfill(): DialogPolyfill {
  const calls: HTMLDialogElement[] = [];
  const proto =
    typeof window.HTMLDialogElement === "function"
      ? window.HTMLDialogElement.prototype
      : window.HTMLElement.prototype;

  Object.defineProperty(proto, "showModal", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      calls.push(this);
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(proto, "show", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(proto, "close", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
  Object.defineProperty(proto, "requestClose", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      this.dispatchEvent(new Event("cancel", { cancelable: true }));
    },
  });

  return {
    showModalCalls: () => calls,
    resetShowModalCalls: () => {
      calls.length = 0;
    },
  };
}

/** A real 1x1 PNG, used so <img src> can carry a plausible data URI. */
export const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const FALLBACK_URL = "https://example.com/fallback";

export function makeGroup(overrides: Partial<Group> & Pick<Group, "id">): Group {
  const { id, ...rest } = overrides;
  return {
    id,
    platform: id,
    order: 10,
    readmeTitle: { zh: id + " 群", en: id + " group" },
    alt: { zh: id + " 二维码", en: id + " QR code" },
    card: "card-" + id + ".png",
    qr: { kind: "bundled", key: "qr-" + id },
    title: { zh: "交流群 " + id, en: "Community " + id },
    subtitle: { zh: "群号：" + id, en: "Group ID: " + id },
    note: { zh: "该二维码永久有效", en: "This QR code never expires" },
    ...rest,
  };
}

export function registerBaselineQr(key: string, src: string = PNG_DATA_URI): void {
  BASELINE.qr[key] = src;
}

export function makeGroups(count: number): Group[] {
  return Array.from({ length: count }, (_, index) => {
    const image = "qr-fixture-" + index;
    registerBaselineQr(image);
    return makeGroup({
      id: "g" + index,
      order: (index + 1) * 10,
      qr: { kind: "bundled", key: image },
      title: { zh: "群组 " + index, en: "Group " + index },
    });
  });
}

export function installClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return { writeText };
}

export function removeClipboard(): void {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
}

/**
 * Fail every network request by default: the contact modal refreshes the remote
 * manifest on open, and unit tests must never reach the real CDN.
 */
export function installOfflineFetch(): void {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: () => Promise.reject(new Error("network disabled in tests")),
  });
}

/** Reset the document between tests without leaking injected styles. */
export function resetClientDom(): void {
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  document.documentElement.removeAttribute("lang");
  document.getElementById(BASE_STYLE_ID)?.remove();
  resetContentCache();
  installOfflineFetch();
}
