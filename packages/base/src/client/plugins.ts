import type * as ReactNamespace from "react";
import { pickText, sortByOrder } from "../core/index";
import type { Lang, PluginEntry } from "../core/types";
import { ensureBaseStyles } from "./styles";

/**
 * Default row cap of the author plugin card. The list is the five finalised
 * plugins (contact/plugins.json); after dropping the host plugin four remain,
 * so five is a natural ceiling that never hides a sibling by accident.
 */
export const DEFAULT_MAX_ROWS = 5;

/** Options that decide which plugin rows are visible. */
export interface AuthorPluginRowsOptions {
  /** Full plugin list, usually `manifest.plugins`. */
  plugins: readonly PluginEntry[];
  /** Id of the host plugin; excluded unless `showSelf` is on. */
  selfId?: string;
  /** Show the host plugin itself. */
  showSelf?: boolean;
  /** Hard cap on rendered rows (default {@link DEFAULT_MAX_ROWS}). */
  maxRows?: number;
}

/**
 * Visible rows: data order (order asc), host plugin dropped unless asked for,
 * then capped. An undecorated list keeps the exact order of the manifest.
 */
export function selectAuthorPlugins(options: AuthorPluginRowsOptions): PluginEntry[] {
  const cap =
    typeof options.maxRows === "number" && Number.isFinite(options.maxRows)
      ? Math.max(0, Math.floor(options.maxRows))
      : DEFAULT_MAX_ROWS;
  const sorted = sortByOrder(options.plugins);
  const visible =
    options.showSelf || !options.selfId
      ? sorted
      : sorted.filter((plugin) => plugin.id !== options.selfId);
  return visible.slice(0, cap);
}

/**
 * Link target of one row: the explicit `url` when the data provides one,
 * otherwise the canonical GitHub repository page.
 */
export function pluginHref(plugin: PluginEntry): string {
  return plugin.url && plugin.url.length > 0
    ? plugin.url
    : "https://github.com/" + plugin.repo;
}

/** Everything the pure renderer needs; built by createBaseUI's wire-up. */
export interface RenderAuthorPluginsOptions extends AuthorPluginRowsOptions {
  /** Injected runtime: the package never imports React itself. */
  React: typeof ReactNamespace;
  lang: Lang;
  /** Already localised, already overridden card title. */
  title: string;
  className?: string;
}

/**
 * Render the settings-panel card, or null when nothing is left to show: an
 * empty list, a failed manifest, or a list containing only the host plugin
 * must not leave an empty container in the settings page.
 */
export function renderAuthorPlugins(
  options: RenderAuthorPluginsOptions,
): ReactNamespace.ReactElement | null {
  const rows = selectAuthorPlugins(options);
  if (rows.length === 0) return null;
  // The settings panel renders this card without opening the modal, so the
  // card brings the package stylesheet along. Idempotent per document.
  if (typeof document !== "undefined") ensureBaseStyles(document);
  const h = options.React.createElement;
  const className = options.className
    ? "dsh-base-plugins " + options.className
    : "dsh-base-plugins";
  return h(
    "div",
    { className },
    h(
      "h3",
      { className: "dsh-base-plugins__title", key: "title" },
      h(
        "span",
        { className: "dsh-base-plugins__title-icon", key: "icon", "aria-hidden": "true" },
        gridIcon(h, 14),
      ),
      h("span", { className: "dsh-base-plugins__title-text", key: "text" }, options.title),
    ),
    h(
      "ul",
      { className: "dsh-base-plugins__list", key: "list" },
      rows.map((plugin) =>
        h(
          "li",
          { className: "dsh-base-plugins__item", key: plugin.id },
          h(
            "a",
            {
              className: "dsh-base-plugins__row",
              href: pluginHref(plugin),
              target: "_blank",
              rel: "noopener noreferrer",
            },
            h(
              "span",
              { className: "dsh-base-plugins__icon", key: "icon", "aria-hidden": "true" },
              gridIcon(h, 12),
            ),
            h("span", { className: "dsh-base-plugins__name", key: "name" }, plugin.name),
            h(
              "span",
              { className: "dsh-base-plugins__desc", key: "desc" },
              pickText(plugin.desc, options.lang),
            ),
            h(
              "span",
              { className: "dsh-base-plugins__ext", key: "ext", "aria-hidden": "true" },
              externalLinkIcon(h),
            ),
          ),
        ),
      ),
    ),
  );
}

/** 2x2 grid glyph used by the card title (14px) and each row (12px). */
function gridIcon(
  h: typeof ReactNamespace.createElement,
  size: number,
): ReactNamespace.ReactElement {
  return h(
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
    h("rect", { x: 3, y: 3, width: 7, height: 7, rx: 1, key: "tl" }),
    h("rect", { x: 14, y: 3, width: 7, height: 7, rx: 1, key: "tr" }),
    h("rect", { x: 3, y: 14, width: 7, height: 7, rx: 1, key: "bl" }),
    h("rect", { x: 14, y: 14, width: 7, height: 7, rx: 1, key: "br" }),
  );
}

/** Square + diagonal arrow: the "opens in a new tab" affordance. */
function externalLinkIcon(h: typeof ReactNamespace.createElement): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
      key: "box",
    }),
    h("polyline", { points: "15 3 21 3 21 9", key: "arrow" }),
    h("line", { x1: 10, y1: 14, x2: 21, y2: 3, key: "line" }),
  );
}
