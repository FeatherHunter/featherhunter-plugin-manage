import type * as ReactNamespace from "react";
import { BASELINE, resolveLang } from "../core/index";
import type { Group, Lang, PluginEntry } from "../core/types";
import {
  createContentLoader,
  type ContentLoader,
  type LoadedContent,
} from "./content";
import { contactIcon, externalLinkIcon } from "./icons";
import { mountContactModal, type ContactModalHandle } from "./modal";
import { renderAuthorPlugins } from "./plugins";
import { resolveText, type TextOverrides } from "./texts";
import type {
  AuthorPluginsProps,
  BaseUI,
  BaseUIOptions,
  ContactButtonProps,
  ContactRowProps,
  OpenContactModalOptions,
  QrResolver,
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

/** Bundled QR source: the baseline data URI, or null when absent. */
function resolveBaselineQr(group: Group): string | null {
  if (group.qr.kind !== "bundled") return null;
  return BASELINE.qr[group.qr.key] ?? null;
}

/**
 * Resolve a card image. Remote codes only use bytes that were prefetched and
 * size-checked by the content loader; anything else degrades to a link.
 */
function resolveGroupQr(
  group: Group,
  content: LoadedContent | null,
  loader: ContentLoader | null,
): string | null {
  if (group.qr.kind === "bundled") return resolveBaselineQr(group);
  if (!content || !loader) return null;
  return loader.imageFor(content, group.qr.path);
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
  let loader: ContentLoader | null = options.contentLoader ?? null;

  /** Lazily build the loader; a host without fetch keeps the baseline only. */
  function getLoader(): ContentLoader | null {
    if (loader) return loader;
    try {
      loader = createContentLoader({
        manifestUrl: options.manifestUrl,
        fetchImpl: options.fetchImpl,
      });
    } catch {
      loader = null;
    }
    return loader;
  }

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

  /** Build the resolver used for one dialog: caller override wins. */
  function buildResolver(
    callOptions: OpenContactModalOptions,
    content: LoadedContent | null,
  ): QrResolver {
    const custom = callOptions.resolveQr ?? options.resolveQr;
    if (custom) return custom;
    return (group: Group) => resolveGroupQr(group, content, loader);
  }

  function applyContent(handle: ContactModalHandle, content: LoadedContent): void {
    if (active !== handle) return;
    const groups =
      content.manifest.groups.length > 0 ? content.manifest.groups : BASELINE.manifest.groups;
    handle.update({
      groups,
      columns: clampColumns(undefined, groups.length),
      fallbackUrl: content.manifest.fallbackUrl,
      resolveQr: (group: Group) =>
        resolveGroupQr(group, content, loader) ?? null,
    });
  }

  /**
   * Fetch the published manifest after the baseline is on screen, prefetch the
   * QR images, then swap the cards in place. Silent on every failure.
   */
  async function refreshRemote(
    handle: ContactModalHandle,
    callOptions: OpenContactModalOptions,
  ): Promise<void> {
    // An explicit group list is an override (hosts, tests): never clobber it.
    if (callOptions.groups && callOptions.groups.length > 0) return;
    const currentLoader = getLoader();
    if (!currentLoader) return;
    const content = await currentLoader.load();
    if (!content || active !== handle) return;
    await currentLoader.ensureImages(content);
    if (active !== handle) return;
    const custom = callOptions.resolveQr ?? options.resolveQr;
    if (custom) {
      handle.update({
        groups: content.manifest.groups,
        columns: clampColumns(callOptions.columns ?? options.columns, content.manifest.groups.length),
        fallbackUrl: content.manifest.fallbackUrl,
        resolveQr: (group: Group) => custom(group) ?? null,
      });
      return;
    }
    applyContent(handle, content);
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
    const cached = getLoader()?.getCached() ?? null;
    const resolver = buildResolver(callOptions, cached);
    const handle = mountContactModal({
      doc: document,
      lang,
      groups,
      columns: clampColumns(callOptions.columns ?? options.columns, groups.length),
      trigger,
      fallbackUrl:
        callOptions.fallbackUrl ??
        options.fallbackUrl ??
        cached?.manifest.fallbackUrl ??
        BASELINE.manifest.fallbackUrl,
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
    void refreshRemote(handle, callOptions);
    return () => {
      if (active === handle) active = null;
      if (sharedModal === handle) sharedModal = null;
      handle.close();
    };
  }

  /**
   * Icon-only trigger: a 16px QR-code outline (14 / 16 / 18 overridable),
   * transparent background, 6px radius. The text lives in ContactRow, so a
   * host that only has room for one square gets the compact control.
   */
  function ContactButton(props: ContactButtonProps): ReactNamespace.ReactElement {
    const h = React.createElement;
    const label = props.title ?? widgetText("contact");
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
      h(
        "span",
        { className: "dsh-base-contact-button__icon", key: "icon", "aria-hidden": "true" },
        contactIcon(h, props.size ?? 16),
      ),
    );
  }

  /**
   * Whole-row variant: one button (icon + label + external-link arrow) using
   * the same row skin as the author plugin rows, for panels that can only
   * place a full row. Keyboard reachable for free because it is a button.
   */
  function ContactRow(props: ContactRowProps): ReactNamespace.ReactElement {
    const h = React.createElement;
    return h(
      "button",
      {
        type: "button",
        className: classes("dsh-base-contact-row", props.className),
        onClick: (event: ReactNamespace.MouseEvent<HTMLButtonElement>) => {
          openContactModal({ trigger: event.currentTarget });
        },
      },
      h(
        "span",
        { className: "dsh-base-contact-row__icon", key: "icon", "aria-hidden": "true" },
        contactIcon(h, 16),
      ),
      h(
        "span",
        { className: "dsh-base-contact-row__label", key: "label" },
        props.label ?? widgetText("contact"),
        props.hint
          ? h("span", { className: "dsh-base-contact-row__hint", key: "hint" }, " · " + props.hint)
          : null,
      ),
      h(
        "span",
        { className: "dsh-base-contact-row__ext", key: "ext", "aria-hidden": "true" },
        externalLinkIcon(h),
      ),
    );
  }

  /**
   * Author plugin card: the bundled baseline paints immediately; after mount
   * the shared content loader silently swaps in the published manifest. An
   * explicit plugins prop means the host owns the data, so no request is made.
   */
  function AuthorPlugins(props: AuthorPluginsProps): ReactNamespace.ReactElement | null {
    const explicitPlugins = props.plugins;
    const [remotePlugins, setRemotePlugins] = React.useState<PluginEntry[] | null>(null);

    React.useEffect(() => {
      if (explicitPlugins !== undefined) return undefined;
      const currentLoader = getLoader();
      if (!currentLoader) return undefined;
      let alive = true;
      void (async () => {
        try {
          const content = await currentLoader.load();
          if (!alive || !content) return;
          const plugins = content.manifest.plugins;
          if (plugins.length === 0) return;
          setRemotePlugins(plugins);
        } catch {
          // Best effort: a failed refresh keeps the bundled baseline rows.
        }
      })();
      return () => {
        alive = false;
      };
    }, [explicitPlugins]);

    const lang = props.lang ?? detectLang(options.lang);
    return renderAuthorPlugins({
      React,
      lang,
      plugins: explicitPlugins ?? remotePlugins ?? BASELINE.manifest.plugins,
      selfId: props.selfId ?? options.selfId,
      showSelf: props.showSelf ?? options.showSelf,
      maxRows: props.maxRows ?? options.maxRows,
      title: props.title ?? resolveText("plugins", lang, options.texts),
      className: props.className,
    });
  }

  /** Warm the manifest and QR images; also refreshes an already open dialog. */
  async function preloadContent(): Promise<void> {
    const currentLoader = getLoader();
    if (!currentLoader) return;
    await currentLoader.preload();
    if (options.resolveQr) return; // caller owns the image resolution
    const content = currentLoader.getCached();
    const handle = active;
    if (!content || !handle) return;
    if (active !== handle) return;
    applyContent(handle, content);
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
export {
  ALLOWED_CDN_HOSTS,
  ContentLoader,
  MANIFEST_CACHE_TTL_MS,
  MANIFEST_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  MAX_MANIFEST_BYTES,
  createContentLoader,
  defaultChannels,
  imageUrls,
  isAllowedCdnUrl,
  isHttpsUrl,
  resetContentCache,
  validateRemoteManifest,
} from "./content";
export type { ContentLoaderOptions, FetchLike, FetchResponseLike, LoadedContent, ManifestChannel } from "./content";