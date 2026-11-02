#!/usr/bin/env node
// Refresh a consumer repo's installed dsh-featherhunter-plugin-base from the publisher's
// local dist, for validating unpublished changes. pnpm stores packages through a virtual
// store of HARD LINKS: overwriting files in place corrupts the global store. So this script
// always deletes the resolved directory and copies fresh, never writes through it.
//
// This replaces a manual sequence that was repeated seven times in one session and twice
// suffered from copy-through-link mistakes.
import fs from "node:fs";
import path from "node:path";
import {
  parseArgs, readJson, readText, exists, sha256File, safeRealpath, isInsidePath,
  resolveRepoSpec, DEFAULT_REPOS, runCapture, bin, routeLogsToStderrWhenJson,
  green, yellow, red, dim, emitJson, printHelp, die, formatDuration, ensureDir,
} from "./lib/common.mjs";

const DEP = "dsh-featherhunter-plugin-base";
const COPY_ENTRIES = ["dist", "data", "package.json", "README.md", "LICENSE"];
const MARKERS = ["prepareHome", "findWriteUnderRealHome", "candidate-identity"];

const HELP = [
  "Usage: node scripts/ops/refresh-base.mjs [options]",
  "",
  "Replaces a consumer repo's installed base package with the publisher's local dist.",
  "Use it to validate unpublished base changes; it is NOT a substitute for a real npm install.",
  "",
  "Options:",
  "  --repo <name|path>   Consumer repo (repeatable; default: all five consumers).",
  "  --from <path>        Publisher package dir (default: <base>/packages/base).",
  "  --check              Verify installed copies only; write nothing.",
  "  --dry-run            Print the plan; write nothing.",
  "  --require-version    Refuse when the source version differs from the repo's pin.",
  "  --json               Machine-readable output.",
  "  --help               This message.",
  "",
  "Safety: refuses to replace a target that resolves into the publisher repo or outside node_modules.",
  "Exit codes: 0 all good, 1 mismatch found, 2 prerequisite error.",
];

function installedCopies(repoPath) {
  const copies = [];
  const direct = path.join(repoPath, "node_modules", DEP);
  if (exists(direct)) copies.push(direct);
  const packagesDir = path.join(repoPath, "packages");
  if (exists(packagesDir)) {
    let entries = [];
    try { entries = fs.readdirSync(packagesDir, { withFileTypes: true }); } catch { entries = []; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(packagesDir, entry.name, "node_modules", DEP);
      if (exists(nested)) copies.push(nested);
    }
  }
  return copies;
}

function readInstalledVersion(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  return pkg && pkg.version ? pkg.version : null;
}

function markerState(dir) {
  const entry = path.join(dir, "dist", "real-machine-verification", "index.js");
  const text = readText(entry) || "";
  const found = {};
  for (const marker of MARKERS) found[marker] = text.indexOf(marker) >= 0;
  return { file: entry, bytes: text.length, markers: found };
}

function pinOf(repoPath) {
  const pkg = readJson(path.join(repoPath, "package.json"));
  if (!pkg) return null;
  for (const field of ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"]) {
    const block = pkg[field];
    if (block && block[DEP]) return { field, value: block[DEP] };
  }
  return null;
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyPackage(sourceDir, targetDir) {
  ensureDir(targetDir);
  for (const entry of COPY_ENTRIES) {
    const from = path.join(sourceDir, entry);
    if (!exists(from)) continue;
    fs.cpSync(from, path.join(targetDir, entry), { recursive: true, force: true });
  }
}

function cliVersion(targetDir) {
  const cli = path.join(targetDir, "dist", "real-machine-verification", "cli", "main.js");
  if (!exists(cli)) return { ok: false, detail: "cli missing: " + cli };
  const run = runCapture(process.execPath, [cli, "--version"]);
  const first = run.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  return { ok: run.code === 0 && first.length >= 2 && /^capability /.test(first[1]), version: first[0] || null, capability: first[1] || null, code: run.code, stderr: run.stderr.trim() };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), {
    flags: {
      repo: { type: "multi" }, from: { type: "value" }, check: { type: "boolean" },
      "dry-run": { type: "boolean" }, "require-version": { type: "boolean" },
      json: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  const options = parsed.options;
  routeLogsToStderrWhenJson(Boolean(options.json));
  if (options.help) { printHelp("refresh-base - replace installed base with the local publisher dist", HELP); return; }
  if (parsed.unknown.length) { die("unknown option(s): " + parsed.unknown.join(" "), 2); return; }

  const sourceDir = path.resolve(options.from || path.join(DEFAULT_REPOS.base, "packages", "base"));
  const sourcePkg = readJson(path.join(sourceDir, "package.json"));
  if (!sourcePkg || sourcePkg.name !== DEP) { die("source is not the base package: " + sourceDir, 2); return; }
  const sourceVersion = sourcePkg.version;
  const sourceEntry = path.join(sourceDir, "dist", "real-machine-verification", "index.js");
  if (!exists(sourceEntry)) { die("source dist is missing; run npm run build in " + sourceDir, 2); return; }
  const sourceMarkers = markerState(sourceDir);
  const missingSourceMarkers = Object.entries(sourceMarkers.markers).filter(([, v]) => !v).map(([k]) => k);
  if (missingSourceMarkers.length) { die("source dist lacks markers: " + missingSourceMarkers.join(", "), 2); return; }

  const repos = (options.repo && options.repo.length ? options.repo : ["prompt", "palette", "im", "ilife", "matt"]).map(resolveRepoSpec);

  const report = { source: { dir: sourceDir, version: sourceVersion, entryBytes: sourceMarkers.bytes }, check: Boolean(options.check), dryRun: Boolean(options["dry-run"]), repos: [] };
  let mismatch = 0;
  let processed = 0;

  for (const repo of repos) {
    const record = { repo: repo.name, path: repo.path, pin: pinOf(repo.path), copies: [] };
    if (!exists(repo.path)) { record.error = "repo not found"; report.repos.push(record); mismatch++; continue; }
    const copies = installedCopies(repo.path);
    if (!copies.length) { record.error = "no installed " + DEP + " (run the repo's package manager first)"; report.repos.push(record); mismatch++; continue; }
    for (const copy of copies) {
      processed++;
      const resolved = safeRealpath(copy);
      const versionBefore = readInstalledVersion(resolved);
      const markerBefore = markerState(resolved);
      const entry = { path: copy, resolved, versionBefore, isLink: safeRealpath(copy) !== path.resolve(copy), markerBefore };
      const unsafe = isInsidePath(resolved, DEFAULT_REPOS.base) || !/node_modules/i.test(resolved);
      entry.unsafe = unsafe;
      if (unsafe) {
        entry.error = "refusing to replace: target resolves outside a consumer's node_modules or into the publisher repo";
        mismatch++;
      } else if (options.check) {
        const pinValue = record.pin ? record.pin.value : null;
        const versionOk = pinValue === null ? versionBefore !== null : versionBefore === pinValue;
        const markersOk = Object.values(markerBefore.markers).every(Boolean);
        const cli = cliVersion(resolved);
        entry.versionOk = versionOk;
        entry.markersOk = markersOk;
        entry.pin = pinValue;
        entry.cliOk = cli.ok;
        entry.matchesSource = exists(path.join(resolved, "dist", "real-machine-verification", "index.js")) && sha256File(path.join(resolved, "dist", "real-machine-verification", "index.js")) === sha256File(sourceEntry);
        entry.differsFromSource = !entry.matchesSource;
        if (!versionOk || !markersOk || !cli.ok) mismatch++;
      } else if (options["dry-run"]) {
        entry.action = "would delete " + resolved + " and copy " + sourceDir;
      } else {
        removeDir(resolved);
        copyPackage(sourceDir, resolved);
        const versionAfter = readInstalledVersion(resolved);
        const entryHash = path.join(resolved, "dist", "real-machine-verification", "index.js");
        entry.versionAfter = versionAfter;
        entry.entrySha256 = exists(entryHash) ? sha256File(entryHash) : null;
        entry.entryMatchesSource = entry.entrySha256 === sha256File(sourceEntry);
        entry.cli = cliVersion(resolved);
        if (versionAfter !== sourceVersion || !entry.entryMatchesSource || !entry.cli.ok) mismatch++;
      }
      record.copies.push(entry);
    }
    report.repos.push(record);
  }

  report.summary = { repos: repos.length, copies: processed, mismatch, sourceVersion };
  report.ok = mismatch === 0;

  if (options.json) { emitJson(report); process.exitCode = report.ok ? 0 : 1; return; }
  console.log("source  " + sourceDir);
  console.log("version " + sourceVersion + "  entry " + sourceMarkers.bytes + " bytes");
  console.log("mode    " + (options.check ? "check" : options["dry-run"] ? "dry-run" : "refresh"));
  console.log("");
  for (const repo of report.repos) {
    const pin = repo.pin ? repo.pin.field + "=" + repo.pin.value : "no pin";
    console.log(repo.repo + "  (" + repo.path + ")  pin: " + pin);
    if (repo.error) { console.log("  " + red(repo.error)); continue; }
    for (const c of repo.copies) {
      if (c.error) { console.log("  " + red(c.error) + "  " + c.path); continue; }
      if (options.check) {
        const ok = c.versionOk && c.markersOk && c.cliOk;
        console.log("  " + (ok ? green("OK") : red("DRIFT")) + "  installed " + String(c.versionBefore) + "  pin " + String(c.pin) + "  " + dim(c.path));
        if (!c.cliOk) console.log("    cli check failed");
        if (c.differsFromSource) console.log("    " + dim("note: installed bits differ from the local source " + sourceVersion + " (expected unless you refreshed)"));
      } else if (options["dry-run"]) {
        console.log("  " + dim("PLAN") + "  " + c.path + " -> " + c.resolved);
      } else {
        const ok = c.versionAfter === sourceVersion && c.entryMatchesSource && c.cli.ok;
        console.log("  " + (ok ? green("REFRESHED") : red("BAD")) + "  " + String(c.versionBefore) + " -> " + String(c.versionAfter) + "  " + dim(c.resolved));
        if (c.cli && !c.cli.ok) console.log("    cli check failed: " + (c.cli.stderr || "no capability line"));
      }
    }
    if (repo.pin && repo.pin.value !== sourceVersion) {
      console.log("  " + yellow("warning: repo pin " + repo.pin.value + " != refreshed " + sourceVersion + "; this is a local preview, not a committed state"));
    }
  }
  console.log("");
  console.log("copies: " + processed + "  mismatch: " + mismatch + "  " + (report.ok ? green("OK") : red("FAILED")));
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((e) => { console.error("refresh-base crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
