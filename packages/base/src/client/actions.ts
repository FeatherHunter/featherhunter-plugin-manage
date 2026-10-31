import type * as ReactNamespace from "react";
import { createHoverTip } from "./hover-tip";
import { contactIcon, issueIcon, starIcon } from "./icons";
import type { TextKey } from "./texts";
import type {
  ActionButtonsProps,
  ActionGroupProps,
  ContactButtonProps,
  HoverTipProps,
  IssueButtonProps,
  StarButtonProps,
} from "./types";

/** Everything the header actions read from one createBaseUI instance. */
export interface ActionsDeps {
  /** Localised copy resolver bound to the createBaseUI options. */
  text: (key: TextKey) => string;
  /** Opens the contact dialog; the trigger element restores focus on close. */
  openContact: (trigger: HTMLElement | null) => void;
  /** Default GitHub repo URL (Star target, Issue URL base). */
  repoUrl?: string;
  /** Default issues URL; derived from repoUrl when only that is given. */
  issuesUrl?: string;
}

export interface ActionsComponents {
  ContactButton: ReactNamespace.ComponentType<ContactButtonProps>;
  StarButton: ReactNamespace.ComponentType<StarButtonProps>;
  IssueButton: ReactNamespace.ComponentType<IssueButtonProps>;
  ActionButtons: ReactNamespace.ComponentType<ActionButtonsProps>;
  ActionGroup: ReactNamespace.ComponentType<ActionGroupProps>;
  HoverTip: ReactNamespace.ComponentType<HoverTipProps>;
}

function classes(first: string, extra?: string): string {
  return extra ? first + " " + extra : first;
}

/** Trim trailing slashes so "<repo>/issues" never doubles up. */
function trimSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

interface IconActionSpec {
  className?: string;
  /** Accessible name (the icon carries no text). */
  label: string;
  /** Hover copy shown by the shared HoverTip. */
  tip: string;
  /** Anchor target; the control renders a <button> when absent. */
  href?: string;
  onClick?: (trigger: HTMLElement) => void;
  icon: ReactNamespace.ReactElement;
}

/**
 * The three header actions as separate controls plus a single capsule that
 * packs all three next to a narrow page title. Star and Issue use the deck line
 * icons (24px grid, currentColor, 1.8 stroke); Contact reuses the QR outline.
 */
export function createActions(
  React: typeof ReactNamespace,
  deps: ActionsDeps,
): ActionsComponents {
  const h = React.createElement;
  const HoverTip = createHoverTip(React);

  function iconAction(spec: IconActionSpec): ReactNamespace.ReactElement {
    const body = h(
      "span",
      {
        className: "dsh-base-icon-action__icon",
        key: "icon",
        "aria-hidden": "true",
      },
      spec.icon,
    );
    const control = spec.href
      ? h(
          "a",
          {
            className: classes("dsh-base-icon-action", spec.className),
            href: spec.href,
            target: "_blank",
            rel: "noreferrer noopener",
            "aria-label": spec.label,
            key: "control",
          },
          body,
        )
      : h(
          "button",
          {
            type: "button",
            className: classes("dsh-base-icon-action", spec.className),
            "aria-label": spec.label,
            key: "control",
            onClick: (event: ReactNamespace.MouseEvent<HTMLButtonElement>) => {
              spec.onClick?.(event.currentTarget);
            },
          },
          body,
        );
    return h(HoverTip, { content: spec.tip }, control);
  }

  /** QR-code icon button: opens the shared contact dialog. */
  function ContactButton(props: ContactButtonProps): ReactNamespace.ReactElement {
    const size = props.size ?? 16;
    return iconAction({
      className: classes("dsh-base-contact-button", props.className),
      label: props.title ?? deps.text("contact"),
      tip: props.tip ?? deps.text("contactTip"),
      icon: contactIcon(h, size),
      onClick: (trigger) => deps.openContact(trigger),
    });
  }

  /** Star link to the host repo; hidden below 16px headers have no room. */
  function StarButton(props: StarButtonProps): ReactNamespace.ReactElement | null {
    const href = props.repoUrl ?? deps.repoUrl;
    if (!href) return null;
    return iconAction({
      className: props.className,
      label: props.label ?? deps.text("starLabel"),
      tip: props.tip ?? deps.text("starTip"),
      href,
      icon: starIcon(h, props.size ?? 16),
    });
  }

  /** Issue link; defaults to <repo>/issues when no issues URL is configured. */
  function IssueButton(props: IssueButtonProps): ReactNamespace.ReactElement | null {
    const explicit = props.issuesUrl ?? deps.issuesUrl;
    const repo = props.repoUrl ?? deps.repoUrl;
    const href = explicit ?? (repo ? trimSlashes(repo) + "/issues" : undefined);
    if (!href) return null;
    return iconAction({
      className: props.className,
      label: props.label ?? deps.text("issueLabel"),
      tip: props.tip ?? deps.text("issueTip"),
      href,
      icon: issueIcon(h, props.size ?? 16),
    });
  }

  function actionSet(
    props: ActionButtonsProps,
    grouped: boolean,
  ): ReactNamespace.ReactElement {
    return h(
      "span",
      {
        className: classes(
          grouped ? "dsh-base-actions dsh-base-actions--group" : "dsh-base-actions",
          props.className,
        ),
        role: "group",
        "aria-label": deps.text("actionsLabel"),
      },
      h(ContactButton, { size: props.size, key: "contact" }),
      h(StarButton, { size: props.size, repoUrl: props.repoUrl, key: "star" }),
      h(IssueButton, {
        size: props.size,
        repoUrl: props.repoUrl,
        issuesUrl: props.issuesUrl,
        key: "issue",
      }),
    );
  }

  /** Three independent icon buttons, 2px apart (page headers with room). */
  function ActionButtons(props: ActionButtonsProps): ReactNamespace.ReactElement {
    return actionSet(props, false);
  }

  /** All three in one 1px capsule with hairline dividers (tight headers). */
  function ActionGroup(props: ActionGroupProps): ReactNamespace.ReactElement {
    return actionSet(props, true);
  }

  return { ContactButton, StarButton, IssueButton, ActionButtons, ActionGroup, HoverTip };
}
