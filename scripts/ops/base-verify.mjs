#!/usr/bin/env node
// Run the base package's verification gates in one fixed order, teeing each step to a log.
// Replaces the repeated manual sequence: npm run typecheck, npx vitest run,
// npm run docs:check, npm run build (155 such commands in one session, 31 full npm test runs).
import fs from "node:fs";
import path from "node:path";
import {
  parseArgs, runCommandLine, runLogged, exists, resolveRepoSpec, DEFAULT_REPOS, routeLogsToStderrWhenJson,
  green, red, yellow, dim, emitJson, printHelp, die, formatDuration, ensureDir, nowStamp, tail, bin,
} from "./lib/common.mjs";
import { scanSources, formatScanText } from "./scan-sources.mjs";

const HELP = [
  "Usage: node scripts/ops/base-verify.mjs [options]",
  "",
  "Options:",
  "  --repo <name|path>   Publisher repo (default: base).",
  "  --package <dir>      Base package dir relative to repo (default: packages/base).",
  "  --quick              Only typecheck + tests.",
  "  --only <ids>         Comma list: typecheck,tests,docs,scan,build (implies non-quick).",
  "  --filter <text>      Substring filter for vitest (only with the tests step).",
  "  --keep-going         Run every step even after a failure (default: stop at first).",
  "  --no-log             Do not write per-step logs.",
  "  --log-dir <dir>      Log directory (default: <repo>/.tmp/ops-logs).",
  "  --tail <n>           On failure print the last n log lines (default 30).",
  "  --json               Machine-readable summary.",
  "  --help               This message.",
  "",
  "Steps run in a fixed order: typecheck -> tests -> docs -> scan -> build.",
  "The scan step rejects NUL bytes and undecodable UTF-8 in repo text sources.",
  "",
  "Exit codes: 0 all green, 1 a step failed, 2 prerequisite error.",
];

const ALL_STEPS = ["typecheck", "tests", "docs", "scan", "build"];

function summaryOf(id, text) {
  if (id === "tests") {
    const files = /Test Files\s+(.+)/.exec(text);
    const tests = /^\s*Tests\s+(.+)$/m.exec(text);
    const duration = /Duration\s+(.+)/.exec(text);
    return { files: files ? files[1].trim() : null, tests: tests ? tests[1].trim() : null, duration: duration ? duration[1].trim() : null };
  }
  if (id === "typecheck") {
    const line = text.split("\n").map((s) => s.trim()).filter((s) => s.length).slice(-1)[0];
    return { lastLine: line || null };
  }
  if (id === "docs" || id === "build") {
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    return { lastLine: lines.length ? lines[lines.length - 1] : null };
  }
  return {};
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), {
    flags: {
      repo: { type: "value" }, package: { type: "value" }, quick: { type: "boolean" },
      only: { type: "value" }, filter: { type: "value" }, "keep-going": { type: "boolean" },
      "no-log": { type: "boolean" }, "log-dir": { type: "value" }, tail: { type: "value" },
      json: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  const options = parsed.options;
  routeLogsToStderrWhenJson(Boolean(options.json));
  if (options.help) { printHelp("base-verify - run base gates in one fixed order", HELP); return; }
  if (parsed.unknown.length) { die("unknown option(s): " + parsed.unknown.join(" "), 2); return; }
  const repo = resolveRepoSpec(options.repo || "base");
  const packageDir = path.resolve(repo.path, options.package || "packages/base");
  if (!exists(path.join(packageDir, "package.json"))) { die("not a package dir: " + packageDir, 2); return; }

  let ids;
  if (options.only) {
    ids = String(options.only).split(",").map((s) => s.trim()).filter(Boolean);
    const bad = ids.filter((id) => ALL_STEPS.indexOf(id) < 0);
    if (bad.length) { die("unknown step(s): " + bad.join(", "), 2); return; }
  } else if (options.quick) ids = ["typecheck", "tests"];
  else ids = ALL_STEPS.slice();

  if (options.filter && !/^[A-Za-z0-9_./\\:-]+$/.test(String(options.filter))) {
    die("unsafe --filter value: " + options.filter, 2);
    return;
  }
  const logDir = path.resolve(options["log-dir"] || path.join(repo.path, ".tmp", "ops-logs"));
  const writeLogs = !options["no-log"];
  if (writeLogs) ensureDir(logDir);
  const stamp = nowStamp();
  const vitestEntry = path.join(packageDir, "node_modules", "vitest", "vitest.mjs");
  const tailLines = Number(options.tail || 30);

  const report = { repo: repo.path, packageDir, steps: [], ok: false, logDir: writeLogs ? logDir : null };
  for (const id of ids) {
    let line;
    let useNode = false;
    if (id === "typecheck") line = "npm run typecheck";
    else if (id === "docs") line = "npm run docs:check";
    else if (id === "build") line = "npm run build";
    else if (id === "scan") line = "node scripts/ops/scan-sources.mjs --repo " + repo.path;
    else if (id === "tests") {
      if (exists(vitestEntry)) {
        useNode = true;
        line = path.join(packageDir, "node_modules", ".bin", "vitest") + " run" + (options.filter ? " " + options.filter : "");
      } else {
        line = "npx vitest run" + (options.filter ? " " + options.filter : "");
      }
    }
    const logFile = writeLogs ? path.join(logDir, "base-verify-" + stamp + "-" + id + ".log") : null;
    console.log("");
    console.log("== " + id + "  " + dim(line));
    const started = Date.now();
    let run;
    let scan = null;
    if (id === "scan") {
      // Scanned in-process: the walk is read-only and fast, and keeping the
      // structured issues lets the JSON report list every offending path.
      try {
        scan = scanSources({ repoRoot: repo.path });
      } catch (error) {
        scan = {
          repo: repo.path, roots: [], scanned: 0, ok: false,
          issues: [{ file: repo.path, path: ".", reason: "scan-error", message: String(error && error.message ? error.message : error) }],
        };
      }
      const text = formatScanText(scan);
      if (logFile) fs.appendFileSync(logFile, text + "\n");
      console.log(text);
      run = { code: scan.ok ? 0 : 1, durationMs: Date.now() - started, stdout: text + "\n", stderr: "" };
    } else {
      // Spawn node directly for vitest: going through cmd.exe mangles quoted absolute paths.
      run = useNode
        ? await runLogged(process.execPath, [vitestEntry, "run"].concat(options.filter ? [String(options.filter)] : []), { cwd: packageDir, logFile, echo: !options.json })
        : await runCommandLine(line, { cwd: packageDir, logFile, echo: !options.json });
    }
    const step = {
      id, command: line, exitCode: run.code, durationMs: run.durationMs, logFile,
      summary: scan ? { scanned: scan.scanned, issues: scan.issues } : summaryOf(id, run.stdout + "\n" + run.stderr),
    };
    step.ok = run.code === 0;
    report.steps.push(step);
    console.log("-- " + id + " " + (step.ok ? green("OK") : red("FAILED exit " + run.code)) + "  " + formatDuration(run.durationMs));
    if (!step.ok) {
      if (writeLogs) console.log("   log: " + logFile);
      if (tailLines > 0) console.log(dim(tail((run.stdout + "\n" + run.stderr), tailLines)));
      if (!options["keep-going"]) break;
    }
  }
  report.ok = report.steps.length > 0 && report.steps.every((s) => s.ok);
  if (options.json) { emitJson(report); process.exitCode = report.ok ? 0 : 1; return; }
  console.log("");
  console.log("base-verify " + (report.ok ? green("OK") : red("FAILED")) + "  " + report.steps.filter((s) => s.ok).length + "/" + report.steps.length + " steps");
  for (const s of report.steps) {
    const detail = s.summary && s.summary.tests ? "  " + s.summary.files + " / " + s.summary.tests : "";
    console.log("  " + (s.ok ? green("PASS") : red("FAIL")) + "  " + s.id.padEnd(10) + formatDuration(s.durationMs) + detail);
  }
  if (report.steps.some((s) => !s.ok) && report.steps.every((s) => s.id !== "tests" || s.ok)) {
    // keep the failure surface explicit even when the failing step's summary is empty
    console.log(yellow("one or more steps failed; see logs above"));
  }
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((e) => { console.error("base-verify crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
