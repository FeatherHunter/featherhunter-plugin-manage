import type * as ReactNamespace from "react";
import { pickText, pluginHref, sortByOrder } from "../core/index";
import type { Lang, PluginEntry } from "../core/types";
import { externalLinkIcon, gridIcon } from "./icons";
import { ensureBaseStyles } from "./styles";

/**
 * Default row cap of the author plugin card. The list is the five finalised
 * plugins (contact/plugins.json); after dropping the host plugin four remain,
 * so five is a natural ceiling that never hides a sibling by accident.
 */
export const DEFAULT_MAX_ROWS = 5;

/** Options that decide which plugin rows are visible. */
export interface AuthorPluginRowsOptions {
  /** Full plugin list, usually manifest.plugins. */
  plugins: readonly PluginEntry[];
  /** Id of the host plugin; excluded unless showSelf is on. */
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

export { pluginHref } from "../core/index";

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
