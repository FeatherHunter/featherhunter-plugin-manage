/**
 * The checklist template shape, as data.
 *
 * The gate must not hard-code the wording of one repository's issue template.
 * A plugin repository declares the headings, columns and vocabulary it uses;
 * the rules in `checklist-rules.ts` consume this declaration. The default is
 * the template this capability ships with, so a repository that adopts the
 * template unchanged needs no configuration.
 */
import { err, ok, type Result } from "./result";

/** Default title prefix of the release checklist ticket. */
export const DEFAULT_CHECKLIST_TITLE_PREFIX = "[真机验证]";
/** Default placeholder version used before a release checklist exists. */
export const DEFAULT_PLACEHOLDER_WORD = "下一版";

export interface ChecklistFormat {
  /** Title prefix, for example `[真机验证]`. */
  readonly titlePrefix: string;
  /** Placeholder version, for example `下一版`. */
  readonly placeholderWord: string;
  /** Heading that opens the scenario overview table. */
  readonly overviewHeading: string;
  /** Expected table columns, in order; rows with fewer cells are malformed. */
  readonly overviewColumns: readonly string[];
  /** Every status word the template allows. */
  readonly statusVocabulary: readonly string[];
  /** Priority for several conclusions in one comment (low to high; highest wins). */
  readonly resultPriority: readonly string[];
  /** Pattern that matches one scenario id, for example `1600-01`. */
  readonly scenarioIdPattern: RegExp;
  /** Heading of the batch-record section in the ticket body. */
  readonly batchHeading: string;
  /** Heading of the candidate-versus-release audit section. */
  readonly auditHeading: string;
}

/** The documented template, unchanged. */
export const DEFAULT_CHECKLIST_FORMAT: ChecklistFormat = Object.freeze({
  titlePrefix: DEFAULT_CHECKLIST_TITLE_PREFIX,
  placeholderWord: DEFAULT_PLACEHOLDER_WORD,
  overviewHeading: "## 场景总览",
  overviewColumns: Object.freeze(["场景编号", "来源票", "一句话", "状态", "备注"]),
  statusVocabulary: Object.freeze(["待验证", "已验证", "通过", "失败", "豁免", "未测", "阻塞", "作废"]),
  resultPriority: Object.freeze(["作废", "待验证", "阻塞", "未测", "已验证", "通过", "豁免", "失败"]),
  scenarioIdPattern: /[A-Za-z0-9]{1,10}-\d{2}(?![\d-])/u,
  batchHeading: "## 批次记录",
  auditHeading: "## 候选与发布差异审计",
});

const NEWLINE_RE = /[\r\n]/u;

function invalid(message: string, hint: string): Result<never> {
  return err({ code: "invalid-input", message, hint });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !NEWLINE_RE.test(value);
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entries: string[] = [];
  for (const entry of value) {
    if (!nonEmptyString(entry)) return null;
    entries.push(entry.trim());
  }
  return entries;
}

/**
 * Validate a declared format and freeze it.
 *
 * The pattern is kept as declared (the rules clone it when they need a global
 * matcher); rejecting a non-RegExp here keeps every later parse total.
 */
export function parseChecklistFormat(input: unknown): Result<ChecklistFormat> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("checklist format must be an object", "omit it to use DEFAULT_CHECKLIST_FORMAT");
  }
  const record = input as Record<string, unknown>;
  if (!nonEmptyString(record.titlePrefix)) {
    return invalid("checklist format titlePrefix must be one non-empty line", "for example \"[真机验证]\"");
  }
  if (!nonEmptyString(record.placeholderWord) || /\s/u.test(record.placeholderWord)) {
    return invalid("checklist format placeholderWord must be a non-empty word without spaces", "for example \"下一版\"");
  }
  if (!nonEmptyString(record.overviewHeading) || !record.overviewHeading.trim().startsWith("#")) {
    return invalid("checklist format overviewHeading must be a Markdown heading", "for example \"## 场景总览\"");
  }
  const overviewColumns = stringList(record.overviewColumns);
  if (overviewColumns === null) {
    return invalid("checklist format overviewColumns must be a non-empty list of column names", "the default list has five columns");
  }
  if (new Set(overviewColumns).size !== overviewColumns.length) {
    return invalid("checklist format overviewColumns must not repeat a column name", "remove the duplicate column");
  }
  const statusVocabulary = stringList(record.statusVocabulary);
  if (statusVocabulary === null) {
    return invalid("checklist format statusVocabulary must be a non-empty list", "for example [\"待验证\",\"通过\",\"失败\"]");
  }
  if (new Set(statusVocabulary).size !== statusVocabulary.length) {
    return invalid("checklist format statusVocabulary must not repeat a status", "remove the duplicate status");
  }
  const resultPriority = stringList(record.resultPriority);
  if (resultPriority === null) {
    return invalid("checklist format resultPriority must be a non-empty list", "order the status words from lowest to highest priority");
  }
  const unknownPriority = resultPriority.find((word) => !statusVocabulary.includes(word));
  if (unknownPriority !== undefined) {
    return invalid(
      `checklist format resultPriority contains "${unknownPriority}", which is not in statusVocabulary`,
      "every priority word must also be a status word",
    );
  }
  if (!(record.scenarioIdPattern instanceof RegExp) || record.scenarioIdPattern.source.length === 0) {
    return invalid("checklist format scenarioIdPattern must be a non-empty RegExp", "for example /[A-Za-z0-9]{1,10}-\\d{2}(?![\\d-])/u");
  }
  if (!nonEmptyString(record.batchHeading)) {
    return invalid("checklist format batchHeading must be one non-empty line", "for example \"## 批次记录\"");
  }
  if (!nonEmptyString(record.auditHeading)) {
    return invalid("checklist format auditHeading must be one non-empty line", "for example \"## 候选与发布差异审计\"");
  }

  const format: ChecklistFormat = {
    titlePrefix: record.titlePrefix.trim(),
    placeholderWord: record.placeholderWord.trim(),
    overviewHeading: record.overviewHeading.trim(),
    overviewColumns: Object.freeze([...overviewColumns]),
    statusVocabulary: Object.freeze([...statusVocabulary]),
    resultPriority: Object.freeze([...resultPriority]),
    scenarioIdPattern: record.scenarioIdPattern,
    batchHeading: record.batchHeading.trim(),
    auditHeading: record.auditHeading.trim(),
  };
  return ok(Object.freeze(format));
}

/** Clone the id pattern with global matching; flags `g`/`y` are replaced. */
export function scenarioIdMatcher(format: ChecklistFormat, anchored: boolean): RegExp {
  const flags = format.scenarioIdPattern.flags.replace(/[gy]/gu, "");
  const source = format.scenarioIdPattern.source;
  return new RegExp(anchored ? `^(?:${source})$` : source, anchored ? flags : `${flags}g`);
}
