/**
 * Resolving one model credential for a launched instance.
 *
 * The host stores credentials in `<DSH_HOME>/.credentials.yaml`. That file has
 * two kinds of content: `records:` (the provider-side secret payloads) and a
 * top-level `refs:` block that maps a *reference name* (what the profile names
 * in `model.apiKeyEnv`) to the plaintext value the host injects. A launch needs
 * the value exactly once — to put it into the child environment — and must never
 * let it appear anywhere else.
 *
 * Therefore:
 *
 * - this module is the only place that reads a value out of `refs:`;
 * - the parser returns a map and nothing else: no document, no path, no line
 *   numbers, no error text that could quote a value;
 * - callers only ever serialize the variable *name* and the *source* of the
 *   credential — never the value;
 * - `records:` is never parsed. The parser only touches the indented block that
 *   follows a top-level `refs:` header, so deterministic payload entries cannot
 *   be mistaken for references.
 *
 * Resolution order matches the capability spec: the batch home (the isolated
 * instance home) first, then the real DSH home, then the process environment.
 * A miss is not an error: the instance can still start, model calls just may
 * fail, and the launch records `missing` with a warning.
 */
import type { Result } from "../../contracts/result";
import { credentialStorePath } from "./credentials";

/** Where a resolved credential came from. Never includes the value. */
export type CredentialSource = "batch-home-store" | "real-home-store" | "process-env";

/** A credential resolved for the child env; `value` never gets serialized. */
export interface ResolvedCredential {
  readonly name: string;
  readonly value: string;
  readonly source: CredentialSource;
}

/** What the launch needs to know: the hit (if any) and where it came from. */
export interface ModelCredentialLookup {
  readonly credential: ResolvedCredential | null;
  /** Human-readable notes about sources that were tried; no values. */
  readonly notes: readonly string[];
}

export interface ResolveModelCredentialOptions {
  /** Reference name the profile names, e.g. `MINIMAX_CN_API_KEY`. */
  readonly apiKeyEnv: string;
  /** Isolated DSH home of the instance that is about to be launched. */
  readonly batchHome: string;
  /** The real DSH home (`DSH_HOME` or `~/.dsh`). */
  readonly realHome: string;
  /** Reads a text file; a missing file is an ordinary observation. */
  readonly readText: (path: string) => Promise<Result<string>>;
  /** The verifier process environment. */
  readonly envGet: (name: string) => string | undefined;
}

const REFS_HEADER = /^refs:\s*(?:#.*)?$/;
const REF_ENTRY = /^\s+([A-Za-z_$][A-Za-z0-9_.$-]*):(?:\s*(.*))?$/;

/**
 * Parse the top-level `refs:` block into `name -> value`.
 *
 * The value stays in memory: this function is not exported from the capability
 * index and callers must never log its result. Handles LF and CRLF, quoted
 * values, blank lines and comments; a missing `refs:` block is an empty map.
 */
export function parseCredentialRefs(text: string): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  let inside = false;
  /** Indent width of the first entry; deeper lines are nested YAML, not refs. */
  let entryIndent: number | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!inside) {
      if (REFS_HEADER.test(rawLine.trimEnd())) inside = true;
      continue;
    }
    if (rawLine.trim().length === 0) continue;
    if (/^\s*#/.test(rawLine)) continue;
    // A non-indented line starts the next top-level block; refs are over.
    if (!/^\s/.test(rawLine)) break;
    const match = REF_ENTRY.exec(rawLine);
    if (match === null) continue;
    const indent = match[1] === undefined ? 0 : rawLine.length - rawLine.trimStart().length;
    if (entryIndent === null) entryIndent = indent;
    if (indent !== entryIndent) continue;
    const name = match[1];
    if (name === undefined) continue;
    const value = unquote((match[2] ?? "").trim());
    if (!refs.has(name)) refs.set(name, value);
  }
  return refs;
}

/** Strip one layer of matching YAML quotes; nothing else is interpreted. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Read one credential store file and return its refs map, or `null` when absent. */
async function readRefs(
  readText: (path: string) => Promise<Result<string>>,
  home: string,
): Promise<ReadonlyMap<string, string> | null> {
  const text = await readText(credentialStorePath(home));
  if (!text.ok) return null;
  return parseCredentialRefs(text.value);
}

/**
 * Resolve `apiKeyEnv` in spec order. The returned value is for the child env
 * only; callers persist the name and source, never the value.
 */
export async function resolveModelCredential(
  options: ResolveModelCredentialOptions,
): Promise<ModelCredentialLookup> {
  const { apiKeyEnv } = options;
  const notes: string[] = [];

  const batchRefs = await readRefs(options.readText, options.batchHome);
  const batchValue = batchRefs?.get(apiKeyEnv);
  if (batchValue !== undefined && batchValue.length > 0) {
    return { credential: { name: apiKeyEnv, value: batchValue, source: "batch-home-store" }, notes };
  }
  notes.push(`${apiKeyEnv} is not in the batch home credential store`);

  const realRefs = await readRefs(options.readText, options.realHome);
  const realValue = realRefs?.get(apiKeyEnv);
  if (realValue !== undefined && realValue.length > 0) {
    return { credential: { name: apiKeyEnv, value: realValue, source: "real-home-store" }, notes };
  }
  notes.push(`${apiKeyEnv} is not in the real home credential store`);

  const processValue = options.envGet(apiKeyEnv);
  if (processValue !== undefined && processValue.length > 0) {
    return { credential: { name: apiKeyEnv, value: processValue, source: "process-env" }, notes };
  }
  notes.push(`${apiKeyEnv} is not set in the process environment`);
  return { credential: null, notes };
}
