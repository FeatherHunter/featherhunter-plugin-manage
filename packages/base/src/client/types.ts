import type { ComponentType, ReactNode } from "react";
import type { Group, Lang, PluginEntry } from "../core/types";
import type { ContentLoader, FetchLike } from "./content";
import type { TextOverrides } from "./texts";

/**
 * Resolve the image source for a group's QR code.
 *
 * A null / undefined result means "no image available": the card degrades to
 * the fallback link instead of rendering a broken or expired QR code. Ticket
 * 05 injects a CDN resolver here; the default only reads bundled baseline
 * codes.
 */
export type QrResolver = (group: Group) => string | null | undefined;

/** Options for createBaseUI. */
export interface BaseUIOptions {
  /** Force a language instead of auto-detecting it. */
  lang?: Lang | string;
  /** Id of the host plugin; excluded from the author plugin list. */
  selfId?: string;
  /** Manifest URL override (defaults to the published CDN manifest). */
  manifestUrl?: string;
  /** Fetch implementation override (testing seam). */
  fetchImpl?: FetchLike;
  /** Pre-built content loader override (testing seam). */
  contentLoader?: ContentLoader;
  /** Text overrides keyed by message id. */
  texts?: TextOverrides;
  /** Max columns of the contact grid (hard ceiling: 4). */
  columns?: number;
  /** URL used when a group QR code expired or is unavailable. */
  fallbackUrl?: string;
  /** QR image resolver; defaults to the bundled baseline data URIs. */
  resolveQr?: QrResolver;
  /** Show the host plugin itself in the author plugin list. */
  showSelf?: boolean;
  /** Max rows of the author plugin list (default 5). */
  maxRows?: number;
  /** GitHub repo URL used by StarButton / ActionButtons (Star target). */
  repoUrl?: string;
  /** Issues URL used by IssueButton; derived from repoUrl when omitted. */
  issuesUrl?: string;
}

/** Icon size in px: compact 14, header default 16, roomy 18. */
export type ActionIconSize = 14 | 16 | 18;

/** Hover copy and accessible name shared by every header action. */
export interface ActionButtonProps {
  className?: string;
  /** Icon size in px (14 / 16 / 18, default 16). */
  size?: ActionIconSize;
  /** Overrides the built-in hover copy. */
  tip?: string;
  /** Overrides the accessible name (the icon carries no visible text). */
  label?: string;
}

export interface ContactButtonProps extends ActionButtonProps {
  /** Overrides the aria label of the contact dialog trigger. */
  title?: string;
}

export interface StarButtonProps extends ActionButtonProps {
  /** Repo quoted in the star link; defaults to the createBaseUI option. */
  repoUrl?: string;
}

export interface IssueButtonProps extends ActionButtonProps {
  /** Issues URL; defaults to `<repo>/issues` when only a repo is known. */
  issuesUrl?: string;
  /** Repo used to derive the issues URL when issuesUrl is omitted. */
  repoUrl?: string;
}

/** The three header actions as separate icon buttons. */
export interface ActionButtonsProps {
  className?: string;
  size?: ActionIconSize;
  repoUrl?: string;
  issuesUrl?: string;
}

/** The three header actions packed into one bordered capsule. */
export type ActionGroupProps = ActionButtonsProps;

/**
 * One-line hover copy anchored to a trigger. The tooltip renders in
 * document.body (fixed), flips below near the top edge and is clamped inside
 * the viewport; only one tooltip is visible at a time.
 */
export interface HoverTipProps {
  /** Tooltip copy; an empty string renders the trigger without a tooltip. */
  content: string;
  children?: ReactNode;
  className?: string;
  /** Max tooltip width in px (default 320). */
  maxWidth?: number;
  /** Preferred side; flips automatically when the viewport has no room. */
  placement?: "top" | "bottom";
  /** Delay before hiding after pointer leave, in ms (default 160). */
  hideDelay?: number;
  /** Controlled visibility (demo / screenshot); omit for hover behaviour. */
  visible?: boolean;
}

export interface ContactRowProps {
  className?: string;
  label?: string;
  /** Small hint rendered after the row label. */
  hint?: string;
}

export interface AuthorPluginsProps {
  className?: string;
  title?: string;
  lang?: Lang;
  /** Id of the host plugin; defaults to the createBaseUI option. */
  selfId?: string;
  /** Show the host plugin itself instead of dropping it. */
  showSelf?: boolean;
  plugins?: PluginEntry[];
  /** Hard cap on rendered rows (default 5). */
  maxRows?: number;
}

export interface OpenContactModalOptions {
  /** Element that opened the modal; focus returns here on close. */
  trigger?: HTMLElement | null;
  /** Groups override (defaults to the baseline manifest). Empty falls back. */
  groups?: Group[];
  lang?: Lang | string;
  texts?: TextOverrides;
  /** Max columns of the contact grid (hard ceiling: 4). */
  columns?: number;
  /** URL used when a group QR code expired or is unavailable. */
  fallbackUrl?: string;
  /** QR image resolver; defaults to the bundled baseline data URIs. */
  resolveQr?: QrResolver;
  /** Clock override for date-dependent validity text (testing seam). */
  now?: Date;
}

/** Widget set returned by createBaseUI. */
export interface BaseUI {
  ContactButton: ComponentType<ContactButtonProps>;
  StarButton: ComponentType<StarButtonProps>;
  IssueButton: ComponentType<IssueButtonProps>;
  /** Contact + Star + Issue as separate icon buttons. */
  ActionButtons: ComponentType<ActionButtonsProps>;
  /** Contact + Star + Issue inside one 1px capsule (tight page headers). */
  ActionGroup: ComponentType<ActionGroupProps>;
  /** Public hover-copy control (deck-style tooltip) for host use. */
  HoverTip: ComponentType<HoverTipProps>;
  ContactRow: ComponentType<ContactRowProps>;
  AuthorPlugins: ComponentType<AuthorPluginsProps>;
  openContactModal: (options?: OpenContactModalOptions) => () => void;
  closeContactModal: () => void;
  preloadContent: () => Promise<void>;
}
