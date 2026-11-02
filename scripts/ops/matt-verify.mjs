#!/usr/bin/env node
// Preflight for the matt repo before real-machine acceptance: catch the two staleness traps
// that broke full test runs twice (generated markdown-format source, gate-map ownership table),
// then typecheck, then optionally run the real-machine scenarios against an isolated home.
// Read-only unless --fix (regenerates) or --ui/--smoke (spawns real DSH instances).
import fs from "node:fs";
import path from "node:path";
import {
  parseArgs, runLogged, runCommandLine, exists, resolveRepoSpec, DEFAULT_REPOS, detectJson, routeLogsToStderrWhenJson,
  green, red, yellow, dim, emitJson, printHelp, die, formatDuration, ensureDir, nowStamp, tail,
} from "./lib/common.mjs";

const HELP = [
  "Usage: node scripts/ops/matt-verify.mjs [options]",
  "",
  "Default steps (read-only): generated-source check, gate-map verification, typecheck.",
  "",
  "Options:",
  "  --repo <name|path>    Repo (default: matt).",
  "  --fix                 Regenerate stale artifacts instead of failing.",
  "  --skip-generated      Skip the generated-source check.",
  "  --skip-gate-map       Skip the gate-map check.",
  "  --skip-typecheck      Skip typecheck.",
  "  --ui                  Also run verify/scenarios/ui.ts (spawns a real DSH instance).",
  "  --smoke               Also run verify/scenarios/smoke.ts (spawns two instances).",
  "  --npm-test            Also run the full npm test chain (slow, ~20 min).",
  "  --dsh-home <dir>      DSH_HOME for scenarios (default: D:/Temp/matt-batch-home).",
  "  --work-root <dir>     Work root for scenarios (default: D:/Temp/matt-ops-work).",
  "  --no-log              Do not write per-step logs.",
  "  --log-dir <dir>       Log directory (default: <repo>/.tmp/ops-logs).",
  "  --tail <n>            On failure print the last n lines (default 40).",
  "  --json                Machine-readable summary.",
  "  --help                This message.",
  "",
  "Exit codes: 0 all green, 1 a check failed, 2 prerequisite error.",
];

function parseUiResult(text) {
  const doc = detectJson(text);
  if (!doc) return null;
  const checks = Array.isArray(doc.checks) ? doc.checks : [];
  const counts = { pass: 0, fail: 0, skip: 0, blocked: 0, total: checks.length };
  const failures = [];
  for (const c of checks) {
    const status = c && c.status;
    if (counts[status] !== undefined) counts[status]++;
    if (status === "fail") failures.push({ id: c.id, title: c.title, hint: c.hint || null, actual: c.actual || null });
  }
  return {
    state: doc.state || null,
    profile: doc.profile || null,
    counts,
    failures,
    reportPath: doc.artifacts && doc.artifacts.reportPath ? doc.artifacts.reportPath : null,
    reportSha256: doc.artifacts && doc.artifacts.reportSha256 ? doc.artifacts.reportSha256 : null,
    evidence: Array.isArray(doc.evidence) ? doc.evidence.length : null,
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), {
    flags: {
      repo: { type: "value" }, fix: { type: "boolean" },
      "skip-generated": { type: "boolean" }, "skip-gate-map": { type: "boolean" }, "skip-typecheck": { type: "boolean" },
      ui: { type: "boolean" }, smoke: { type: "boolean" }, "npm-test": { type: "boolean" },
      "dsh-home": { type: "value" }, "work-root": { type: "value" },
      "no-log": { type: "boolean" }, "log-dir": { type: "value" }, tail: { type: "value" },
      json: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  const options = parsed.options;
  routeLogsToStderrWhenJson(Boolean(options.json));
  if (options.help) { printHelp("matt-verify - preflight matt before real-machine acceptance", HELP); return; }
  if (parsed.unknown.length) { die("unknown option(s): " + parsed.unknown.join(" "), 2); return; }
  const repo = resolveRepoSpec(options.repo || "matt");
  if (!exists(repo.path)) { die("repo not found: " + repo.path, 2); return; }
  const repoPath = repo.path;
  if (!exists(path.join(repoPath, "scripts", "typecheck.mts"))) { die("not the matt repo: " + repoPath, 2); return; }

  const logDir = path.resolve(options["log-dir"] || path.join(repoPath, ".tmp", "ops-logs"));
  const writeLogs = !options["no-log"];
  if (writeLogs) ensureDir(logDir);
  const stamp = nowStamp();
  const tailLines = Number(options.tail || 40);
  const report = { repo: repoPath, steps: [], ok: false, fix: Boolean(options.fix) };

  function gitStatus() {
    const r = runCaptureGit(repoPath, ["status", "--porcelain"]);
    return r;
  }
  const beforeStatus = gitStatus();

  async function step(id, command, args, opts) {
    opts = opts || {};
    const logFile = writeLogs ? path.join(logDir, "matt-verify-" + stamp + "-" + id + ".log") : null;
    console.log("");
    console.log("== " + id + "  " + dim(command + " " + args.join(" ")));
    const run = await runLogged(process.execPath, args, Object.assign({ cwd: repoPath, logFile, echo: !options.json }, opts.runOptions || {}));
    const rec = { id, command: command + " " + args.join(" "), exitCode: run.code, durationMs: run.durationMs, logFile };
    rec.ok = run.code === 0;
    if (opts.parse) rec.parsed = opts.parse(run.stdout + "\n" + run.stderr);
    report.steps.push(rec);
    console.log("-- " + id + " " + (rec.ok ? green("OK") : red("FAILED exit " + run.code)) + "  " + formatDuration(run.durationMs));
    if (!rec.ok) {
      if (writeLogs) console.log("   log: " + logFile);
      if (tailLines > 0) console.log(dim(tail(run.stdout + "\n" + run.stderr, tailLines)));
    }
    return rec;
  }

  // 1. generated-source check (the check the typecheck chain runs first).
  if (!options["skip-generated"]) {
    let rec = await step("generated", "node scripts/generate-md-format-config.mts --check", ["scripts/generate-md-format-config.mts", "--check"]);
    if (!rec.ok && options.fix) {
      console.log(yellow("regenerating markdown-format config (--fix)"));
      const regen = await step("generated-fix", "node scripts/generate-md-format-config.mts", ["scripts/generate-md-format-config.mts"]);
      if (!regen.ok) { report.ok = false; if (!options.json) finish(report, beforeStatus); process.exitCode = 1; return; }
      rec = await step("generated-recheck", "node scripts/generate-md-format-config.mts --check", ["scripts/generate-md-format-config.mts", "--check"]);
    }
    if (!rec.ok && !options.fix) {
      console.log(yellow("hint: the generated source is stale; rerun with --fix (it regenerates, it does not hide the failure)"));
    }
  }

  // 2. gate-map: verify the ownership table against the chain and the source tree.
  if (!options["skip-gate-map"]) {
    let rec = await step("gate-map-check", "node --import ./scripts/ts-hook.mts tests/verify-gate-map.ts", ["--import", "./scripts/ts-hook.mts", "tests/verify-gate-map.ts"]);
    if (!rec.ok && options.fix) {
      console.log(yellow("regenerating gate-map (--fix)"));
      const regen = await step("gate-map-fix", "node scripts/gate-map.mts", ["scripts/gate-map.mts"]);
      if (regen.ok) rec = await step("gate-map-recheck", "node --import ./scripts/ts-hook.mts tests/verify-gate-map.ts", ["--import", "./scripts/ts-hook.mts", "tests/verify-gate-map.ts"]);
    }
    if (!rec.ok && !options.fix) {
      console.log(yellow("hint: after merges the table goes stale; rerun with --fix (it regenerates tests/gate-map.json)"));
    }
  }

  // 3. typecheck (its own script, not npm run).
  if (!options["skip-typecheck"]) {
    await step("typecheck", "node scripts/typecheck.mts", ["scripts/typecheck.mts"]);
  }

  // 4. real-machine scenarios (opt-in: they spawn real DSH instances).
  const dshHome = path.resolve(options["dsh-home"] || "D:/Temp/matt-batch-home");
  const workRoot = path.resolve(options["work-root"] || "D:/Temp/matt-ops-work");
  const baseCli = path.join(repoPath, "node_modules", "dsh-featherhunter-plugin-base", "dist", "real-machine-verification", "cli", "main.js");
  for (const scenario of [options.ui ? "verify/scenarios/ui.ts" : null, options.smoke ? "verify/scenarios/smoke.ts" : null]) {
    if (!scenario) continue;
    if (!exists(dshHome)) { die("scenario home not found: " + dshHome + " (copy the real profiles/web into a batch home first)", 2); return; }
    if (!exists(baseCli)) { die("base CLI not installed in the repo: " + baseCli + " (run the package manager first)", 2); return; }
    const id = "scenario-" + path.basename(scenario, ".ts");
    const args = ["--import", "./scripts/ts-hook.mts", baseCli, "run", scenario, "--profile", "web", "--work-root", workRoot, "--json"];
    await step(id, "dsh-verify run " + scenario, args, {
      runOptions: { env: Object.assign({}, process.env, { DSH_HOME: dshHome }) },
      parse: parseUiResult,
    });
  }
  if (options["npm-test"]) {
    console.log("");
    console.log("== npm-test  npm test");
    const logFile = writeLogs ? path.join(logDir, "matt-verify-" + stamp + "-npm-test.log") : null;
    const run = await runCommandLine("npm test", { cwd: repoPath, logFile, echo: !options.json });
    const rec = { id: "npm-test", command: "npm test", exitCode: run.code, durationMs: run.durationMs, logFile, ok: run.code === 0 };
    report.steps.push(rec);
    console.log("-- npm-test " + (rec.ok ? green("OK") : red("FAILED exit " + run.code)) + "  " + formatDuration(run.durationMs));
    if (!rec.ok && logFile) console.log("   log: " + logFile);
  }

  const afterStatus = gitStatus();
  report.git = { before: beforeStatus, after: afterStatus, changed: beforeStatus !== afterStatus };
  if (report.git.changed) {
    console.log("");
    console.log(yellow("git status changed during this run:"));
    console.log(dim("before:\n" + beforeStatus + "\nafter:\n" + afterStatus));
  } else {
    console.log("");
    console.log(dim("git status unchanged during this run"));
  }

  report.ok = report.steps.length > 0 && report.steps.every((s) => s.ok);
  finish(report, beforeStatus);
  process.exitCode = report.ok ? 0 : 1;
}

import { runCapture } from "./lib/common.mjs";
function runCaptureGit(repo, args) {
  const r = runCapture("git", ["-C", repo].concat(args));
  return r.code === 0 ? r.stdout.trim() : "git failed: " + r.stderr.trim();
}

function finish(report, beforeStatus) {
  const json = Boolean(process.argv.indexOf("--json") >= 0);
  if (json) { emitJson(report); return; }
  console.log("");
  console.log("matt-verify " + (report.ok ? green("OK") : red("FAILED")) + "  " + report.steps.filter((s) => s.ok).length + "/" + report.steps.length + " steps");
  for (const s of report.steps) {
    let extra = "";
    if (s.parsed && s.parsed.counts) extra = "  " + JSON.stringify(s.parsed.counts);
    console.log("  " + (s.ok ? green("PASS") : red("FAIL")) + "  " + s.id.padEnd(18) + formatDuration(s.durationMs) + extra);
    if (s.parsed && s.parsed.reportPath) console.log("        report: " + s.parsed.reportPath);
  }
}

main().catch((e) => { console.error("matt-verify crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
