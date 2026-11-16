/**
 * A checklist ticket may be written in English or in Chinese.
 *
 * The shipped template is Chinese, and every record already stored on a tracker
 * is Chinese, so the Chinese forms must keep parsing. A repository that adopted
 * the English-first fork writes new tickets in English; those records must be
 * read just as well, otherwise translating the template would hand people a
 * template the release gate rejects.
 *
 * What must NOT move: the writers. `formatIdentityLine` and `formatBaseLine`
 * still emit the Chinese form, so re-writing an existing comment never changes
 * the bytes of a record that already exists.
 */
import { describe, expect, it } from "vitest";

import type { BatchName, CommitSha, Sha256Hex } from "../contracts/branding";
import {
  formatBaseLine,
  formatIdentityLine,
  parseBaseLine,
  parseIdentityLine,
} from "../contracts/identity";
import {
  DEFAULT_CHECKLIST_FORMAT,
  parseChecklistFormat,
  type ChecklistFormat,
} from "../contracts/checklist-format";
import { AUDIT_LINE_RE } from "../contracts/release-gate";

const COMMIT = "0123456789abcdef0123456789abcdef01234567" as CommitSha;
const SHA = "f".repeat(64) as Sha256Hex;

/** The English checklist format a translated repository would declare. */
const ENGLISH_FORMAT: ChecklistFormat = {
  titlePrefix: "[Real-machine verification]",
  placeholderWord: "Next",
  overviewHeading: "## Scenario overview",
  overviewColumns: ["Scenario number", "Source ticket", "One sentence", "Status", "Notes"],
  statusVocabulary: [
    "to be verified",
    "already verified",
    "passed",
    "failed",
    "exempt",
    "not tested",
    "blocked",
    "void",
  ],
  resultPriority: [
    "void",
    "to be verified",
    "blocked",
    "not tested",
    "already verified",
    "passed",
    "exempt",
    "failed",
  ],
  statusRoles: {
    passed: ["passed", "already verified"],
    failed: ["failed"],
    exempt: ["exempt"],
    needsComment: ["passed", "failed"],
  },
  batchStartMarker: "Batch start",
  scenarioIdPattern: /[A-Za-z0-9]{1,10}-\d{2}(?![\d-])/u,
  batchHeading: "## Batch records",
  auditHeading: "## Candidate and release difference audit",
};

describe("checklist identity lines", () => {
  it("still writes the Chinese form so stored records do not change", () => {
    const written = formatIdentityLine({
      batchName: "b1" as BatchName,
      commit: COMMIT,
      packageSha256: SHA,
    });
    expect(written.ok).toBe(true);
    expect(written.ok ? written.value : "").toContain("验证身份");
  });

  it("parses the English identity line", () => {
    const parsed = parseIdentityLine(
      `- Verification identity: batch b1; candidate commit ${COMMIT}; candidate package sha256 ${SHA}`,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.value.commit : "").toBe(COMMIT);
  });

  it("parses the English baseline line", () => {
    const parsed = parseBaseLine(`- Verification baseline: local main ${COMMIT}; target version 1.2.3`);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.value.expectedVersion : "").toBe("1.2.3");
  });

  it("keeps parsing the Chinese baseline line", () => {
    const written = formatBaseLine({ ref: "main", tip: COMMIT, expectedVersion: "1.2.3" });
    expect(written.ok).toBe(true);
    const parsed = parseBaseLine(written.ok ? written.value : "");
    expect(parsed.ok).toBe(true);
  });

  it("rejects a near-miss identity line in either language", () => {
    expect(parseIdentityLine(`- Verification identity: batch b1; candidate commit ${COMMIT}`).ok).toBe(false);
    expect(parseIdentityLine(`- 验证身份：批次 b1；候选提交 ${COMMIT}`).ok).toBe(false);
  });
});

describe("candidate-versus-release audit line", () => {
  it("matches the English audit line", () => {
    const line = `- Candidate commit ${COMMIT} → release commit ${"a".repeat(40)}: docs only, no artifact change`;
    expect(AUDIT_LINE_RE.exec(line)?.[1]).toBe(COMMIT);
  });

  it("matches the Chinese audit line", () => {
    const line = `- 候选提交 ${COMMIT} → 发布提交 ${"a".repeat(40)}：只改了文档，产物没变`;
    expect(AUDIT_LINE_RE.exec(line)?.[1]).toBe(COMMIT);
  });
});

describe("checklist format", () => {
  it("keeps the shipped Chinese default when nothing is declared", () => {
    expect(DEFAULT_CHECKLIST_FORMAT.titlePrefix).toBe("[真机验证]");
    expect(DEFAULT_CHECKLIST_FORMAT.statusRoles.passed).toContain("通过");
  });

  it("accepts a declared English format with its own roles", () => {
    const parsed = parseChecklistFormat(ENGLISH_FORMAT);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.value.statusRoles.failed : []).toEqual(["failed"]);
  });

  it("refuses an English vocabulary that omits the semantic roles", () => {
    const withoutRoles = { ...ENGLISH_FORMAT, statusRoles: undefined };
    const parsed = parseChecklistFormat(withoutRoles);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error.hint).toContain("statusRoles");
  });

  it("refuses a role word that the vocabulary cannot contain", () => {
    const bad = { ...ENGLISH_FORMAT, statusRoles: { ...ENGLISH_FORMAT.statusRoles, failed: ["nope"] } };
    expect(parseChecklistFormat(bad).ok).toBe(false);
  });
});

describe("writers choose their language, default unchanged", () => {
  it("writes the English identity line on request and reads it back", () => {
    const written = formatIdentityLine(
      { batchName: "b1" as BatchName, commit: COMMIT, packageSha256: SHA },
      "en",
    );
    expect(written.ok).toBe(true);
    const round = parseIdentityLine(written.ok ? written.value : "");
    expect(round.ok ? round.value.packageSha256 : "").toBe(SHA);
  });

  it("writes the English baseline line on request and reads it back", () => {
    const written = formatBaseLine({ ref: "main", tip: COMMIT, expectedVersion: "1.2.3" }, "en");
    expect(written.ok).toBe(true);
    expect(written.ok ? written.value : "").toContain("Verification baseline");
    const round = parseBaseLine(written.ok ? written.value : "");
    expect(round.ok ? round.value.ref : "").toBe("main");
  });

  it("still defaults to Chinese when no language is given", () => {
    const written = formatBaseLine({ ref: "main", tip: COMMIT, expectedVersion: "1.2.3" });
    expect(written.ok ? written.value : "").toContain("验证基线");
  });
});
