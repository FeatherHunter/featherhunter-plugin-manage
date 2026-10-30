import type { ComponentType } from "react";
import type { Group, Lang, PluginEntry } from "../core/types";

/** Options for {@link createBaseUI}. */
export interface BaseUIOptions {
  /** Force a language instead of auto-detecting it. */
  lang?: Lang | string;
  /** Id of the host plugin; excluded from the author plugin list. */
  selfId?: string;
  /** Manifest URL override (defaults to the published CDN manifest). */
  manifestUrl?: string;
  /** Text overrides keyed by message id. */
  texts?: Partial<Record<string, string>>;
  /** Max columns of the contact grid (hard ceiling: 4). */
  columns?: number;
  /** Show the host plugin itself in the author plugin list. */
  showSelf?: boolean;
  /** Max rows of the author plugin list (default 4). */
  maxRows?: number;
}

export interface ContactButtonProps {
  className?: string;
  /** Overrides the default tooltip / aria label. */
  title?: string;
  /** Render only the icon. */
  iconOnly?: boolean;
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
  selfId?: string;
  plugins?: PluginEntry[];
  maxRows?: number;
}

export interface OpenContactModalOptions {
  /** Element that opened the modal; focus returns here on close. */
  trigger?: HTMLElement | null;
  /** Groups override (defaults to the baseline manifest). */
  groups?: Group[];
  lang?: Lang;
  texts?: Partial<Record<string, string>>;
  fallbackUrl?: string;
}

/** Widget set returned by {@link createBaseUI}. */
export interface BaseUI {
  ContactButton: ComponentType<ContactButtonProps>;
  ContactRow: ComponentType<ContactRowProps>;
  AuthorPlugins: ComponentType<AuthorPluginsProps>;
  openContactModal: (options?: OpenContactModalOptions) => () => void;
  closeContactModal: () => void;
  preloadContent: () => Promise<void>;
}
