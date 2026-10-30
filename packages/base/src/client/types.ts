import type { ComponentType } from "react";
import type { Group, Lang, PluginEntry } from "../core/types";
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
}

export interface ContactButtonProps {
  className?: string;
  /** Overrides the default tooltip / aria label. */
  title?: string;
  /** Render only the icon. */
  iconOnly?: boolean;
  /** Icon size in px (14 / 16 / 18, default 16). */
  size?: 14 | 16 | 18;
}

export interface ContactRowProps {
  className?: string;
  label?: string;
  /** Small hint next to the button. */
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
  ContactRow: ComponentType<ContactRowProps>;
  AuthorPlugins: ComponentType<AuthorPluginsProps>;
  openContactModal: (options?: OpenContactModalOptions) => () => void;
  closeContactModal: () => void;
  preloadContent: () => Promise<void>;
}
