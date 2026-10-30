import type * as ReactNamespace from "react";
import { BASELINE, pickText, resolveLang, sortByOrder } from "../core/index";
import type { Group, Lang, PluginEntry } from "../core/types";
import { mountContactModal, type ContactModalHandle } from "./modal";
import { resolveText, type TextOverrides } from "./texts";
import type {
  AuthorPluginsProps,
  BaseUI,
  BaseUIOptions,
  ContactButtonProps,
  ContactRowProps,
  OpenContactModalOptions,
} from "./types";

export type * from "./types";

/** Hard ceiling of the contact grid, independent of the data and the caller. */
const MAX_COLUMNS = 4;

/**
 * Only one contact dialog may exist per document, even when the host builds
 * several UI instances (one per settings page, language, ...). Module-level on
 * purpose: the modal owns the top layer and the body scroll lock.
 */
let sharedModal: ContactModalHandle | null = null;

/**
 * Language chain: explicit setting -> page html lang -> navigator.languages ->
 * zh. Evaluated per render / per open so a late <html lang> change is honoured.
 */
function detectLang(explicit?: string | null): Lang {
  return resolveLang({
    explicit: explicit ?? null,
    htmlLang: typeof document === "undefined" ? null : document.documentElement.lang,
    navigatorLanguages: typeof navigator === "undefined" ? null : navigator.languages,
  });
}

/**
 * Resolve the grid column count: the caller may ask for anything, the grid is
 * clamped to 1..4; without an explicit request every group gets a column, up to
 * the ceiling.
 */
function clampColumns(requested: number | undefined, groupCount: number): number {
  if (typeof requested === "number" && Number.isFinite(requested)) {
    return Math.min(MAX_COLUMNS, Math.max(1, Math.floor(requested)));
  }
  return Math.max(1, Math.min(MAX_COLUMNS, groupCount));
}

/** Default QR source: bundled baseline data URI. Remote resolution is ticket 05. */
function resolveBaselineQr(group: Group): string | null {
  if (group.qr.kind !== "bundled") return null;
  return BASELINE.qr[group.qr.key] ?? null;
}

function pluginUrl(plugin: PluginEntry): string {
  return plugin.url ?? "https://github.com/" + plugin.repo;
}

function mergeTexts(overrides?: TextOverrides, extra?: TextOverrides): TextOverrides | undefined {
  if (!overrides && !extra) return undefined;
  return { ...overrides, ...extra };
}

function classes(base: string, extra?: string): string {
  return extra ? base + " " + extra : base;
}

/**
 * Build the settings-panel widgets bound to the injected React runtime.
 *
 * The client bundle never imports React: the host passes its own copy so this
 * package shares the host's reconciler and context.
 */
export function createBaseUI(React: typeof ReactNamespace, options: BaseUIOptions = {}): BaseUI {
  let active: ContactModalHandle | null = null;

  function widgetText(key: Parameters<typeof resolveText>[0]): string {
    return resolveText(key, detectLang(options.lang), options.texts);
  }

  function closeActive(restoreFocus: boolean): void {
    const handle = active;
    active = null;
    if (!handle) return;
    if (sharedModal === handle) sharedModal = null;
    handle.close(restoreFocus);
  }

  function closeContactModal(): void {
    closeActive(true);
  }

  function openContactModal(callOptions: OpenContactModalOptions = {}): () => void {
    if (typeof document === "undefined") return () => {};
    // Replace whatever dialog is open, without bouncing focus back and forth.
    const previous = sharedModal;
    sharedModal = null;
    active = null;
    if (previous) previous.close(false);

    const groups =
      callOptions.groups && callOptions.groups.length > 0
        ? callOptions.groups
        : BASELINE.manifest.groups;
    const lang = detectLang(callOptions.lang ?? options.lang);
    const candidate = callOptions.trigger ?? document.activeElement;
    const trigger =
      candidate && typeof (candidate as HTMLElement).focus === "function"
        ? (candidate as HTMLElement)
        : null;
    const resolver = callOptions.resolveQr ?? options.resolveQr ?? resolveBaselineQr;
    const handle = mountContactModal({
      doc: document,
      lang,
      groups,
      columns: clampColumns(callOptions.columns ?? options.columns, groups.length),
      trigger,
      fallbackUrl:
        callOptions.fallbackUrl ?? options.fallbackUrl ?? BASELINE.manifest.fallbackUrl,
      texts: mergeTexts(options.texts, callOptions.texts),
      resolveQr: (group: Group) => resolver(group) ?? null,
      now: callOptions.now,
    });
    active = handle;
    sharedModal = handle;
    handle.dialog.addEventListener("close", () => {
      if (active === handle) active = null;
      if (sharedModal === handle) sharedModal = null;
    });
    return () => {
      if (active === handle) active = null;
      if (sharedModal === handle) sharedModal = null;
      handle.close();
    };
  }

  function ContactButton(props: ContactButtonProps): ReactNamespace.ReactElement {
    const h = React.createElement;
    const label = props.title ?? widgetText("contact");
    const size = props.size ?? 16;
    const icon = h(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        focusable: "false",
      },
      h("path", { d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", key: "body" }),
      h("circle", { cx: 9, cy: 7, r: 4, key: "head" }),
      h("path", { d: "M23 21v-2a4 4 0 0 0-3-3.87", key: "arm" }),
      h("path", { d: "M16 3.13a4 4 0 0 1 0 7.75", key: "arm2" }),
    );
    return h(
      "button",
      {
        type: "button",
        className: classes("dsh-base-contact-button", props.className),
        title: label,
        "aria-label": label,
        onClick: (event: ReactNamespace.MouseEvent<HTMLButtonElement>) => {
          openContactModal({ trigger: event.currentTarget });
        },
      },
      h("span", { className: "dsh-base-contact-button__icon", key: "icon" }, icon),
      props.iconOnly
        ? null
        : h("span", { className: "dsh-base-contact-button__label", key: "label" }, label),
    );
  }

  function ContactRow(props: ContactRowProps): ReactNamespace.ReactElement {
    const h = React.createElement;
    return h(
      "div",
      { className: classes("dsh-base-contact-row", props.className) },
      h(
        "span",
        { className: "dsh-base-contact-row__label", key: "label" },
        props.label ?? widgetText("contact"),
        props.hint
          ? h("span", { className: "dsh-base-contact-row__hint", key: "hint" }, " · " + props.hint)
          : null,
      ),
      h(ContactButton, { title: props.label ?? widgetText("contact"), key: "button" }),
    );
  }

  function AuthorPlugins(props: AuthorPluginsProps): ReactNamespace.ReactElement | null {
    const h = React.createElement;
    const lang = props.lang ?? detectLang(options.lang);
    const selfId = props.selfId ?? options.selfId;
    const maxRows = props.maxRows ?? options.maxRows ?? 4;
    const all = sortByOrder(props.plugins ?? BASELINE.manifest.plugins);
    const visible = all.filter((plugin) => plugin.id !== selfId).slice(0, Math.max(1, maxRows));
    if (visible.length === 0) return null;
    return h(
      "div",
      { className: classes("dsh-base-plugins", props.className) },
      h(
        "h3",
        { className: "dsh-base-plugins__title", key: "title" },
        props.title ?? resolveText("plugins", lang, options.texts),
      ),
      h(
        "ul",
        { className: "dsh-base-plugins__list", key: "list" },
        visible.map((plugin) =>
          h(
            "li",
            { className: "dsh-base-plugins__item", key: plugin.id },
            h(
              "a",
              {
                className: "dsh-base-plugins__name",
                href: pluginUrl(plugin),
                target: "_blank",
                rel: "noopener noreferrer",
                key: "name",
              },
              plugin.name,
            ),
            h("span", { className: "dsh-base-plugins__desc", key: "desc" }, pickText(plugin.desc, lang)),
          ),
        ),
      ),
    );
  }

  async function preloadContent(): Promise<void> {
    // Ticket 05 adds the three-channel manifest fetch with timeout + cache.
  }

  return {
    ContactButton,
    ContactRow,
    AuthorPlugins,
    openContactModal,
    closeContactModal,
    preloadContent,
  };
}

// Re-export the style helpers so hosts can pre-inject the stylesheet.
export { BASE_CSS, BASE_STYLE_ID, ensureBaseStyles } from "./styles";
export { MESSAGES, resolveText } from "./texts";
export type { TextKey, TextOverrides } from "./texts";
