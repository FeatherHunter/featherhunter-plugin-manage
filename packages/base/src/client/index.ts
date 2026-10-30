import type * as ReactNamespace from "react";
import { BASELINE, formatValidity, resolveLang, sortByOrder } from "../core/index";
import type { Group, Lang, PluginEntry } from "../core/types";
import type {
  AuthorPluginsProps,
  BaseUI,
  BaseUIOptions,
  ContactButtonProps,
  ContactRowProps,
  OpenContactModalOptions,
} from "./types";
import { ensureBaseStyles } from "./styles";

export type * from "./types";

const TEXTS = {
  zh: {
    contact: "联系我们",
    contactHint: "加入交流群",
    modalTitle: "联系作者",
    close: "关闭",
    expired: "二维码已过期，请点击下方链接加入",
    fallback: "二维码过期或无法显示？点此加入",
    plugins: "作者的其他插件",
  },
  en: {
    contact: "Contact us",
    contactHint: "Join the community",
    modalTitle: "Contact the author",
    close: "Close",
    expired: "This QR code has expired. Use the link below.",
    fallback: "QR code expired or not showing? Join here",
    plugins: "More plugins by the author",
  },
} as const;

type TextKey = keyof (typeof TEXTS)["zh"];

interface RuntimeOptions extends BaseUIOptions {
  lang: Lang;
}

function pluginUrl(plugin: PluginEntry): string {
  return plugin.url ?? `https://github.com/${plugin.repo}`;
}

/**
 * Build the settings-panel widgets bound to the injected React runtime.
 *
 * The client bundle never imports React: the host passes its own copy so this
 * package shares the host's reconciler and context.
 */
export function createBaseUI(React: typeof ReactNamespace, options: BaseUIOptions = {}): BaseUI {
  const runtime: RuntimeOptions = { ...options, lang: resolveLang({ explicit: options.lang }) };
  let activeDialog: HTMLDialogElement | null = null;
  let activeTrigger: HTMLElement | null = null;

  function text(key: TextKey, override?: Partial<Record<string, string>>): string {
    const custom = override?.[key];
    if (typeof custom === "string" && custom.length > 0) return custom;
    return TEXTS[runtime.lang][key];
  }

  function closeContactModal(): void {
    if (!activeDialog) return;
    const dialog = activeDialog;
    activeDialog = null;
    if (typeof dialog.close === "function") dialog.close();
    dialog.remove();
    if (activeTrigger && typeof activeTrigger.focus === "function") {
      activeTrigger.focus();
    }
    activeTrigger = null;
  }

  function buildDialog(opts: OpenContactModalOptions): HTMLDialogElement {
    const lang = opts.lang ?? runtime.lang;
    const doc = document;
    const dialog = doc.createElement("dialog");
    dialog.className = "dsh-base-modal";
    const panel = doc.createElement("div");
    panel.className = "dsh-base-modal__panel";
    const header = doc.createElement("div");
    header.className = "dsh-base-modal__header";
    const title = doc.createElement("h2");
    title.className = "dsh-base-modal__title";
    title.textContent = text("modalTitle", opts.texts);
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "dsh-base-modal__close";
    close.setAttribute("aria-label", text("close", opts.texts));
    close.textContent = "×";
    close.addEventListener("click", () => closeContactModal());
    header.append(title, close);

    const body = doc.createElement("div");
    body.className = "dsh-base-modal__body";
    const grid = doc.createElement("div");
    grid.className = "dsh-base-modal__grid";
    const groups: Group[] = opts.groups ?? BASELINE.manifest.groups;
    for (const group of sortByOrder(groups)) {
      const card = doc.createElement("div");
      card.className = "dsh-base-modal__card";
      card.dataset.groupId = group.id;
      const cardTitle = doc.createElement("h3");
      cardTitle.className = "dsh-base-modal__card-title";
      cardTitle.textContent = group.title[lang] ?? group.title.zh;
      card.append(cardTitle);
      if (group.subtitle) {
        const subtitle = doc.createElement("span");
        subtitle.className = "dsh-base-modal__card-subtitle";
        subtitle.textContent = group.subtitle[lang] ?? group.subtitle.zh;
        card.append(subtitle);
      }
      const validity = formatValidity(group.validUntil, { lang });
      if (validity) {
        const note = doc.createElement("span");
        note.className = "dsh-base-modal__card-note";
        note.textContent = validity;
        card.append(note);
      } else if (group.validUntil) {
        const expired = doc.createElement("span");
        expired.className = "dsh-base-modal__card-expired";
        expired.textContent = text("expired", opts.texts);
        card.append(expired);
      } else if (group.note) {
        const note = doc.createElement("span");
        note.className = "dsh-base-modal__card-note";
        note.textContent = group.note[lang] ?? group.note.zh;
        card.append(note);
      }
      grid.append(card);
    }
    body.append(grid);

    const footer = doc.createElement("div");
    footer.className = "dsh-base-modal__footer";
    const link = doc.createElement("a");
    link.href = opts.fallbackUrl ?? BASELINE.manifest.fallbackUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text("fallback", opts.texts);
    footer.append(link);

    panel.append(header, body, footer);
    dialog.append(panel);
    return dialog;
  }

  function openContactModal(opts: OpenContactModalOptions = {}): () => void {
    if (typeof document === "undefined") return () => {};
    closeContactModal();
    ensureBaseStyles(document);
    const dialog = buildDialog(opts);
    activeDialog = dialog;
    activeTrigger = opts.trigger ?? null;
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeContactModal();
    });
    dialog.addEventListener("close", () => {
      if (activeDialog === dialog) {
        activeDialog = null;
        dialog.remove();
        if (activeTrigger && typeof activeTrigger.focus === "function") {
          activeTrigger.focus();
        }
        activeTrigger = null;
      }
    });
    document.body.append(dialog);
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    return closeContactModal;
  }

  function ContactButton(props: ContactButtonProps) {
    const h = React.createElement;
    const label = props.title ?? text("contact");
    return h(
      "button",
      {
        type: "button",
        className: ["dsh-base-contact-button", props.className].filter(Boolean).join(" "),
        title: label,
        "aria-label": label,
        onClick: (event: ReactNamespace.MouseEvent<HTMLButtonElement>) => {
          openContactModal({ trigger: event.currentTarget });
        },
      },
      h("span", { className: "dsh-base-contact-button__icon", "aria-hidden": "true" }, "👥"),
      props.iconOnly ? null : h("span", { className: "dsh-base-contact-button__label" }, label),
    );
  }

  function ContactRow(props: ContactRowProps) {
    const h = React.createElement;
    return h(
      "div",
      { className: ["dsh-base-contact-row", props.className].filter(Boolean).join(" ") },
      h(
        "span",
        { className: "dsh-base-contact-row__label" },
        props.label ?? text("contact"),
        props.hint ? h("span", { className: "dsh-base-contact-row__hint" }, ` · ${props.hint}`) : null,
      ),
      h(ContactButton, { title: text("contact") }),
    );
  }

  function AuthorPlugins(props: AuthorPluginsProps) {
    const h = React.createElement;
    const lang = props.lang ?? runtime.lang;
    const selfId = props.selfId ?? runtime.selfId;
    const maxRows = props.maxRows ?? runtime.maxRows ?? 4;
    const all = sortByOrder(props.plugins ?? BASELINE.manifest.plugins);
    const visible = all.filter((plugin) => plugin.id !== selfId).slice(0, Math.max(1, maxRows));
    if (visible.length === 0) return null;
    return h(
      "div",
      { className: ["dsh-base-plugins", props.className].filter(Boolean).join(" ") },
      h("h3", { className: "dsh-base-plugins__title" }, props.title ?? text("plugins")),
      h(
        "ul",
        { className: "dsh-base-plugins__list" },
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
              },
              plugin.name,
            ),
            h("span", { className: "dsh-base-plugins__desc" }, plugin.desc[lang] ?? plugin.desc.zh),
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
