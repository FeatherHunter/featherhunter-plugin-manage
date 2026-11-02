#!/usr/bin/env node
// Summarize GATE-RESULT / GATE-SUMMARY lines from a teed test log.
// Why: a full matt chain writes ~3.7 MB and ~85 gates; reading it by hand 23 times was
// both slow and easy to mis-count.
import fs from "node:fs";
import { parseArgs, readText, exists, emitJson, printHelp, die, red, green, yellow, dim, tail, routeLogsToStderrWhenJson } from "./lib/common.mjs";

const HELP = [
  "Usage: node scripts/ops/gate-summary.mjs --log <file> [options]",
  "",
  "Options:",
  "  --log <file>       Test log to read (required).",
  "  --json             Machine-readable output.",
  "  --failures-only    Only print failing gates.",
  "  --tail <n>         With --failures-only, print the last n log lines (default 0).",
  "  --help             This message.",
  "",
  "Exit codes: 0 no failed assertions, 1 failed assertions found, 2 input error.",
];

function parseGateLines(text) {
  const lines = text.split(/\r?\n/);
  const results = [];
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /(GATE-RESULT|GATE-SUMMARY)\s*(\{.*\})\s*$/.exec(line.trim());
    if (!m) continue;
    try {
      const doc = JSON.parse(m[2]);
      results.push({ kind: m[1], gate: doc.gate || "(unnamed)", assertions: Number(doc.assertions || 0), failed: Number(doc.failed || 0), line: i + 1 });
    } catch {
      bad.push({ line: i + 1, text: line.trim().slice(0, 200) });
    }
  }
  return { results, bad };
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
  const report = {
    log: logPath,
    bytes: Buffer.byteLength(text),
    gates: Object.keys(byGate).length,
    resultLines: results.length,
    totalAssertions,
    failed: failed,
    unparsed: bad,
    ok: failed.length === 0 && results.length > 0,
  };
  if (options.json) { emitJson(report); process.exitCode = report.ok ? 0 : 1; return; }
  console.log("log   " + logPath + "  (" + report.bytes + " bytes)");
  console.log("gates " + report.gates + "  lines " + report.resultLines + "  assertions " + report.totalAssertions);
  if (!results.length) {
    console.log(red("no GATE-RESULT/GATE-SUMMARY lines found"));
    process.exitCode = 1;
    return;
  }
  if (failed.length) {
    console.log(red("failed gates: " + failed.length));
    for (const f of failed) console.log("  " + red("FAIL") + "  " + f.gate + "  " + f.failed + "/" + f.assertions);
  } else if (!options["failures-only"]) {
    console.log(green("all gates passed: 0 failed assertions"));
  }
  if (bad.length) {
    console.log(yellow("unparsed gate lines: " + bad.length));
    for (const b of bad.slice(0, 10)) console.log("  line " + b.line + ": " + b.text);
  }
  if (options.tail) {
    const n = Number(options.tail);
    if (n > 0) console.log(dim("\n--- last " + n + " lines ---\n" + tail(text, n)));
  }
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((e) => { console.error("gate-summary crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
