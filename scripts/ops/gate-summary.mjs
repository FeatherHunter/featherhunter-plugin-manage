#!/usr/bin/env node
// Summarize GATE-RESULT / GATE-SUMMARY lines from a teed test log.
// Why: a full matt chain writes ~3.7 MB and ~85 gates; reading it by hand 23 times was
// both slow and easy to mis-count.
//
// A log with no completion record is not evidence that the gates passed, and a gate
// line whose record cannot be read is not "no failure". So: no gate lines at all is an
// input error (exit 2, "未发现门禁行"), and unreadable gate lines fail the run (exit 1)
// with the offending line numbers and text printed.
import { parseArgs, readText, exists, emitJson, printHelp, die, red, green, dim, tail, routeLogsToStderrWhenJson } from "./lib/common.mjs";

const HELP = [
  "Usage: node scripts/ops/gate-summary.mjs --log <file> [options]",
  "",
  "Options:",
  "  --log <file>       Test log to read (required).",
  "  --json             Machine-readable output (stdout is JSON only).",
  "  --failures-only    Only print failing gates.",
  "  --tail <n>         With --failures-only, print the last n log lines (default 0).",
  "  --help             This message.",
  "",
  "Exit codes: 0 all gates passed, 1 failed assertions or unreadable gate lines,",
  "            2 input error (missing --log, unreadable file, no gate lines).",
];

// A gate line starts with the marker; anything after it must be the record JSON.
// Anchoring on the marker means a truncated or corrupted record is reported instead
// of being skipped as if the log simply had no gate lines.
const GATE_LINE = /^(GATE-RESULT|GATE-SUMMARY)(?:\s+(.*))?$/;

function parseCount(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  return null;
}

function toRecord(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const gate = typeof doc.gate === "string" ? doc.gate.trim() : "";
  if (!gate) return null;
  const assertions = parseCount(doc.assertions);
  const failed = parseCount(doc.failed);
  if (assertions === null || failed === null) return null;
  return { gate, assertions, failed };
}

function parseGateLines(text) {
  const lines = text.split(/\r?\n/);
  const results = [];
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = GATE_LINE.exec(line);
    if (!m) continue;
    let record = null;
    try { record = toRecord(JSON.parse(m[2] === undefined ? "" : m[2])); } catch { record = null; }
    if (!record) { bad.push({ line: i + 1, text: line }); continue; }
    results.push({ kind: m[1], gate: record.gate, assertions: record.assertions, failed: record.failed, line: i + 1 });
  }
  return { results, bad };
}

function noGateLinesMessage(logPath) {
  return "未发现门禁行 (no GATE-RESULT/GATE-SUMMARY lines found in " + logPath + ")";
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), {
    flags: { log: { type: "value" }, json: { type: "boolean" }, "failures-only": { type: "boolean" }, tail: { type: "value" }, help: { type: "boolean" } },
  });
  const options = parsed.options;
  routeLogsToStderrWhenJson(Boolean(options.json));
  if (options.help) { printHelp("gate-summary - summarize GATE-RESULT lines from a test log", HELP); return; }
  if (parsed.unknown.length) { die("unknown option(s): " + parsed.unknown.join(" "), 2); return; }
  const logPath = options.log ? String(options.log) : null;
  if (!logPath) { die("--log is required", 2); return; }
  if (!exists(logPath)) { die("log not found: " + logPath, 2); return; }
  const text = readText(logPath);
  if (text === null) { die("cannot read log: " + logPath, 2); return; }
  const { results, bad } = parseGateLines(text);
  const byGate = {};
  const failed = [];
  let totalAssertions = 0;
  for (const r of results) {
    const prev = byGate[r.gate];
    byGate[r.gate] = prev ? { assertions: Math.max(prev.assertions, r.assertions), failed: Math.max(prev.failed, r.failed), count: prev.count + 1 } : { assertions: r.assertions, failed: r.failed, count: 1 };
  }
  for (const [gate, rec] of Object.entries(byGate)) {
    totalAssertions += rec.assertions;
    if (rec.failed > 0) failed.push({ gate, assertions: rec.assertions, failed: rec.failed });
  }
  const noGateLines = results.length === 0 && bad.length === 0;
  const report = {
    log: logPath,
    bytes: Buffer.byteLength(text),
    gates: Object.keys(byGate).length,
    resultLines: results.length,
    totalAssertions,
    failed: failed,
    unparsed: bad,
    ok: !noGateLines && bad.length === 0 && failed.length === 0,
  };
  const exitCode = noGateLines ? 2 : report.ok ? 0 : 1;
  if (options.json) {
    emitJson(report);
    if (noGateLines) process.stderr.write(noGateLinesMessage(logPath) + "\n");
    process.exitCode = exitCode;
    return;
  }
  console.log("log   " + logPath + "  (" + report.bytes + " bytes)");
  console.log("gates " + report.gates + "  lines " + report.resultLines + "  assertions " + report.totalAssertions);
  if (noGateLines) {
    console.log(red(noGateLinesMessage(logPath)));
    process.exitCode = 2;
    return;
  }
  if (failed.length) {
    console.log(red("failed gates: " + failed.length));
    for (const f of failed) console.log("  " + red("FAIL") + "  " + f.gate + "  " + f.failed + "/" + f.assertions);
  } else if (!options["failures-only"]) {
    console.log(green("all gates passed: 0 failed assertions"));
  }
  if (bad.length) {
    console.log(red("unparsed gate lines: " + bad.length + " (gate log is corrupt; refusing to pass)"));
    for (const b of bad) console.log("  " + red("BAD") + "  line " + b.line + ": " + b.text);
  }
  if (options.tail) {
    const n = Number(options.tail);
    if (n > 0) console.log(dim("\n--- last " + n + " lines ---\n" + tail(text, n)));
  }
  process.exitCode = exitCode;
}

main().catch((e) => { console.error("gate-summary crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
