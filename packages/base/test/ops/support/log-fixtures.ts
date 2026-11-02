/**
 * Log fixtures for the gate-summary contract (ticket 03).
 *
 * A teed gate log is plain text: unrelated test output wrapped around the
 * completion records each gate prints when it finishes. The record shape is the
 * one the gate tooling already emits:
 *
 *     GATE-RESULT {"gate":"verify-example","assertions":3,"failed":0}
 *     GATE-SUMMARY {"gate":"verify-example","assertions":3,"failed":0}
 *
 * Fixtures stay plain text on purpose: the tests drive scripts/ops/gate-summary.mjs
 * across its process boundary and never import the script's internals.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GateRecord {
  gate: string;
  assertions: number;
  failed: number;
}

/** One completion record, exactly as a gate prints it before exiting. */
export function gateResultLine(record: GateRecord): string {
  return "GATE-RESULT " + JSON.stringify(record);
}

/** The trailing summary line a gate prints right after its result record. */
export function gateSummaryLine(record: GateRecord): string {
  return "GATE-SUMMARY " + JSON.stringify(record);
}

/** A gate's full output: the result line plus its summary line (same record). */
export function gatePair(record: GateRecord): string[] {
  return [gateResultLine(record), gateSummaryLine(record)];
}

/** Join fixture lines the way a teed log stores them (trailing newline included). */
export function logText(lines: readonly string[]): string {
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

/** Write a fixture log under dir and return its absolute path. */
export function writeLogFile(dir: string, name: string, lines: readonly string[]): string {
  const file = join(dir, name);
  writeFileSync(file, logText(lines), "utf8");
  return file;
}

/** Gates shared by the fixtures. The names are unique tokens the tests look for. */
export const PASSING_GATE: GateRecord = { gate: "verify-alpha", assertions: 3, failed: 0 };
export const FAILING_GATE: GateRecord = { gate: "verify-beta", assertions: 5, failed: 2 };
export const OTHER_PASSING_GATE: GateRecord = { gate: "verify-gamma", assertions: 4, failed: 0 };
