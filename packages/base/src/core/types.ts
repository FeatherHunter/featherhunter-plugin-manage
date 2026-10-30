/**
 * Shared manifest / content types.
 *
 * A single `manifest.json` carries both the contact groups and the author
 * plugin list. The same data feeds two outputs: the settings-panel widgets and
 * the README renderers (see ./node).
 */

export type Lang = "zh" | "en";

/** Localized string. Both languages are always present in the data. */
export interface I18nText {
  zh: string;
  en: string;
}

/** Platform id of a contact group (open set: adding a platform needs data only). */
export type Platform = string;

/** QR code bundled inside the package as a base64 data URI (offline baseline). */
export interface GroupQrBundled {
  kind: "bundled";
  /** Key into `BaselineContent.qr`. */
  key: string;
}

/** QR code fetched from the npm CDN at a precise version. */
export interface GroupQrRemote {
  kind: "remote";
  /** File name under `data/img/` of the published package. */
  path: string;
}

export type GroupQr = GroupQrBundled | GroupQrRemote;

/** One contact group. Order in `groups` is display order. */
export interface Group {
  id: string;
  platform: Platform;
  /** Display order; lower comes first. */
  order: number;
  /** README table header text (README output only). */
  readmeTitle: I18nText;
  /** README image alt text (README output only). */
  alt: I18nText;
  /** Whole-card screenshot file name under `data/img/` (README output only). */
  card: string;
  /** QR crop used by the modal. */
  qr: GroupQr;
  /** Modal card title. */
  title: I18nText;
  /** Modal card subtitle (group id, organization, ...). */
  subtitle?: I18nText;
  /** Modal card footnote. Validity text is generated from `validUntil`, not stored. */
  note?: I18nText;
  /** Inclusive last day the QR code is valid (`YYYY-MM-DD`). Absent = permanent. */
  validUntil?: string;
}

/** One author plugin recommendation row. */
export interface PluginEntry {
  id: string;
  order: number;
  /** Last date the numbers in `desc` were verified by the repo owner. */
  verifiedAt: string;
  /** npm package name. */
  name: string;
  /** GitHub `owner/repo`. */
  repo: string;
  /** Link target; derived from `repo` when absent. */
  url?: string;
  desc: I18nText;
}

/** Published `data/manifest.json` payload. */
export interface Manifest {
  schema: 1;
  /** Package version that produced this manifest. */
  version: string;
  /** Monotonic data revision. */
  revision: number;
  updatedAt: string;
  /** Where users are sent when a QR code expired or cannot be loaded. */
  fallbackUrl: string;
  groups: Group[];
  plugins: PluginEntry[];
}

/** Content shipped inside the bundle so the modal works offline. */
export interface BaselineContent {
  manifest: Manifest;
  /** Data URI keyed by `GroupQrBundled.key`. */
  qr: Record<string, string>;
}
