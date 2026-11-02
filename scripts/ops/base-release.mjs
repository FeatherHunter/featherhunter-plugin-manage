#!/usr/bin/env node
// Publish dsh-featherhunter-plugin-base from a CLEAN detached worktree, then verify the
// published tarball from the registry. Replaces the manual 0.1.7 / 0.1.8 release dance:
// worktree add -> npm ci -> build (must precede prepublish tests) -> publish -> poll registry
// -> download tarball directly (npm pack can report notarget while propagation lags).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  parseArgs, runCapture, runCommandLine, readJson, readText, exists, sha256File, sha256Text, routeLogsToStderrWhenJson,
  resolveRepoSpec, DEFAULT_REPOS, emitJson, printHelp, die, formatDuration, ensureDir, nowStamp,
  green, red, yellow, dim, tail,
} from "./lib/common.mjs";

const HELP = [
  "Usage: node scripts/ops/base-release.mjs --version <x.y.z> [options]",
  "",
  "Full pipeline (default): detached worktree -> npm ci -> build -> npm publish -> verify tarball.",
  "Verification only: --skip-publish (requires the version to already be on the registry).",
  "",
  "Options:",
  "  --version <v>        Version to publish/verify (must match package.json at --commit).",
  "  --commit <ref>       Commit to publish from (default: HEAD).",
  "  --repo <name|path>   Publisher repo (default: base).",
  "  --package <dir>      Base package dir within the repo (default: packages/base).",
  "  --worktree <dir>     Detached worktree path (default: <tmp>/base-rel-<version>).",
  "  --download <dir>     Tarball verification dir (default: <tmp>/base-verify-<version>).",
  "  --registry <url>     Registry (default: https://registry.npmjs.org).",
  "  --timeout-min <n>    Registry propagation timeout (default 10).",
  "  --poll-sec <n>       Poll interval (default 5).",
  "  --skip-publish       Verify an already-published version; no worktree, no publish.",
  "  --keep-worktree      Keep the worktree after success.",
  "  --keep-download      Keep the downloaded tarball after success.",
  "  --dry-run            Print the plan; change nothing.",
  "  --no-log             Do not write step logs.",
  "  --log-dir <dir>      Log directory (default: <repo>/.tmp/ops-logs).",
  "  --json               Machine-readable evidence.",
  "  --help               This message.",
  "",
  "Exit codes: 0 verified, 1 a step failed, 2 prerequisite error.",
];

const PKG = "dsh-featherhunter-plugin-base";
const MARKERS = ["prepareHome", "findWriteUnderRealHome", "candidate-identity", "runReleaseGate"];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function httpJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function pollPublished(registry, version, timeoutMs, pollMs) {
  const url = registry + "/" + PKG + "/" + version;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const res = await httpJson(url);
      if (res.status === 200 && res.json && res.json.dist) return { dist: res.json.dist, body: res.json };
      last = res.status;
    } catch (e) { last = String(e && e.message ? e.message : e); }
    await sleep(pollMs);
  }
  throw new Error("registry did not publish " + PKG + "@" + version + " within " + Math.round(timeoutMs / 1000) + "s (last: " + last + ")");
}

function sha1(buf) { return crypto.createHash("sha1").update(buf).digest("hex"); }
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function sha512Base64(buf) { return crypto.createHash("sha512").update(buf).digest("base64"); }

function unpackTarball(tgzPath, destDir) {
  // Do not clear destDir here: the tarball itself lives in it.
  ensureDir(destDir);
  const r = runCapture("tar", ["-xzf", tgzPath, "-C", destDir]);
  if (r.code !== 0) throw new Error("tar failed: " + (r.stderr || r.stdout).trim());
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), {
    flags: {
      version: { type: "value" }, commit: { type: "value" }, repo: { type: "value" }, package: { type: "value" },
      worktree: { type: "value" }, download: { type: "value" }, registry: { type: "value" },
      "timeout-min": { type: "value" }, "poll-sec": { type: "value" },
      "skip-publish": { type: "boolean" }, "keep-worktree": { type: "boolean" }, "keep-download": { type: "boolean" },
      "dry-run": { type: "boolean" }, "no-log": { type: "boolean" }, "log-dir": { type: "value" },
      json: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  const options = parsed.options;
  routeLogsToStderrWhenJson(Boolean(options.json));
  if (options.help) { printHelp("base-release - publish from a clean worktree and verify the tarball", HELP); return; }
  if (parsed.unknown.length) { die("unknown option(s): " + parsed.unknown.join(" "), 2); return; }
  if (!options.version) { die("--version is required", 2); return; }
  const version = String(options.version).replace(/^v/, "");
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) { die("invalid version: " + version, 2); return; }

  const repo = resolveRepoSpec(options.repo || "base");
  const packageDirRel = options.package || "packages/base";
  const packageDir = path.resolve(repo.path, packageDirRel);
  if (!exists(path.join(packageDir, "package.json"))) { die("not a package dir: " + packageDir, 2); return; }
  const registry = String(options.registry || "https://registry.npmjs.org").replace(/\/$/, "");

  const commitRef = options.commit || "HEAD";
  const headRes = runCapture("git", ["-C", repo.path, "rev-parse", commitRef + "^{commit}"]);
  if (headRes.code !== 0) { die("cannot resolve commit " + commitRef + ": " + headRes.stderr.trim(), 2); return; }
  const commit = headRes.stdout.trim();
  const committedPkgRaw = runCapture("git", ["-C", repo.path, "show", commit + ":" + packageDirRel.replace(/\\/g, "/") + "/package.json"]);
  if (committedPkgRaw.code !== 0) { die("cannot read package.json at commit " + commit, 2); return; }
  let committedPkg = null;
  try { committedPkg = JSON.parse(committedPkgRaw.stdout); } catch { committedPkg = null; }
  if (!committedPkg || committedPkg.name !== PKG) { die("commit does not look like the base package: " + commit, 2); return; }
  if (committedPkg.version !== version) {
    die("commit " + commit.slice(0, 12) + " has package.json version " + committedPkg.version + ", expected " + version + " (bump and commit first)", 2);
    return;
  }

  const mode = options["skip-publish"] ? "verify" : "publish";
  const worktreeDir = path.resolve(options.worktree || path.join(os.tmpdir(), "base-rel-" + version));
  const downloadDir = path.resolve(options.download || path.join(os.tmpdir(), "base-verify-" + version));
  const timeoutMs = Number(options["timeout-min"] || 10) * 60000;
  const pollMs = Number(options["poll-sec"] || 5) * 1000;
  const logDir = path.resolve(options["log-dir"] || path.join(repo.path, ".tmp", "ops-logs"));
  const writeLogs = !options["no-log"];
  const stamp = nowStamp();

  const plan = { mode, version, commit, repo: repo.path, packageDir, registry, worktree: mode === "publish" ? worktreeDir : null, download: downloadDir };
  if (options["dry-run"]) {
    console.log("mode      " + mode);
    console.log("version   " + version + "  commit " + commit);
    console.log("package   " + packageDir);
    if (mode === "publish") console.log("worktree  " + worktreeDir + " (must not exist)");
    console.log("download  " + downloadDir);
    console.log("registry  " + registry);
    if (options.json) emitJson({ ok: true, dryRun: true, plan });
    return;
  }

  // Published-version preflight.
  const published = await httpJson(registry + "/" + PKG + "/" + version);
  const alreadyPublished = published.status === 200 && published.json && published.json.dist;
  if (mode === "publish" && alreadyPublished) {
    die(PKG + "@" + version + " is already published; use a new version, or --skip-publish to verify the existing tarball", 2);
    return;
  }
  if (mode === "verify" && !alreadyPublished) {
    die(PKG + "@" + version + " is not on the registry; drop --skip-publish to publish it", 2);
    return;
  }
  if (mode === "publish") {
    const who = await runCommandLine("npm whoami", { cwd: packageDir, echo: false });
    if (who.code !== 0) {
      die("npm is not logged in (npm whoami failed); run npm login first. Output: " + tail(who.stderr || who.stdout, 3), 2);
      return;
    }
  }
  if (mode === "publish" && exists(worktreeDir)) { die("worktree path already exists: " + worktreeDir + " (remove it or pass --worktree)", 2); return; }
  if (exists(downloadDir) && !options["keep-download"]) fs.rmSync(downloadDir, { recursive: true, force: true });
  ensureDir(downloadDir);
  if (writeLogs) ensureDir(logDir);

  const report = { mode, version, commit, registry, worktree: mode === "publish" ? worktreeDir : null, steps: [], ok: false };
  let worktreeCreated = false;
  let localEntrySha256 = null;

  async function step(id, command, options2) {
    options2 = options2 || {};
    const logFile = writeLogs ? path.join(logDir, "base-release-" + stamp + "-" + id + ".log") : null;
    console.log("");
    console.log("== " + id + "  " + dim(command));
    const run = options2.direct
      ? await runLoggedDirect(options2.direct.command, options2.direct.args, { cwd: options2.cwd, logFile, echo: !options.json, env: options2.env })
      : await runCommandLine(command, { cwd: options2.cwd, logFile, echo: !options.json });
    const rec = { id, command, exitCode: run.code, durationMs: run.durationMs, logFile, ok: run.code === 0, stdout: run.stdout, stderr: run.stderr };
    report.steps.push(rec);
    console.log("-- " + id + " " + (rec.ok ? green("OK") : red("FAILED exit " + run.code)) + "  " + formatDuration(run.durationMs));
    if (!rec.ok) {
      if (logFile) console.log("   log: " + logFile);
      console.log(dim(tail(run.stdout + "\n" + run.stderr, 25)));
      throw new Error("step " + id + " failed with exit " + run.code);
    }
    return rec;
  }

  try {
    if (mode === "publish") {
      ensureDir(path.dirname(worktreeDir));
      await step("worktree", "git worktree add --detach " + worktreeDir + " " + commit, { cwd: repo.path });
      worktreeCreated = true;
      const packageWorktree = path.join(worktreeDir, packageDirRel);
      await step("npm-ci", "npm ci --no-audit --no-fund", { cwd: packageWorktree });
      await step("build", "npm run build", { cwd: packageWorktree });
      const localEntry = path.join(packageWorktree, "dist", "real-machine-verification", "index.js");
      if (!exists(localEntry)) throw new Error("build produced no dist entry: " + localEntry);
      localEntrySha256 = sha256File(localEntry);
      await step("publish", "npm publish --registry " + registry, { cwd: packageWorktree });
    }

    const publishedInfo = await pollPublished(registry, version, timeoutMs, pollMs);
    const dist = publishedInfo.dist;
    report.dist = { shasum: dist.shasum || null, integrity: dist.integrity || null, tarball: dist.tarball || null };
    console.log("");
    console.log(dim("registry: shasum " + report.dist.shasum + "  tarball " + report.dist.tarball));

    const tarballUrl = dist.tarball || registry + "/" + PKG + "/-/" + PKG + "-" + version + ".tgz";
    const tgzPath = path.join(downloadDir, PKG + "-" + version + ".tgz");
    const dl = await fetch(tarballUrl, { signal: AbortSignal.timeout(120000) });
    if (!dl.ok) throw new Error("tarball download failed: HTTP " + dl.status + " " + tarballUrl);
    const buf = Buffer.from(await dl.arrayBuffer());
    fs.writeFileSync(tgzPath, buf);
    const sha1Hex = sha1(buf);
    const sha256Hex = sha256(buf);
    const sha512 = sha512Base64(buf);
    report.download = { path: tgzPath, bytes: buf.length, sha1: sha1Hex, sha256: sha256Hex, sha512: sha512 };
    console.log(dim("tarball: " + buf.length + " bytes  sha1 " + sha1Hex + "  sha256 " + sha256Hex));
    if (dist.shasum && dist.shasum.toLowerCase() !== sha1Hex) throw new Error("shasum mismatch: registry " + dist.shasum + " vs downloaded " + sha1Hex);
    if (dist.integrity && dist.integrity !== ("sha512-" + sha512)) throw new Error("integrity mismatch: registry " + dist.integrity);

    unpackTarball(tgzPath, downloadDir);
    const pkgRoot = path.join(downloadDir, "package");
    const pkg = readJson(path.join(pkgRoot, "package.json"));
    if (!pkg || pkg.name !== PKG) throw new Error("tarball package.json is not " + PKG);
    if (pkg.version !== version) throw new Error("tarball version " + pkg.version + " != " + version);
    report.package = { name: pkg.name, version: pkg.version, files: Array.isArray(pkg.files) ? pkg.files : null };

    const entry = path.join(pkgRoot, "dist", "real-machine-verification", "index.js");
    if (!exists(entry)) throw new Error("tarball lacks dist/real-machine-verification/index.js");
    const entryText = readText(entry);
    if (entryText === null) throw new Error("cannot read tarball dist entry: " + entry);
    const entrySha256 = sha256File(entry);
    const markerState = {};
    for (const marker of MARKERS) markerState[marker] = entryText.indexOf(marker) >= 0;
    const missingMarkers = MARKERS.filter((m) => !markerState[m]);
    report.entry = { bytes: entryText.length, sha256: entrySha256, markers: markerState };
    if (missingMarkers.length) throw new Error("tarball dist lacks required markers: " + missingMarkers.join(", "));
    if (localEntrySha256 && localEntrySha256 !== entrySha256) throw new Error("published entry differs from the freshly built entry");

    const cli = path.join(pkgRoot, "dist", "real-machine-verification", "cli", "main.js");
    const cliRun = runCapture(process.execPath, [cli, "--version"]);
    const cliLines = cliRun.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    report.cli = { exitCode: cliRun.code, version: cliLines[0] || null, capability: cliLines[1] || null };
    if (cliRun.code !== 0) throw new Error("tarball CLI --version exited " + cliRun.code);
    if (report.cli.version !== version) throw new Error("CLI --version printed " + report.cli.version + " != " + version);
    if (!/^capability real-machine-verification \(schema 1\)$/.test(report.cli.capability || "")) throw new Error("CLI capability line unexpected: " + report.cli.capability);

    const docs = ["README.md", "AGENTS-USAGE.md"].map((name) => path.join(pkgRoot, "dist", "real-machine-verification", name));
    report.docs = docs.map((p) => ({ path: path.basename(p), exists: exists(p), bytes: exists(p) ? fs.statSync(p).size : 0 }));
    if (!exists(docs[0])) throw new Error("tarball lacks dist/real-machine-verification/README.md");

    report.ok = true;
  } catch (e) {
    report.error = String(e && e.message ? e.message : e);
    console.log("");
    console.log(red("FAILED: " + report.error));
    if (worktreeCreated) console.log(yellow("worktree kept for diagnosis: " + worktreeDir));
  } finally {
    if (mode === "publish" && report.ok && worktreeCreated && !options["keep-worktree"]) {
      const rm = runCapture("git", ["-C", repo.path, "worktree", "remove", "--force", worktreeDir]);
      report.worktreeRemoved = rm.code === 0;
      console.log(dim("worktree removed: " + worktreeDir));
    }
    if (report.ok && !options["keep-download"]) {
      fs.rmSync(downloadDir, { recursive: true, force: true });
      report.downloadRemoved = true;
    }
  }

  if (options.json) { emitJson(report); process.exitCode = report.ok ? 0 : 1; return; }
  console.log("");
  console.log("base-release " + (report.ok ? green("VERIFIED") : red("FAILED")) + "  " + PKG + "@" + version);
  for (const s of report.steps) console.log("  " + (s.ok ? green("PASS") : red("FAIL")) + "  " + s.id.padEnd(10) + formatDuration(s.durationMs));
  if (report.dist) console.log("  registry  shasum " + report.dist.shasum + "  integrity " + (report.dist.integrity || "-"));
  if (report.download) console.log("  tarball   " + report.download.bytes + " bytes  sha256 " + report.download.sha256);
  if (report.cli) console.log("  cli       " + report.cli.version + " / " + report.cli.capability);
  if (report.entry) console.log("  markers   " + JSON.stringify(report.entry.markers));
  console.log("  evidence  " + downloadDir + (report.downloadRemoved ? " (removed after success)" : " (kept)"));
  process.exitCode = report.ok ? 0 : 1;
}

import { runLogged as runLoggedDirect } from "./lib/common.mjs";

main().catch((e) => { console.error("base-release crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
