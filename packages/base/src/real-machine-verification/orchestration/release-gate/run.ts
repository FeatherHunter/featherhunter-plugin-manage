/**
 * Run the release gate: collect ticket-face records once, execute six hard
 * checks, then assemble a report.
 *
 * The gate is a library call, not a command. A caller (a release script, a CI
 * step, a test) supplies ports, the frozen candidate and the release identity;
 * this module owns collection and error classification. Two rules shape the
 * error handling:
 *
 * - a missing or throwing adapter never passes silently: all ticket-dependent
 *   checks report blocked (exit 2), and the report carries a three-step hint;
 * - an input that cannot describe a release (bad commit, malformed audit line,
 *   incomplete candidate) returns GateFailure instead of a green-looking report.
 */
import { loadTicketFaceAdapter, missingTicketFaceHint, type TicketFaceImport } from "../../adapters/ticket-face/loader";
import { parseCommitSha } from "../../contracts/branding";
import type { CandidateManifest } from "../../contracts/candidate-rules";
import { parseCandidateManifest } from "../../contracts/candidate-rules";
import { decideExitCode, tallyChecks, type CheckResult } from "../../contracts/check";
import { DEFAULT_CHECKLIST_FORMAT, type ChecklistFormat } from "../../contracts/checklist-format";
import { judgeChecklistConsistency } from "../../contracts/checklist-rules";
import type { Ports } from "../../contracts/ports";
import {
  collectAuditLines,
  formatAuditLine,
  judgeAncestorAudit,
  judgeChecklistPresence,
  normalizeReleaseVersion,
  parseAuditLine,
  scanIdentities,
  splitChecklistTickets,
  type AuditLine,
  type ReleaseGateBlockedReason,
  type GateFailure,
  type ReleaseGateFinding,
  type ReleaseGateReport,
} from "../../contracts/release-gate";
import { err, failure, ok, type Failure, type Result } from "../../contracts/result";
import { formatIdentityLine } from "../../contracts/identity";
import {
  validateTicketFaceAdapter,
  type ChecklistIssue,
  type TicketComment,
  type TicketFaceAdapter,
  type TicketFaceDeclaration,
} from "../../contracts/ticket-face";
import type { VerificationProfile } from "../../contracts/verification-profile";
import { blocked, toCheckResult, type CheckModule, type CheckOutcome } from "../types";
import {
  RELEASE_GATE_CHECKS,
  RELEASE_GATE_CHECK_IDS,
  type GateAudit,
  type GateContext,
  type GateSnapshot,
} from "./plan";

export { RELEASE_GATE_CHECK_IDS, type ReleaseGateCheckId } from "./plan";

export interface ReleaseGateOptions {
  /** Filesystem and other effects; only fs is used (adapter loading). */
  readonly ports: Ports;
  /** Frozen candidate (contracts/candidate-rules.ts). Null means "none supplied". */
  readonly candidate: CandidateManifest | null;
  /** Release commit the candidate must be an ancestor of. */
  readonly releaseCommit: string;
  /** Release version, with or without a leading v. */
  readonly releaseVersion: string;
  /** Pin the checklist ticket by number; otherwise exactly one title match is used. */
  readonly checklistTicket?: number;
  /** The ticket the release exists for; recorded in notes, never guessed. */
  readonly primaryTicket?: number;
  /** One or more audit lines; the ticket body and comments are scanned too. */
  readonly auditLines?: readonly string[] | string;
  /** Plugin repository root used to resolve a relative adapter module. */
  readonly workRoot?: string;
  /** Checklist vocabulary override (defaults are the shipped template). */
  readonly format?: ChecklistFormat;
  /** Profile whose ticketFace declaration should be loaded. */
  readonly profile?: VerificationProfile;
  /** Direct adapter object, declaration to load, or false to disable. */
  readonly ticketFace?: TicketFaceAdapter | TicketFaceDeclaration | false;
  /** When true a missing candidate is a fail, not blocked. */
  readonly requireCandidate?: boolean;
  /** Test seam for the dynamic import. */
  readonly importModule?: TicketFaceImport;
}

interface AdapterResolution {
  readonly adapter: TicketFaceAdapter | null;
  readonly blocked: ReleaseGateBlockedReason | null;
  readonly note: string | null;
}

interface Collection {
  readonly snapshot: GateSnapshot | null;
  readonly blocked: readonly ReleaseGateBlockedReason[];
}

function gateFailure(
  code: Failure["code"],
  message: string,
  hint?: string,
  details?: Readonly<Record<string, unknown>>,
): GateFailure {
  return { ...failure(code, message, hint, details), stage: "input" };
}

function isAdapterObject(value: unknown): value is TicketFaceAdapter {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as { listChecklistIssues?: unknown }).listChecklistIssues === "function";
}

function isDeclaration(value: unknown): value is TicketFaceDeclaration {
  return typeof value === "object" && value !== null && typeof (value as { module?: unknown }).module === "string";
}

/**
 * Pick the adapter source in precedence order: explicit object, explicit
 * declaration, then the profile declaration. Explicit false disables it.
 */
async function resolveAdapter(options: ReleaseGateOptions): Promise<AdapterResolution> {
  const disabled: AdapterResolution = {
    adapter: null,
    blocked: {
      code: "adapter-missing",
      message: "the release gate has no ticket-face adapter",
      hint: missingTicketFaceHint(),
    },
    note: null,
  };
  if (options.ticketFace === false) return disabled;

  if (options.ticketFace !== undefined && isAdapterObject(options.ticketFace)) {
    const validated = validateTicketFaceAdapter(options.ticketFace);
    if (!validated.ok) {
      return {
        adapter: null,
        blocked: {
          code: "adapter-missing",
          message: validated.error.message,
          hint: validated.error.hint ?? missingTicketFaceHint(),
        },
        note: null,
      };
    }
    return { adapter: validated.value, blocked: null, note: "adapter supplied directly" };
  }

  let declaration: TicketFaceDeclaration | null = null;
  if (options.ticketFace !== undefined && isDeclaration(options.ticketFace)) {
    declaration = options.ticketFace;
  } else if (options.profile !== undefined && options.profile.ticketFace !== false) {
    declaration = options.profile.ticketFace;
  }
  if (declaration === null) return disabled;
  if (options.workRoot === undefined) {
    return {
      adapter: null,
      blocked: {
        code: "adapter-missing",
        message: "a ticket-face declaration needs workRoot to resolve its module",
        hint: "pass workRoot (the plugin repository root) together with the ticketFace declaration",
      },
      note: null,
    };
  }

  const loaded = await loadTicketFaceAdapter({
    fs: options.ports.fs,
    repoRoot: options.workRoot,
    declaration,
    ...(options.importModule === undefined ? {} : { importModule: options.importModule }),
  });
  if (!loaded.ok) {
    return {
      adapter: null,
      blocked: {
        code: "adapter-missing",
        message: loaded.error.message,
        hint: loaded.error.hint ?? missingTicketFaceHint(),
      },
      note: null,
    };
  }
  return {
    adapter: loaded.value.adapter,
    blocked: null,
    note: "adapter " + loaded.value.specifier + " (export " + loaded.value.exportName + ")",
  };
}

function asIssue(value: unknown): ChecklistIssue | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.number !== "number" || !Number.isInteger(record.number) || record.number <= 0) return null;
  if (typeof record.title !== "string" || typeof record.body !== "string") return null;
  if (record.state !== "OPEN" && record.state !== "CLOSED" && record.state !== "UNKNOWN") return null;
  if (record.url !== undefined && typeof record.url !== "string") return null;
  return {
    number: record.number,
    title: record.title,
    state: record.state,
    body: record.body,
    ...(record.url === undefined ? {} : { url: record.url }),
  };
}

function asComment(value: unknown): TicketComment | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.body !== "string") return null;
  if (record.createdAt !== undefined && typeof record.createdAt !== "string") return null;
  return {
    body: record.body,
    ...(record.createdAt === undefined ? {} : { createdAt: record.createdAt }),
  };
}

function adapterBlocked(detail: string, hint?: string): ReleaseGateBlockedReason {
  return { code: "adapter-missing", message: detail, hint: hint ?? missingTicketFaceHint() };
}

function collectAuditInputs(
  issue: ChecklistIssue | null,
  comments: readonly TicketComment[],
  extra: readonly AuditLine[],
): readonly AuditLine[] {
  const lines: AuditLine[] = [...extra];
  if (issue !== null) lines.push(...collectAuditLines(issue.body));
  for (const comment of comments) lines.push(...collectAuditLines(comment.body));
  return lines;
}

/**
 * Collect everything the checks read, or explain why the ticket face could not
 * be read. Collection is deliberately one pass: checks must not do I/O.
 */
async function collect(
  options: ReleaseGateOptions,
  adapter: TicketFaceAdapter,
  version: string,
  format: ChecklistFormat,
  releaseCommit: string,
  extraAudits: readonly AuditLine[],
): Promise<Collection> {
  let issues: readonly ChecklistIssue[];
  try {
    const raw = await adapter.listChecklistIssues();
    if (!Array.isArray(raw)) {
      return { snapshot: null, blocked: [adapterBlocked("the ticket-face adapter listChecklistIssues() did not return an array")] };
    }
    const parsed = raw.map(asIssue);
    const badIndex = parsed.findIndex((item) => item === null);
    if (badIndex >= 0) {
      return {
        snapshot: null,
        blocked: [adapterBlocked("the ticket-face adapter returned a malformed issue at index " + badIndex)],
      };
    }
    issues = parsed as ChecklistIssue[];
  } catch (error) {
    return {
      snapshot: null,
      blocked: [adapterBlocked("the ticket-face adapter threw while listing issues: " + String(error))],
    };
  }

  let resolvedCommit: string | null = null;
  try {
    const raw = await adapter.resolveReleaseCommit();
    if (typeof raw !== "string") {
      return { snapshot: null, blocked: [adapterBlocked("resolveReleaseCommit() did not return a string")] };
    }
    if (raw.trim().length > 0) {
      const parsed = parseCommitSha(raw.trim());
      if (!parsed.ok) {
        return {
          snapshot: null,
          blocked: [adapterBlocked("resolveReleaseCommit() returned a non-40-hex commit: " + raw)],
        };
      }
      resolvedCommit = parsed.value;
    }
  } catch (error) {
    return {
      snapshot: null,
      blocked: [adapterBlocked("the ticket-face adapter threw while resolving the release commit: " + String(error))],
    };
  }
  if (resolvedCommit !== null && resolvedCommit !== releaseCommit) {
    return {
      snapshot: null,
      blocked: [
        {
          code: "prerequisite-missing",
          message:
            "the adapter resolves the release commit to " + resolvedCommit + ", but the gate was given " + releaseCommit,
          hint: "pass the same release commit the repository resolves for this version, or fix the adapter",
        },
      ],
    };
  }

  const set = splitChecklistTickets(issues, version, format);
  let issue: ChecklistIssue | null = null;
  if (options.checklistTicket !== undefined) {
    issue = issues.find((item) => item.number === options.checklistTicket) ?? null;
  } else if (set.exact.length === 1) {
    issue = set.exact[0] as ChecklistIssue;
  }

  let comments: readonly TicketComment[] = [];
  if (issue !== null) {
    try {
      const raw = await adapter.listComments(issue.number);
      if (!Array.isArray(raw)) {
        return { snapshot: null, blocked: [adapterBlocked("the ticket-face adapter listComments() did not return an array")] };
      }
      const parsed = raw.map(asComment);
      const badIndex = parsed.findIndex((item) => item === null);
      if (badIndex >= 0) {
        return {
          snapshot: null,
          blocked: [adapterBlocked("the ticket-face adapter returned a malformed comment at index " + badIndex)],
        };
      }
      comments = parsed as TicketComment[];
    } catch (error) {
      return {
        snapshot: null,
        blocked: [adapterBlocked("the ticket-face adapter threw while listing comments: " + String(error))],
      };
    }
  }

  const scan = scanIdentities(comments, format);
  const latestIdentity = scan.identities.length > 0 ? scan.identities[scan.identities.length - 1] as (typeof scan.identities)[number] : null;
  const latestBatch = latestIdentity === null ? null : latestIdentity.batchName;
  const consistency = issue === null ? null : judgeChecklistConsistency({ body: issue.body, comments, format });

  const auditLines = collectAuditInputs(issue, comments, extraAudits);
  const commits: string[] = [];
  for (const commit of [
    options.candidate === null ? null : options.candidate.git.commit,
    latestIdentity === null ? null : latestIdentity.commit,
  ]) {
    if (commit !== null && commit !== releaseCommit && !commits.includes(commit)) commits.push(commit);
  }

  const audits: GateAudit[] = [];
  for (const commit of commits) {
    let answer: boolean | "unknown";
    try {
      const raw = await adapter.isAncestor(commit, releaseCommit);
      if (raw !== true && raw !== false && raw !== "unknown") {
        return {
          snapshot: null,
          blocked: [adapterBlocked("isAncestor(" + commit + ", " + releaseCommit + ") returned " + String(raw) + "; expected true, false or \"unknown\"")],
        };
      }
      answer = raw;
    } catch (error) {
      return {
        snapshot: null,
        blocked: [adapterBlocked("the ticket-face adapter threw while checking ancestry: " + String(error))],
      };
    }
    const judgement = judgeAncestorAudit({
      candidateCommit: commit,
      releaseCommit,
      isAncestor: answer,
      auditLines,
    });
    audits.push({ commit, findings: judgement.findings, judgement: judgement.judgement });
  }

  return {
    snapshot: {
      set,
      issue,
      comments,
      releaseCommit,
      scan,
      latestBatch,
      latestIdentity,
      audits,
      consistency,
    },
    blocked: [],
  };
}

function reportTicket(snapshot: GateSnapshot | null) {
  return {
    number: snapshot?.issue?.number ?? null,
    ...(snapshot?.issue?.url === undefined ? {} : { url: snapshot.issue.url }),
    exactCount: snapshot?.set.exact.length ?? 0,
    identities: snapshot?.scan.identities.length ?? 0,
    latestBatch: snapshot?.latestBatch ?? null,
  };
}

function buildReport(
  options: ReleaseGateOptions,
  version: string,
  releaseCommit: string,
  candidate: CandidateManifest | null,
  snapshot: GateSnapshot | null,
  blockedReasons: readonly ReleaseGateBlockedReason[],
  notes: readonly string[],
): ReleaseGateReport {
  const context: GateContext = {
    version,
    format: options.format ?? DEFAULT_CHECKLIST_FORMAT,
    candidate,
    requireCandidate: options.requireCandidate === true,
    snapshot,
    ticketBlockedHint: blockedReasons[0]?.hint ?? missingTicketFaceHint(),
    blocked: blockedReasons,
  };

  const checks: CheckResult[] = [];
  const findings: ReleaseGateFinding[] = [];
  for (const definition of RELEASE_GATE_CHECKS) {
    let run: { outcome: CheckOutcome; findings: readonly ReleaseGateFinding[] };
    try {
      run = definition.run(context);
    } catch (error) {
      run = {
        outcome: blocked(definition.id + " crashed: " + String(error), "this is a gate bug; report it with the stack trace"),
        findings: [],
      };
    }
    findings.push(...run.findings);
    const module: CheckModule<GateContext> = {
      id: definition.id,
      title: definition.title,
      hard: definition.hard,
      requires: [],
      onMissing: "blocked",
      run: (): CheckOutcome => run.outcome,
    };
    checks.push(toCheckResult(module, run.outcome, 0));
  }

  const tally = tallyChecks(checks);
  const exitCode = decideExitCode(checks);
  const decision = exitCode === 0 ? "pass" : exitCode === 1 ? "fail" : "blocked";
  const auditLine = firstAuditLine(snapshot);
  return {
    schemaVersion: 1,
    capability: "real-machine-verification",
    command: "release-gate",
    version,
    releaseCommit,
    decision,
    exitCode,
    checks,
    tally,
    ticket: reportTicket(snapshot),
    candidate: candidate === null
      ? null
      : {
          commit: candidate.git.commit,
          validity: candidate.validity,
          fileDigest: candidate.package.fileDigest,
        },
    audit: {
      required: snapshot?.audits.some((audit) => audit.judgement.required) ?? false,
      // No pair needs an audit when the candidate is the release commit: the
      // requirement is vacuously covered, not unproven.
      covered: snapshot !== null &&
        snapshot.audits.every((audit) => audit.judgement.covered && !audit.judgement.unknown),
      line: auditLine,
    },
    findings,
    records: {
      auditLine,
      identities: (snapshot?.scan.identities ?? []).flatMap((identity) => {
        const formatted = formatIdentityLine(identity);
        return formatted.ok ? [formatted.value] : [];
      }),
    },
    blocked: blockedReasons,
    notes,
  };
}

function firstAuditLine(snapshot: GateSnapshot | null): string | null {
  if (snapshot === null) return null;
  for (const audit of snapshot.audits) {
    if (audit.judgement.audit !== null) return formatAuditLine(audit.judgement.audit);
  }
  return null;
}


/**
 * Plan, collect, run, report. The single public entry point of the capability.
 */
export async function runReleaseGate(
  options: ReleaseGateOptions,
): Promise<Result<ReleaseGateReport, GateFailure>> {
  const version = normalizeReleaseVersion(options.releaseVersion);
  if (version.length === 0 || /[\r\n]/u.test(version)) {
    return err(gateFailure("invalid-input", "releaseVersion must be a non-empty single line", "pass the version being released, for example 1.2.3"));
  }
  if (options.releaseVersion.trim().length === 0) {
    return err(gateFailure("invalid-input", "releaseVersion is empty"));
  }
  const releaseParsed = parseCommitSha(options.releaseCommit.trim());
  if (!releaseParsed.ok) {
    return err(gateFailure("invalid-input", "releaseCommit " + JSON.stringify(options.releaseCommit) + " is not a 40-hex commit", "pass the commit being released, lowercase 40 hex characters"));
  }
  const releaseCommit = releaseParsed.value;

  if (options.checklistTicket !== undefined &&
      (!Number.isInteger(options.checklistTicket) || options.checklistTicket <= 0)) {
    return err(gateFailure("invalid-input", "checklistTicket must be a positive integer"));
  }
  if (options.workRoot !== undefined && options.workRoot.trim().length === 0) {
    return err(gateFailure("invalid-input", "workRoot must not be empty"));
  }

  let candidate: CandidateManifest | null = null;
  if (options.candidate !== null) {
    const parsed = parseCandidateManifest(options.candidate);
    if (!parsed.ok) {
      return err(gateFailure(
        "invalid-input",
        "candidate is not a complete CandidateManifest: " + parsed.error.message,
        "freeze the candidate with the base packaging tool; a batch-summary JSON is not enough (it lacks validity, sourceStable, fileDigest and schemaVersion)",
        parsed.error.details,
      ));
    }
    candidate = parsed.value;
  }

  const extraAudits: AuditLine[] = [];
  const rawAuditLines = options.auditLines === undefined
    ? []
    : typeof options.auditLines === "string" ? [options.auditLines] : options.auditLines;
  for (const line of rawAuditLines) {
    const parsed = parseAuditLine(line);
    if (parsed === null) {
      return err(gateFailure(
        "invalid-input",
        "audit line is not in the release gate wire format: " + JSON.stringify(line),
        "expected: - 候选提交 <40hex> → 发布提交 <40hex>：<one-line reason>",
      ));
    }
    extraAudits.push(parsed);
  }

  const format = options.format ?? DEFAULT_CHECKLIST_FORMAT;
  const resolution = await resolveAdapter(options);
  const notes: string[] = [];
  if (resolution.note !== null) notes.push(resolution.note);

  let snapshot: GateSnapshot | null = null;
  let blockedReasons: readonly ReleaseGateBlockedReason[] = resolution.blocked === null ? [] : [resolution.blocked];
  if (resolution.adapter !== null) {
    const collected = await collect(options, resolution.adapter, version, format, releaseCommit, extraAudits);
    snapshot = collected.snapshot;
    blockedReasons = collected.blocked;
    if (snapshot === null) {
      notes.push("ticket-face collection failed; ticket-dependent checks are blocked");
    } else {
      if (snapshot.set.placeholders.length > 0) {
        notes.push(
          "ignored " + snapshot.set.placeholders.length + " placeholder ticket(s): " +
            snapshot.set.placeholders.map((item) => "#" + item.number).join(" "),
        );
      }
      if (options.checklistTicket !== undefined && snapshot.issue === null) {
        notes.push("checklist ticket #" + options.checklistTicket + " was not returned by the adapter");
      }
      if (options.primaryTicket !== undefined) notes.push("primary ticket #" + options.primaryTicket);
    }
  }

  return ok(buildReport(options, version, releaseCommit, candidate, snapshot, blockedReasons, notes));
}