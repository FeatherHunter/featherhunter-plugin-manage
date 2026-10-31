import type * as ReactNamespace from "react";
import {
  contactClusterIcon,
  issueClusterIcon,
  moreClusterIcon,
  starClusterIcon,
} from "./cluster-icons";
import { createTipController } from "./hover-tip";
import type { TextKey } from "./texts";
import type { ActionClusterItem, ActionClusterProps } from "./types";

/** h is the injected runtime's createElement, never an imported React. */
type H = typeof ReactNamespace.createElement;

/** Everything the cluster needs from the host-agnostic base context. */
export interface ActionClusterDeps {
  text: (key: TextKey) => string;
  openContact: (trigger: HTMLElement | null) => void;
  /** Star target: the host repository. Missing means no Star entry. */
  repoUrl?: string;
  /** Issue target; when omitted the issue list of repoUrl is used. */
  issuesUrl?: string;
}

const DEFAULT_SIZE = 16;
const DEFAULT_GAP = 4;
/** Button box around the icon: 16 + 12 = 28 (matches the design spec). */
const BUTTON_PADDING = 12;

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function classes(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Accessible per-action glow colour and stable test hook live on this class. */
function actionClass(id: string): string {
  return "dsh-base-cluster__btn--" + id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Build the header action cluster bound to the injected React runtime.
 *
 * One container, N independent buttons: the container only groups them (role
 * group + generic label, no hover answer, no selected state, no dividers). Every
 * button keeps its own hit area, tooltip, focus ring and Tab stop.
 */
export function createActionCluster(
  React: typeof ReactNamespace,
  deps: ActionClusterDeps,
): ReactNamespace.ComponentType<ActionClusterProps> {
  const h: H = React.createElement;

  function defaultItems(size: number, uid: string): ActionClusterItem[] {
    const repo = deps.repoUrl;
    const issues = deps.issuesUrl ?? (repo ? trimSlashes(repo) + "/issues" : undefined);
    const items: ActionClusterItem[] = [
      {
        id: "contact",
        icon: contactClusterIcon(h, size, uid + "c"),
        label: deps.text("contact"),
        tip: deps.text("contactTip"),
        onClick: (trigger) => deps.openContact(trigger),
      },
    ];
    if (repo) {
      items.push({
        id: "star",
        icon: starClusterIcon(h, size, uid + "s"),
        label: deps.text("starLabel"),
        tip: deps.text("starTip"),
        href: repo,
      });
    }
    if (issues) {
      items.push({
        id: "issue",
        icon: issueClusterIcon(h, size, uid + "i"),
        label: deps.text("issueLabel"),
        tip: deps.text("issueTip"),
        href: issues,
      });
    }
    return items;
  }

  function ActionCluster(props: ActionClusterProps): ReactNamespace.ReactElement {
    const size = props.size ?? DEFAULT_SIZE;
    const gap = props.gap ?? DEFAULT_GAP;
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const tip = React.useMemo(() => createTipController(), []);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const moreRef = React.useRef<HTMLButtonElement | null>(null);
    const menuRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => () => tip.dispose(), [tip]);

    const items = props.items ?? defaultItems(size, uid);
    const cap = props.maxVisible === undefined ? items.length : Math.max(0, Math.floor(props.maxVisible));
    const visible = items.slice(0, Math.min(items.length, cap));
    const overflow = items.slice(visible.length);
    const overflowLabel = props.overflowLabel ?? deps.text("moreActions");

    const showTip = (anchor: HTMLElement, item: ActionClusterItem): void => {
      if (item.disabled || !item.tip) return;
      tip.show(anchor, item.tip);
    };
    const hideTip = (): void => tip.hideSoon();

    const renderButton = (item: ActionClusterItem): ReactNamespace.ReactElement => {
      const icon = h(
        "span",
        { className: "dsh-base-cluster__icon", key: "icon", "aria-hidden": "true" },
        item.icon,
      );
      const shared = {
        className: classes("dsh-base-cluster__btn", actionClass(item.id), item.className),
        style: { width: size + BUTTON_PADDING, height: size + BUTTON_PADDING },
        "aria-label": item.label,
        "data-cluster-item": item.id,
        onMouseEnter: (event: ReactNamespace.MouseEvent<HTMLElement>) =>
          showTip(event.currentTarget, item),
        onMouseLeave: hideTip,
        onFocus: (event: ReactNamespace.FocusEvent<HTMLElement>) =>
          showTip(event.currentTarget, item),
        onBlur: hideTip,
      };
      if (item.disabled) {
        return h(
          "button",
          { ...shared, key: item.id, type: "button", disabled: true, "aria-disabled": "true" },
          icon,
        );
      }
      if (item.href) {
        return h(
          "a",
          {
            ...shared,
            key: item.id,
            href: item.href,
            target: "_blank",
            rel: "noreferrer noopener",
            onClick: (event: ReactNamespace.MouseEvent<HTMLAnchorElement>) => {
              item.onClick?.(event.currentTarget);
            },
          },
          icon,
        );
      }
      return h(
        "button",
        {
          ...shared,
          key: item.id,
          type: "button",
          onClick: (event: ReactNamespace.MouseEvent<HTMLButtonElement>) => {
            item.onClick?.(event.currentTarget);
          },
        },
        icon,
      );
    };

    const renderMenuItem = (item: ActionClusterItem): ReactNamespace.ReactElement => {
      const icon = h(
        "span",
        { className: "dsh-base-cluster__icon", key: "icon", "aria-hidden": "true" },
        item.icon,
      );
      const label = h("span", { className: "dsh-base-cluster__menu-label", key: "label" }, item.label);
      const shared = {
        className: "dsh-base-cluster__menu-item",
        role: "menuitem",
        "data-cluster-item": item.id,
      };
      if (item.disabled) {
        return h("button", { ...shared, key: item.id, type: "button", disabled: true }, icon, label);
      }
      if (item.href) {
        return h(
          "a",
          {
            ...shared,
            key: item.id,
            href: item.href,
            target: "_blank",
            rel: "noreferrer noopener",
            onClick: (event: ReactNamespace.MouseEvent<HTMLAnchorElement>) => {
              item.onClick?.(event.currentTarget);
              setMenuOpen(false);
            },
          },
          icon,
          label,
        );
      }
      return h(
        "button",
        {
          ...shared,
          key: item.id,
          type: "button",
          onClick: (event: ReactNamespace.MouseEvent<HTMLButtonElement>) => {
            item.onClick?.(event.currentTarget);
            setMenuOpen(false);
          },
        },
        icon,
        label,
      );
    };

    const overflowButton =
      overflow.length > 0
        ? h(
            "button",
            {
              key: "__more",
              ref: moreRef,
              type: "button",
              className: classes("dsh-base-cluster__btn", "dsh-base-cluster__btn--more", menuOpen && "is-open"),
              style: { width: size + BUTTON_PADDING, height: size + BUTTON_PADDING },
              "aria-label": overflowLabel,
              "aria-haspopup": "menu",
              "aria-expanded": menuOpen,
              "data-cluster-item": "__more",
              onMouseEnter: (event: ReactNamespace.MouseEvent<HTMLButtonElement>) => {
                if (!menuOpen) tip.show(event.currentTarget, overflowLabel);
              },
              onMouseLeave: hideTip,
              onFocus: (event: ReactNamespace.FocusEvent<HTMLButtonElement>) => {
                if (!menuOpen) tip.show(event.currentTarget, overflowLabel);
              },
              onBlur: hideTip,
              onClick: (event: ReactNamespace.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              },
            },
            h(
              "span",
              { className: "dsh-base-cluster__icon", key: "icon", "aria-hidden": "true" },
              moreClusterIcon(h, size),
            ),
          )
        : null;

    const menu =
      overflow.length > 0 && menuOpen
        ? h(
            "div",
            {
              key: "menu",
              ref: menuRef,
              className: "dsh-base-cluster__menu",
              role: "menu",
              "aria-label": props.ariaLabel ?? deps.text("actionsLabel"),
            },
            overflow.map(renderMenuItem),
          )
        : null;

    React.useEffect(() => {
      if (!menuOpen) return undefined;
      if (typeof document === "undefined") return undefined;
      const onPointerDown = (event: Event): void => {
        const target = event.target as Node | null;
        if (target && (menuRef.current?.contains(target) || moreRef.current?.contains(target))) return;
        setMenuOpen(false);
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        setMenuOpen(false);
        moreRef.current?.focus();
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      const first = menuRef.current?.querySelector<HTMLElement>("[role='menuitem']");
      first?.focus();
      return () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
      };
    }, [menuOpen]);

    return h(
      "div",
      {
        className: classes(
          "dsh-base-cluster",
          props.variant === "tray" && "dsh-base-cluster--tray",
          props.className,
        ),
        role: "group",
        "aria-label": props.ariaLabel ?? deps.text("actionsLabel"),
        style: { gap: gap + "px" },
      },
      visible.map(renderButton),
      overflowButton,
      menu,
    );
  }

  return ActionCluster;
}
