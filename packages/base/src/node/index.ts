import { BASELINE, pickText, sortByOrder } from "../core/index";
import type { Group, Lang, Manifest, PluginEntry } from "../core/types";
import type { BlockRenderOptions, VerifyResult } from "./types";

export * from "./types";
export * from "./readme-compare";

/** Managed-block markers. Writers only ever touch the text between them. */
export const BLOCK_MARKERS = {
  contact: { start: "<!-- dsh-base:contact:start -->", end: "<!-- dsh-base:contact:end -->" },
  starHistory: {
    start: "<!-- dsh-base:star-history:start -->",
    end: "<!-- dsh-base:star-history:end -->",
  },
  thanks: { start: "<!-- dsh-base:thanks:start -->", end: "<!-- dsh-base:thanks:end -->" },
  more: { start: "<!-- dsh-base:more:start -->", end: "<!-- dsh-base:more:end -->" },
} as const;

function resolveManifest(options: BlockRenderOptions): Manifest {
  return options.manifest ?? BASELINE.manifest;
}

function resolveLang(options: BlockRenderOptions): Lang {
  return options.lang ?? "zh";
}

/**
 * Render the contact block (README table of groups).
 *
 * Placeholder implementation: ticket 06 replaces it with the two-variant
 * renderer plus snapshot fixtures.
 */
export function renderContactBlock(options: BlockRenderOptions = {}): string {
  const manifest = resolveManifest(options);
  const lang = resolveLang(options);
  const groups: Group[] = sortByOrder(manifest.groups);
  const rows = groups
    .map((group) => `| ${pickText(group.readmeTitle, lang)} | ![${pickText(group.alt, lang)}](${group.card}) |`)
    .join("\n");
  return [
    BLOCK_MARKERS.contact.start,
    "| 群 | 二维码 |",
    "| --- | --- |",
    rows,
    BLOCK_MARKERS.contact.end,
  ].join("\n");
}

/** Render the star-history block. Placeholder until ticket 10. */
export function renderStarHistoryBlock(options: BlockRenderOptions = {}): string {
  return [BLOCK_MARKERS.starHistory.start, "", BLOCK_MARKERS.starHistory.end].join("\n");
}

/** Render the thanks block. Placeholder until ticket 10. */
export function renderThanksBlock(options: BlockRenderOptions = {}): string {
  return [BLOCK_MARKERS.thanks.start, "", BLOCK_MARKERS.thanks.end].join("\n");
}

/** Render the MORE block. Placeholder until ticket 09. */
export function renderMoreBlock(options: BlockRenderOptions = {}): string {
  return [BLOCK_MARKERS.more.start, "", BLOCK_MARKERS.more.end].join("\n");
}

/** Check that a rendered block has balanced markers. */
export function verifyBlock(block: string, name: keyof typeof BLOCK_MARKERS): VerifyResult {
  const markers = BLOCK_MARKERS[name];
  const errors: string[] = [];
  if (!block.includes(markers.start)) errors.push(`missing start marker for ${name}`);
  if (!block.includes(markers.end)) errors.push(`missing end marker for ${name}`);
  return { ok: errors.length === 0, errors };
}

/** Author plugin entries sorted for rendering (placeholder helper). */
export function sortedPlugins(manifest: Manifest, selfId?: string): PluginEntry[] {
  return sortByOrder(manifest.plugins).filter((plugin) => plugin.id !== selfId);
}
