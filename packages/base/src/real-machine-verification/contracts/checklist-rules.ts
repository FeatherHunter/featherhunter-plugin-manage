/**
 * Checklist consistency: does the ticket agree with itself?
 *
 * This is deliberately narrower than "is the release ready". It compares the
 * overview table, the scenario blocks, the comments' results and the counts in
 * the closing comment; it does not invent new release-readiness rules (for
 * example, it does not forbid a 待验证 row on a closed ticket). Keeping the
 * boundary explicit is what lets the same record be audited after the fact.
 */
import { scenarioIdMatcher, type ChecklistFormat } from "./checklist-format";
import type { ReleaseGateFinding } from "./release-gate";
import type { TicketComment } from "./ticket-face";

export type ChecklistScenarioResult = string;

export interface ScenarioRow {
  readonly id: string;
  readonly status: ChecklistScenarioResult;
  /** 1-based line in the ticket body. */
  readonly line: number;
}

export interface ConsistencyReport {
  readonly ok: boolean;
  readonly findings: readonly ReleaseGateFinding[];
  readonly rows: readonly ScenarioRow[];
  readonly registeredIds: readonly string[];
  readonly publishCounts: {
    readonly passed: number;
    readonly exempted: number;
    readonly failed: number;
  };
}

/** Statuses whose row needs a matching conclusion in a comment. */
const NEEDS_COMMENT: readonly string[] = ["通过", "失败"];

function finding(
  message: string,
  hint: string,
  expected?: string,
  actual?: string,
): ReleaseGateFinding {
  return {
    code: "checklist-inconsistent",
    message,
    hint,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

function cleanCell(value: string): string {
  return value
    .trim()
    .replace(/^\*\*|\*\*$/gu, "")
    .replace(/^`|`$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function fullIdPattern(format: ChecklistFormat): RegExp {
  const flags = format.scenarioIdPattern.flags.replace(/[gy]/gu, "");
  return new RegExp(`^(?:${format.scenarioIdPattern.source})$`, flags);
}

function idsIn(text: string, format: ChecklistFormat): string[] {
  const pattern = scenarioIdMatcher(format, false);
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

function statusIn(text: string, format: ChecklistFormat): string | null {
  // Longest first, so a vocabulary containing overlapping words resolves stably.
  const words = [...format.statusVocabulary].sort((left, right) => right.length - left.length);
  return words.find((word) => text.includes(word)) ?? null;
}

function priorityOf(status: string, format: ChecklistFormat): number {
  const index = format.resultPriority.indexOf(status);
  return index < 0 ? -1 : index;
}

interface CommentConclusion {
  readonly status: string;
  readonly priority: number;
  readonly commentIndex: number;
  readonly line: number;
}

function addConclusion(
  conclusions: Map<string, CommentConclusion>,
  id: string,
  status: string,
  commentIndex: number,
  line: number,
  format: ChecklistFormat,
): void {
  const priority = priorityOf(status, format);
  const existing = conclusions.get(id);
  if (existing === undefined || priority > existing.priority) {
    conclusions.set(id, { status, priority, commentIndex, line });
  }
}

/** The five documented comment shapes, with the highest priority per comment. */
function parseComment(
  comment: TicketComment,
  commentIndex: number,
  format: ChecklistFormat,
): Map<string, CommentConclusion> {
  const conclusions = new Map<string, CommentConclusion>();
  const lines = comment.body.split(/\r?\n/u);
  const counted = new RegExp(
    `^\\s*(${format.statusVocabulary.map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})\\s+\\d+\\s*[（(]([^）)]*)[）)]`,
    "u",
  );

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const lineNumber = index + 1;
    if (line.length === 0) return;

    const scenarioLine = /^场景\s+([^：:\n]+)[：:]\s*(.+)$/u.exec(line);
    if (scenarioLine !== null) {
      const status = statusIn(scenarioLine[2] as string, format);
      if (status !== null) {
        for (const id of idsIn(scenarioLine[1] as string, format)) {
          addConclusion(conclusions, id, status, commentIndex, lineNumber, format);
        }
      }
      return;
    }

    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(cleanCell);
      if (cells.length >= 2) {
        const id = cells[0] as string;
        const status = cells[1] as string;
        if (fullIdPattern(format).test(id) && format.statusVocabulary.includes(status)) {
          addConclusion(conclusions, id, status, commentIndex, lineNumber, format);
        }
      }
      return;
    }

    const bold = /^\s*-\s*\*\*(.+?)\*\*/u.exec(line);
    if (bold !== null) {
      const inner = bold[1] as string;
      const status = statusIn(inner, format);
      if (status !== null) {
        const before = inner.slice(0, inner.indexOf(status));
        for (const id of idsIn(before, format)) {
          addConclusion(conclusions, id, status, commentIndex, lineNumber, format);
        }
      }
      return;
    }

    const countedMatch = counted.exec(line);
    if (countedMatch !== null) {
      const status = countedMatch[1] as string;
      for (const id of idsIn(countedMatch[2] as string, format)) {
        addConclusion(conclusions, id, status, commentIndex, lineNumber, format);
      }
      return;
    }

    // Last resort: a line that lists ids and then one status. This covers the
    // compact closing form ("1600-01 / 1600-02 通过") without needing a parser
    // for every punctuation variant.
    const ids = idsIn(line, format);
    if (ids.length > 0) {
      const firstEnd = line.indexOf(ids[0] as string) + (ids[0] as string).length;
      const suffix = line.slice(firstEnd);
      const status = statusIn(suffix, format);
      if (status !== null) {
        for (const id of ids) addConclusion(conclusions, id, status, commentIndex, lineNumber, format);
      }
    }
  });

  return conclusions;
}

interface OverviewParse {
  readonly found: boolean;
  readonly rows: readonly ScenarioRow[];
  readonly findings: readonly ReleaseGateFinding[];
}

function headingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+/u.exec(line);
  return match === null ? null : (match[1] as string).length;
}

function parseOverview(body: string, format: ChecklistFormat): OverviewParse {
  const lines = body.split(/\r?\n/u);
  const heading = format.overviewHeading.trim();
  const start = lines.findIndex((line) => line.trim().startsWith(heading));
  if (start < 0) {
    return {
      found: false,
      rows: [],
      findings: [
        finding(
          `the ticket body has no "${heading}" section`,
          "add the scenario overview table so the gate can compare it with the comments",
          `a "${heading}" table`,
          "section missing",
        ),
      ],
    };
  }
  const startLevel = headingLevel(lines[start] as string) ?? 2;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const level = headingLevel(lines[index] as string);
    if (level !== null && level <= startLevel) {
      end = index;
      break;
    }
  }
  const section = lines.slice(start + 1, end);
  const table = section.filter((line) => line.trim().startsWith("|"));
  if (table.length === 0) {
    return {
      found: true,
      rows: [],
      findings: [
        finding(
          `the "${heading}" section has no table rows`,
          "add at least one scenario row",
          "a non-empty overview table",
          "no table rows",
        ),
      ],
    };
  }

  const header = (table[0] as string).split("|").slice(1, -1).map(cleanCell);
  const columnIndex = (labels: readonly string[], fallback: number): number => {
    const found = header.findIndex((cell) => labels.some((label) => cell.includes(label)));
    return found < 0 ? fallback : found;
  };
  const idIndex = columnIndex([format.overviewColumns[0] ?? "场景编号", "编号"], 0);
  const sourceIndex = columnIndex([format.overviewColumns[1] ?? "来源票", "来源"], 1);
  const statusIndex = columnIndex([format.overviewColumns[3] ?? "状态", "状态"], 3);
  void sourceIndex;

  const rows: ScenarioRow[] = [];
  const findings: ReleaseGateFinding[] = [];
  const full = fullIdPattern(format);
  for (let index = 1; index < table.length; index += 1) {
    const rawLine = table[index] as string;
    const cells = rawLine.split("|").slice(1, -1).map(cleanCell);
    if (cells.every((cell) => /^:?-{3,}:?$/u.test(cell))) continue;
    const lineNumber = lines.indexOf(rawLine) + 1;
    if (cells.length < format.overviewColumns.length) {
      findings.push(
        finding(
          `overview row at line ${lineNumber} has ${cells.length} column(s); the format declares ${format.overviewColumns.length}`,
          "keep every row aligned with the header; missing cells break the record",
          `${format.overviewColumns.length} columns`,
          `${cells.length} columns: ${rawLine.trim()}`,
        ),
      );
      continue;
    }
    const id = cells[idIndex] ?? "";
    const status = cells[statusIndex] ?? "";
    if (!full.test(id)) {
      findings.push(
        finding(
          `overview row at line ${lineNumber} has an invalid scenario id "${id}"`,
          "use the id pattern the checklist format declares",
          "a scenario id matching the declared pattern",
          id,
        ),
      );
      continue;
    }
    if (!format.statusVocabulary.includes(status)) {
      findings.push(
        finding(
          `overview row ${id} has status "${status}", which is not in the vocabulary`,
          `use one of: ${format.statusVocabulary.join(" / ")}`,
          format.statusVocabulary.join(" / "),
          status,
        ),
      );
      continue;
    }
    rows.push({ id, status, line: lineNumber });
  }
  if (rows.length === 0 && findings.length === 0) {
    findings.push(
      finding(
        `the "${heading}" section has no usable scenario rows`,
        "add at least one row with a valid id and status",
        "a non-empty overview table",
        "no usable rows",
      ),
    );
  }
  return { found: true, rows, findings };
}

/** Collect every id the body registers: overview rows, headings and blocks. */
function registeredIds(body: string, rows: readonly ScenarioRow[], format: ChecklistFormat): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  const add = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    output.push(id);
  };
  for (const row of rows) add(row.id);

  const full = fullIdPattern(format);
  const blockPattern = /^#{2,6}\s*场景块[:：]\s*#?([A-Za-z0-9]{1,10})(?![\d-])/u;
  const headingPattern = /^#{2,6}\s*场景\s+(.+?)\s*$/u;
  let currentTicket: string | null = null;
  let explicitInBlock = false;
  for (const raw of body.split(/\r?\n/u)) {
    const line = raw.trim();
    const block = blockPattern.exec(line);
    if (block !== null) {
      currentTicket = block[1] as string;
      explicitInBlock = false;
      continue;
    }
    const heading = headingPattern.exec(line);
    if (heading !== null) {
      const ids = idsIn(heading[1] as string, format);
      if (ids.length > 0) {
        explicitInBlock = true;
        for (const id of ids) add(id);
      } else if (currentTicket !== null) {
        const derived = `${currentTicket}-01`;
        if (full.test(derived)) add(derived);
      }
    }
  }
  if (currentTicket !== null && !explicitInBlock) {
    const derived = `${currentTicket}-01`;
    if (full.test(derived)) add(derived);
  }
  return output;
}

function sortComments(comments: readonly TicketComment[]): readonly { comment: TicketComment; index: number }[] {
  return comments
    .map((comment, index) => ({ comment, index }))
    .sort((left, right) => {
      const leftTime = left.comment.createdAt ?? "";
      const rightTime = right.comment.createdAt ?? "";
      if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
      return left.index - right.index;
    });
}

/** Compare the ticket body with the conclusions recorded in its comments. */
export function judgeChecklistConsistency(input: {
  readonly body: string;
  readonly comments: readonly TicketComment[];
  readonly format: ChecklistFormat;
}): ConsistencyReport {
  const { body, comments, format } = input;
  const overview = parseOverview(body, format);
  const findings: ReleaseGateFinding[] = [...overview.findings];
  const rows = overview.rows;
  const registered = registeredIds(body, rows, format);

  const latest = new Map<string, CommentConclusion>();
  for (const { comment, index } of sortComments(comments)) {
    const conclusions = parseComment(comment, index + 1, format);
    for (const [id, conclusion] of conclusions) latest.set(id, conclusion);
  }

  const needs = rows.filter((row) => NEEDS_COMMENT.includes(row.status));
  for (const row of needs) {
    const conclusion = latest.get(row.id);
    if (conclusion === undefined) {
      findings.push(
        finding(
          `scenario ${row.id} is "${row.status}" in the overview but has no conclusion in any comment`,
          `record "场景 ${row.id}：${row.status}" in a comment`,
          `a comment conclusion of ${row.status}`,
          "no conclusion",
        ),
      );
      continue;
    }
    if (conclusion.status !== row.status) {
      findings.push(
        finding(
          `scenario ${row.id} is "${row.status}" in the overview but "${conclusion.status}" in comment #${conclusion.commentIndex}`,
          "make the overview and the comment record the same conclusion",
          row.status,
          `${conclusion.status} (comment #${conclusion.commentIndex})`,
        ),
      );
    }
  }

  for (const [id, conclusion] of latest) {
    if (!registered.includes(id)) {
      findings.push(
        finding(
          `comment #${conclusion.commentIndex} records scenario ${id}, which the ticket body does not register`,
          "add the scenario to the overview and its scenario block, or correct the comment",
          `${id} registered in the body`,
          `only in comment #${conclusion.commentIndex}`,
        ),
      );
    }
  }

  // Counts in the publish-ready comment must describe the same result set.
  const counts = { passed: 0, exempted: 0, failed: 0 };
  for (const conclusion of latest.values()) {
    if (conclusion.status === "通过" || conclusion.status === "已验证") counts.passed += 1;
    else if (conclusion.status === "失败") counts.failed += 1;
    else if (conclusion.status === "豁免") counts.exempted += 1;
  }
  const publishPattern = /\[发布就绪\]\s*通过\s*(\d+)\s*\/\s*失败\s*(\d+)\s*\/\s*豁免\s*(\d+)/u;
  let claim: { passed: number; failed: number; exempted: number } | null = null;
  for (const { comment } of sortComments(comments)) {
    for (const line of comment.body.split(/\r?\n/u)) {
      const match = publishPattern.exec(line);
      if (match !== null) {
        claim = {
          passed: Number(match[1]),
          failed: Number(match[2]),
          exempted: Number(match[3]),
        };
      }
    }
  }
  if (claim !== null) {
    if (claim.passed !== counts.passed || claim.failed !== counts.failed || claim.exempted !== counts.exempted) {
      findings.push(
        finding(
          `the publish-ready comment claims 通过 ${claim.passed} / 失败 ${claim.failed} / 豁免 ${claim.exempted}, but the comments contain 通过 ${counts.passed} / 失败 ${counts.failed} / 豁免 ${counts.exempted}`,
          "recount the recorded conclusions and update the publish-ready line",
          `通过 ${counts.passed} / 失败 ${counts.failed} / 豁免 ${counts.exempted}`,
          `通过 ${claim.passed} / 失败 ${claim.failed} / 豁免 ${claim.exempted}`,
        ),
      );
    }
  }

  const scenarioCount = /(\d+)\s*条场景/u.exec(body);
  if (scenarioCount !== null && Number(scenarioCount[1]) !== rows.length) {
    findings.push(
      finding(
        `the body claims ${scenarioCount[1]} scenarios, but the overview lists ${rows.length}`,
        "update the count or the table so they agree",
        `${rows.length} scenarios`,
        `${scenarioCount[1]} scenarios`,
      ),
    );
  }

  return {
    ok: findings.length === 0,
    findings,
    rows,
    registeredIds: registered,
    publishCounts: counts,
  };
}
