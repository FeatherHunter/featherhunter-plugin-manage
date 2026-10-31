import { BLOCK_MARKERS } from "./readme-sync";
import type { VerifyResult } from "./types";

export * from "./types";
export * from "./readme-compare";
export * from "./renderers";
export * from "./readme-sync";
export * from "./targets";
export * from "./doctor";

/** Check that a rendered block has balanced markers. */
export function verifyBlock(block: string, name: keyof typeof BLOCK_MARKERS): VerifyResult {
  const markers = BLOCK_MARKERS[name];
  const errors: string[] = [];
  if (!block.includes(markers.start)) errors.push(`missing start marker for ${name}`);
  if (!block.includes(markers.end)) errors.push(`missing end marker for ${name}`);
  return { ok: errors.length === 0, errors };
}