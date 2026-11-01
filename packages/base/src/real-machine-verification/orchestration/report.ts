/**
 * Report writing and the human rendering contract.
 *
 * `run.json` is the durable artifact: the same `RunReport` the JSON mode prints,
 * written before anything is printed so a crashed stdout cannot lose the report.
 * Its sha256 goes next to it (and is echoed in the human tail), which lets a
 * reviewer answer "is this the report I was shown?" with one command.
 *
 * The human line format is part of the CLI contract:
 *
 * ```text
 * ok dsh-runtime found the DSH install at ...
 * fail node-version Node v20.0.0 is older than the required 22.6.0
 *   expected: Node 22.6.0 or newer
 *   actual:   Node v20.0.0
 *   hint:     upgrade Node ...
 * ```
 *
 * A `fail` or `blocked` line is followed by indented comparison lines; nothing
 * else may appear between check lines. The tail names the report, its sha256 and
 * the evidence directory so a reader can leave the terminal and verify.
 */
import type { CheckResult } from "../contracts/check";
import type { FsPort } from "../contracts/ports";
import { sha256Text } from "../contracts/identity";
import { ok, type Result } from "../contracts/result";
import { runReportJson, type RunReport } from "../contracts/run-state";
import { joinFsPath } from "../runtime/paths";

/** Status word used at the start of every human check line. */
const STATUS_WORD: Readonly<Record<CheckResult["status"], string>> = {
  pass: "ok",
  fail: "fail",
  skip: "skip",
  blocked: "blocked",
};

/** What the tail of a human report needs to be verifiable off-line. */
export interface HumanReportTail {
  readonly reportPath: string;
  readonly reportSha256: string;
  readonly evidenceDir: string;
  readonly evidenceCount: number;
}

/**
 * Render one check and its comparison lines.
 *
 * Exported separately because the CLI's line format is asserted on its own: a
 * check line and its indented details are one unit, and a reader (or a regex)
 * should be able to parse them without the rest of the output.
 */
export function renderCheckLines(check: CheckResult): readonly string[] {
  const lines: string[] = [`${STATUS_WORD[check.status]} ${check.id} ${check.detail}`];
  if (check.status === "fail" || check.status === "blocked") {
    if (check.expected !== undefined) lines.push(`  expected: ${check.expected}`);
    if (check.actual !== undefined) lines.push(`  actual:   ${check.actual}`);
    if (check.hint !== undefined) lines.push(`  hint:     ${check.hint}`);
  }
  return lines;
}

/** Human-mode stdout: one block per check, then the verifiable tail. */
export function renderSelfCheckHuman(report: RunReport, tail?: HumanReportTail): string {
  const lines: string[] = [];
  for (const check of report.checks) lines.push(...renderCheckLines(check));
  if (tail !== undefined) {
    lines.push(`report: ${tail.reportPath}`);
    lines.push(`report-sha256: ${tail.reportSha256}`);
    lines.push(`evidence: ${tail.evidenceDir} (${tail.evidenceCount} item(s))`);
  }
  return lines.join("\n");
}

/** The durable pieces produced by writing a report. */
export interface WrittenRunReport {
  readonly reportPath: string;
  readonly reportSha256: string;
  readonly evidenceDir: string;
  /** Exact bytes written to `run.json`; the hash above is over these. */
  readonly content: string;
}

export interface WriteRunReportOptions {
  readonly fs: FsPort;
  readonly runDir: string;
  readonly report: RunReport;
}

/**
 * Write `run.json` and `run.json.sha256`.
 *
 * The hash is computed over exactly the bytes written, in the `sha256sum` format
 * (`<hex>  run.json`), so `sha256sum -c run.json.sha256` works without this tool.
 */
export async function writeRunReport(options: WriteRunReportOptions): Promise<Result<WrittenRunReport>> {
  const { fs, runDir, report } = options;
  const reportPath = joinFsPath(runDir, "run.json");
  const content = `${runReportJson(report)}\n`;
  const made = await fs.makeDir(runDir);
  if (!made.ok) return made;
  const written = await fs.writeText(reportPath, content);
  if (!written.ok) return written;
  const reportSha256 = sha256Text(content);
  const checksum = await fs.writeText(joinFsPath(runDir, "run.json.sha256"), `${reportSha256}  run.json\n`);
  if (!checksum.ok) return checksum;
  return ok({
    reportPath,
    reportSha256,
    evidenceDir: joinFsPath(runDir, "evidence"),
    content,
  });
}

/**
 * Add the digest to the in-memory report that is printed.
 *
 * `run.json` cannot contain its own hash, so the printed report carries the
 * digest of the file that was just written; a verifier hashes the file and
 * compares. This keeps the file and the printed claim linked without a
 * self-referential document.
 */
export function withReportDigest(report: RunReport, written: WrittenRunReport): RunReport {
  return {
    ...report,
    artifacts: {
      ...(report.artifacts ?? {}),
      report: written.reportPath,
      reportSha256: written.reportSha256,
    },
  };
}
