import { formatValidity, isExpired, pickText, sortByOrder } from "../core/index";
import type { Group, Lang } from "../core/types";
import { channelBadge, createChannelBadge } from "./channel-badges";
import { ensureBaseStyles } from "./styles";
import { resolveText, type TextKey, type TextOverrides } from "./texts";

/** Everything the modal needs; built by createBaseUI's openContactModal. */
export interface ContactModalConfig {
  doc: Document;
  lang: Lang;
  groups: readonly Group[];
  /** Already clamped to 1..4 columns (and to the group count). */
  columns: number;
  trigger: HTMLElement | null;
  fallbackUrl: string;
  texts?: TextOverrides;
  /** Returns null when no image is available (card degrades to a link). */
  resolveQr: (group: Group) => string | null;
  /** Clock override for date-dependent validity text. */
  now?: Date;
}

export interface ContactModalUpdate {
  groups?: readonly Group[];
  /** Already clamped to 1..4 columns. */
  columns?: number;
  /** Returns null when no image is available (card degrades to a link). */
  resolveQr?: (group: Group) => string | null;
  fallbackUrl?: string;
  now?: Date;
}

export interface ContactModalHandle {
  dialog: HTMLDialogElement;
  /** Destroy the dialog; restore focus by default. */
  close: (restoreFocus?: boolean) => void;
  /**
   * Re-render the group cards in place. Used when the remote manifest arrives
   * after the baseline was painted, so the dialog is never rebuilt.
   */
  update: (next: ContactModalUpdate) => void;
}

const TITLE_ID = "dsh-base-modal-title";
const DESC_ID = "dsh-base-modal-desc";
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Build the contact dialog, enter it into the top layer with showModal() and
 * wire the close paths (Esc, backdrop, close button). The dialog element is
 * the public seam: tests and hosts can query it in the document.
 */
export function mountContactModal(config: ContactModalConfig): ContactModalHandle {
  const { doc, lang } = config;
  const win = doc.defaultView;
  let current = config;
  const t = (key: TextKey): string => resolveText(key, lang, config.texts);
  ensureBaseStyles(doc);

  const dialog = doc.createElement("dialog");
  dialog.className = "dsh-base-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", TITLE_ID);
  dialog.setAttribute("aria-describedby", DESC_ID);

  const panel = doc.createElement("div");
  panel.className = "dsh-base-modal__panel";

  // Header: centered CONNECT kicker + title, close button in the corner.
  const header = doc.createElement("div");
  header.className = "dsh-base-modal__header";
  const heading = doc.createElement("div");
  heading.className = "dsh-base-modal__heading";
  const kicker = doc.createElement("span");
  kicker.className = "dsh-base-modal__kicker";
  kicker.textContent = t("kicker");
  const title = doc.createElement("h2");
  title.id = TITLE_ID;
  title.className = "dsh-base-modal__title";
  title.textContent = t("modalTitle");
  heading.append(kicker, title);
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "dsh-base-modal__close";
  closeButton.setAttribute("aria-label", t("close"));
  closeButton.title = t("close");
  closeButton.textContent = "×";
  header.append(heading, closeButton);

  const welcome = doc.createElement("p");
  welcome.id = DESC_ID;
  welcome.className = "dsh-base-modal__welcome";
  welcome.textContent = t("welcome");

  // Group cards, in data order, columns announced through a CSS variable so
  // the narrow-screen media queries can still override the layout.
  const body = doc.createElement("div");
  body.className = "dsh-base-modal__body";
  const grid = doc.createElement("div");
  grid.className = "dsh-base-modal__grid";
  function renderGroups(groups: readonly Group[], columns: number): void {
    grid.style.setProperty("--dsh-base-columns", String(columns));
    grid.replaceChildren(...sortByOrder(groups).map((group) => buildCard(group)));
  }

  renderGroups(current.groups, current.columns);
  body.append(grid);

  const footer = doc.createElement("div");
  footer.className = "dsh-base-modal__footer";
  const scanHint = doc.createElement("span");
  scanHint.className = "dsh-base-modal__hint";
  scanHint.textContent = t("scanHint");
  const mobileHint = doc.createElement("span");
  mobileHint.className = "dsh-base-modal__mobile-hint";
  mobileHint.textContent = t("mobileHint");
  footer.append(scanHint, mobileHint);

  panel.append(header, welcome, body, footer);
  dialog.append(panel);

  // Lock page scroll while the modal is open; restore the exact prior value.
  const previousOverflow = doc.body.style.overflow;
  doc.body.style.overflow = "hidden";

  let closed = false;

  function destroy(restoreFocus = true): void {
    if (closed) return;
    closed = true;
    if (typeof dialog.close === "function" && dialog.hasAttribute("open")) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute("open");
      }
    }
    // Only undo the scroll lock if we still own the DOM: a host that wiped the
    // body (teardown, route change) already ended the lock, and restoring here
    // would clobber whatever the new page set.
    if (dialog.isConnected) {
      dialog.remove();
      doc.body.style.overflow = previousOverflow;
    }
    if (
      restoreFocus &&
      config.trigger &&
      config.trigger.isConnected &&
      typeof config.trigger.focus === "function"
    ) {
      config.trigger.focus();
    }
  }

  function trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => !element.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = doc.activeElement;
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      destroy(true);
      return;
    }
    if (event.key === "Tab") trapFocus(event);
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    destroy(true);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) destroy(true);
  });
  dialog.addEventListener("close", () => destroy(true));
  closeButton.addEventListener("click", () => destroy(true));

  doc.body.append(dialog);
  let inTopLayer = false;
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
      inTopLayer = true;
    } catch {
      inTopLayer = false;
    }
  }
  if (!inTopLayer) dialog.setAttribute("open", "");
  closeButton.focus();

  function buildCard(group: Group): HTMLElement {
    const card = doc.createElement("div");
    card.className = "dsh-base-modal__card";
    card.dataset.groupId = group.id;

    const expired = isExpired(group.validUntil, current.now);
    if (expired) card.classList.add("dsh-base-modal__card--expired");
    const qrSrc = expired ? null : current.resolveQr(group);

    const cardTitle = doc.createElement("h3");
    cardTitle.className = "dsh-base-modal__card-title";
    const badge = channelBadge(group.platform);
    if (badge) {
      cardTitle.append(createChannelBadge(doc, badge));
      const channel = doc.createElement("span");
      channel.className = "dsh-base-visually-hidden";
      channel.textContent = t(badge.labelKey);
      cardTitle.append(channel);
    }
    const cardName = doc.createElement("span");
    cardName.className = "dsh-base-modal__card-name";
    cardName.textContent = pickText(group.title, lang);
    cardTitle.append(cardName);
    card.append(cardTitle);

    if (group.subtitle) {
      const subtitle = doc.createElement("button");
      subtitle.type = "button";
      subtitle.className = "dsh-base-modal__card-subtitle";
      subtitle.textContent = pickText(group.subtitle, lang);
      subtitle.title = t("copyHint");
      subtitle.addEventListener("click", () => copyText(subtitle, subtitle.textContent ?? ""));
      card.append(subtitle);
    } else {
      // Reserve the subtitle row on cards without one, so every QR code starts
      // on the same line (WeChat's redundant subtitle was removed).
      const gap = doc.createElement("span");
      gap.className = "dsh-base-modal__card-subtitle-gap";
      gap.setAttribute("aria-hidden", "true");
      card.append(gap);
    }

    if (qrSrc) {
      const image = doc.createElement("img");
      image.className = "dsh-base-modal__qr";
      image.src = qrSrc;
      image.alt = pickText(group.alt, lang);
      image.loading = "lazy";
      image.decoding = "async";
      card.append(image);
    }

    if (expired) {
      const note = doc.createElement("span");
      note.className = "dsh-base-modal__card-expired";
      note.textContent = t("expired");
      card.append(note);
    } else {
      const validity = formatValidity(group.validUntil, { lang, now: current.now });
      const noteText = validity ?? (group.note ? pickText(group.note, lang) : null);
      if (noteText) {
        const note = doc.createElement("span");
        note.className = "dsh-base-modal__card-note";
        note.textContent = noteText;
        card.append(note);
      }
    }

    if (!qrSrc) {
      const link = doc.createElement("a");
      link.className = "dsh-base-modal__card-link";
      link.href = current.fallbackUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = t("fallback");
      card.append(link);
    }
    return card;
  }

  function copyText(button: HTMLButtonElement, text: string): void {
    const markCopied = (): void => {
      button.dataset.copied = "true";
      button.setAttribute("aria-label", t("copied"));
    };
    const selectText = (): void => {
      const selection = win?.getSelection?.();
      if (!selection) return;
      const range = doc.createRange();
      range.selectNodeContents(button);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const clipboard = win?.navigator?.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      void clipboard.writeText(text).then(markCopied, selectText);
    } else {
      selectText();
    }
  }

  function update(next: ContactModalUpdate): void {
    if (closed) return;
    current = { ...current, ...next };
    renderGroups(current.groups, current.columns);
  }

  return {
    dialog,
    close: (restoreFocus = true) => destroy(restoreFocus),
    update,
  };
}