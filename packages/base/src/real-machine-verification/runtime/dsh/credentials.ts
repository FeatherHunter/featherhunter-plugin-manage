/**
 * Credential-store observation: which reference *names* a store lists.
 *
 * The host keeps credential references in <DSH_HOME>/.credentials.yaml: a
 * plain-text store whose top-level "refs:" block maps each reference name
 * (an environment-variable-shaped name) to a value. This module reads that file
 * only far enough to answer "is this reference listed?" - it never returns,
 * logs, or hands on a value. A report that says "the reference resolves" is
 * enough to explain a run; a report that quotes the secret is a leak.
 *
 * The scanner is a pure function over text so tests can feed it LF/CRLF, a
 * missing block, comments and malformed input without touching a real home.
 */
import type { FsPort } from "../../contracts/ports";
import { joinFsPath } from "../paths";

/** Reference names read out of a store's top-level refs block. */
export interface CredentialRefScan {
  /** Names only, in file order, without duplicates. Never the values. */
  readonly refs: readonly string[];
  /** Why the text does not look like a credential store; never the text itself. */
  readonly note: string | null;
}

/** A top-level refs: line, optionally followed by a comment. */
const REFS_HEADER_RE = /^refs:\s*(?:#.*)?$/;

/** One NAME: value line; only the name is captured. */
const REF_KEY_RE = /^([A-Za-z_$][A-Za-z0-9_.$-]*):(?:\s|$)/;

/**
 * Extract the reference names from a credential store's refs block.
 *
 * Only direct children of the top-level block are names: a nested mapping under
 * a reference belongs to its value and must never be mistaken for a name. The
 * function is total - malformed input returns an empty list with a note rather
 * than throwing.
 */
export function scanCredentialRefs(text: string): CredentialRefScan {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const refs: string[] = [];
  const seen = new Set<string>();
  let inRefs = false;
  let headerSeen = false;
  let childIndent: number | null = null;

  for (const line of lines) {
    if (!inRefs) {
      if (REFS_HEADER_RE.test(line)) {
        inRefs = true;
        headerSeen = true;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const indentMatch = /^[ \t]*/.exec(line);
    const indent = indentMatch === null ? 0 : indentMatch[0].length;
    // A non-indented line is the next top-level key: the refs block ended.
    if (indent === 0) break;
    if (childIndent === null) childIndent = indent;
    // Nested lines describe a value, not a reference name.
    if (indent !== childIndent) continue;
    const match = REF_KEY_RE.exec(trimmed);
    if (match === null) continue;
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    refs.push(name);
  }

  if (!headerSeen) return { refs: [], note: "the text has no top-level refs: block" };
  return { refs, note: null };
}

/** What one credential store said about one reference name. */
export interface CredentialStoreObservation {
  readonly path: string;
  /** The file could be read and parsed as a store. */
  readonly readable: boolean;
  readonly refPresent: boolean;
  /** How many names the store lists; never the names of unrelated refs. */
  readonly refCount: number;
  /** Why the store is unreadable or unusable; never file content. */
  readonly note: string | null;
}

/** Read one store and report whether it lists ref; values are never read out. */
export async function probeCredentialStore(
  fs: FsPort,
  path: string,
  ref: string,
): Promise<CredentialStoreObservation> {
  const text = await fs.readText(path);
  if (!text.ok) {
    return { path, readable: false, refPresent: false, refCount: 0, note: text.error.message };
  }
  const scan = scanCredentialRefs(text.value);
  return {
    path,
    readable: true,
    refPresent: scan.refs.includes(ref),
    refCount: scan.refs.length,
    note: scan.note,
  };
}

/** The real home's credential store: <DSH_HOME>/.credentials.yaml. */
export function credentialStorePath(dshHome: string): string {
  return joinFsPath(dshHome, ".credentials.yaml");
}
