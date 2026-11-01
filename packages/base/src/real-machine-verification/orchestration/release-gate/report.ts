/**
 * Human rendering for the release gate.
 *
 * The check lines reuse the self-check contract (status word, id, detail, then
 * indented comparison lines), so a reader and a log parser need only one
 * format. The footer adds what is specific to a release: the version, the
 * candidate, the checklist ticket and the decision with its exit code.
 */
import type { ReleaseGateReport } from "../../contracts/release-gate";
import { renderCheckLines } from "../report";

/** Render a release-gate report for a terminal or a CI log. */
export function renderReleaseGateHuman(report: ReleaseGateReport): string {
  const lines: string[] = [];
  for (const check of report.checks) lines.push(...renderCheckLines(check));

  lines.push(`release: v${report.version} at ${report.releaseCommit}`);
  lines.push(
    report.candidate === null
      ? "candidate: none"
      : `candidate: ${report.candidate.commit} (${report.candidate.validity})`,
  );
  lines.push(
    report.ticket.number === null
      ? `checklist: none (${report.ticket.exactCount} exact, ${report.ticket.identities} identity line(s))`
      : `checklist: #${report.ticket.number} (${report.ticket.identities} identity line(s), latest batch ${report.ticket.latestBatch ?? "none"})`,
  );
  if (report.records.auditLine !== null) lines.push(`audit: ${report.records.auditLine}`);
  for (const reason of report.blocked) {
    lines.push(`blocked(${reason.code}): ${reason.message}`);
    lines.push(`  hint:     ${reason.hint}`);
  }
  for (const note of report.notes) lines.push(`note: ${note}`);
  lines.push(`decision: ${report.decision} (exit ${report.exitCode})`);
  return lines.join("\n");
}
