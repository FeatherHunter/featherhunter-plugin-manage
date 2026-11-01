/**
 * The ticket-face seam: what the gate needs from an issue tracker.
 *
 * The base package owns the rules but not the protocol. A plugin repository
 * injects an adapter for its tracker (GitHub, GitLab, a local markdown store),
 * and the gate only sees the shapes below. Keeping the protocol out of base
 * means the same rules run on every release path without a second copy.
 */
import { err, ok, type Result } from "./result";

/** One checklist ticket, as the gate sees it. */
export interface ChecklistIssue {
  readonly number: number;
  readonly title: string;
  /** Normalized tracker state; `UNKNOWN` is honest, not `OPEN`. */
  readonly state: "OPEN" | "CLOSED" | "UNKNOWN";
  /** The full ticket body, including the scenario overview and audit lines. */
  readonly body: string;
  readonly url?: string;
}

/** One comment on a checklist ticket. */
export interface TicketComment {
  readonly body: string;
  /** ISO timestamp when the tracker has one; comment order is the fallback. */
  readonly createdAt?: string;
}

/**
 * The minimum a ticket-face adapter must provide.
 *
 * `isAncestor` is deliberately tri-state: a tracker adapter that shells out to
 * Git may be unable to answer (shallow clone, ambiguous commit, timeout). It
 * must say so with `"unknown"`; returning `false` would turn "we could not
 * look" into a release-blocking red.
 */
export interface TicketFaceAdapter {
  /** Short protocol name for reports, for example `github` or `markdown`. */
  readonly kind: string;
  /** Every ticket whose title starts with the checklist prefix, open and closed. */
  listChecklistIssues(): Promise<readonly ChecklistIssue[]>;
  /** Every comment on one ticket; implementations must paginate. */
  listComments(issueNumber: number): Promise<readonly TicketComment[]>;
  /** The commit the release is being cut from (usually HEAD). */
  resolveReleaseCommit(): Promise<string>;
  /** Whether `commit` is an ancestor of `descendant`, or `"unknown"`. */
  isAncestor(commit: string, descendant: string): Promise<boolean | "unknown">;
  /** Optional: read and parse a candidate manifest from a tracker file. */
  readCandidateManifest?(path: string): Promise<unknown>;
}

/** What `verify/profile.ts` declares to inject an adapter. */
export interface TicketFaceDeclaration {
  /** Repository-relative module, or an installed package name. */
  readonly module: string;
  /** Named export; omitted means the module's default export. */
  readonly exportName?: string;
}

/** Methods every adapter object must implement. */
export const TICKET_FACE_METHODS = [
  "listChecklistIssues",
  "listComments",
  "resolveReleaseCommit",
  "isAncestor",
] as const;

/**
 * Prove that an imported value is a ticket-face adapter.
 *
 * The loader calls this after import; a value that loaded but has the wrong
 * shape is a configuration failure, not a product failure, and the caller maps
 * it to `blocked` for the same reason a missing adapter is blocked.
 */
export function validateTicketFaceAdapter(value: unknown): Result<TicketFaceAdapter> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err({
      code: "invalid-input",
      message: "the ticket-face adapter export is not an object",
      hint: "export an object with kind, listChecklistIssues, listComments, resolveReleaseCommit and isAncestor",
    });
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || record.kind.trim().length === 0) {
    return err({
      code: "invalid-input",
      message: "the ticket-face adapter is missing a non-empty kind",
      hint: "set kind to the tracker protocol name, for example \"github\"",
    });
  }
  const missing = TICKET_FACE_METHODS.filter((method) => typeof record[method] !== "function");
  if (missing.length > 0) {
    return err({
      code: "invalid-input",
      message: `the ticket-face adapter is missing required method(s): ${missing.join(", ")}`,
      hint: "implement every method in contracts/ticket-face.ts",
    });
  }
  if (record.readCandidateManifest !== undefined && typeof record.readCandidateManifest !== "function") {
    return err({
      code: "invalid-input",
      message: "ticket-face adapter readCandidateManifest is present but is not a function",
      hint: "remove it, or make it an async function that returns a parsed manifest",
    });
  }
  return ok(value as TicketFaceAdapter);
}
