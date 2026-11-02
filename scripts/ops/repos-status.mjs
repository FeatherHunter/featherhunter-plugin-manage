#!/usr/bin/env node
// Cross-repo health report for the base-package rollout.
// Read-only: only git queries and file reads. No writes, no installs, no network.
import fs from "node:fs";
import path from "node:path";
import {
  parseArgs, runCapture, git, gitText, readJson, readText, exists,
  safeRealpath, isInsidePath, emitJson, printHelp, red, green, yellow, dim, die,
} from "./lib/common.mjs";

const DEP = "dsh-featherhunter-plugin-base";
const DEFAULT_REPOS = [
  { name: "base", path: "D:/dsh-plugin/featherhunter-plugin-manage", role: "publisher" },
  { name: "prompt", path: "D:/dsh-plugin/dsh-prompt", role: "consumer", client: "lib/client.js" },
  { name: "palette", path: "D:/dsh-plugin/dsh-opencode-palette", role: "consumer", client: "lib/client.js" },
  { name: "im", path: "D:/dsh-plugin/dsh-im-companion", role: "consumer", client: "lib/client.js" },
  { name: "ilife", path: "D:/dsh-plugin/ilife", role: "consumer", client: "packages/plugin-manager/dist/client.js" },
  { name: "matt", path: "D:/dsh-plugin/dsh-mattpocock-skills-deck", role: "consumer", client: "scripts/generated/baseClient.derived.js" },
];

const HELP = [
  "Usage: node scripts/ops/repos-status.mjs [options]",
  "",
  "Options:",
  "  --repo <name=path>   Override or add a repo (repeatable).",
  "  --strict-git          Treat dirty worktree / ahead / behind as drift.",
  "  --json                Machine-readable output.",
  "  --help                This message.",
  "",
  "Checks (consumers): exact devDependency pin, lockfile resolution, installed copy",
  "version and realpath, verify/profile.ts, verify:* scripts, client bundle base banner.",
  "Exit codes: 0 clean, 1 drift, 2 prerequisite error.",
];

function exactVersion(v) {
  return typeof v === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(v.trim());
}

function parsePackageDirs(repoPath) {
  const dirs = [];
  if (exists(path.join(repoPath, "package.json"))) dirs.push(repoPath);
  const pkgs = path.join(repoPath, "packages");
  if (exists(pkgs)) {
    let entries = [];
    try { entries = fs.readdirSync(pkgs, { withFileTypes: true }); } catch { entries = []; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(pkgs, entry.name);
      if (exists(path.join(dir, "package.json"))) dirs.push(dir);
    }
  }
  return dirs;
}

function findPin(pkg) {
  const found = [];
  for (const field of ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"]) {
    const value = pkg && pkg[field] ? pkg[field][DEP] : undefined;
    if (value !== undefined) found.push({ field, value });
  }
  return found;
}

function readNpmLock(packageDir) {
  const lockPath = path.join(packageDir, "package-lock.json");
  const lock = readJson(lockPath);
  if (!lock) return null;
  const entry = lock.packages ? lock.packages["node_modules/" + DEP] : null;
  const legacy = lock.dependencies ? lock.dependencies[DEP] : null;
  return {
    path: lockPath,
    version: entry ? entry.version || null : legacy ? legacy.version || null : null,
    resolved: entry ? entry.resolved || null : legacy ? legacy.resolved || null : null,
  };
}

function scanPnpmLock(repoPath) {
  const lockPath = path.join(repoPath, "pnpm-lock.yaml");
  const text = readText(lockPath);
  if (!text) return null;
  const versions = new Set();
  const specifiers = new Set();
  const lines = text.split("\n");
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const snap = /^dsh-featherhunter-plugin-base@([^:\s]+):$/.exec(trimmed);
    if (snap) versions.add(snap[1]);
    if (trimmed === "dsh-featherhunter-plugin-base:" || trimmed === "'dsh-featherhunter-plugin-base':") {
      current = { indent: line.length - line.trimStart().length };
      continue;
    }
    if (current) {
      const indent = line.length - line.trimStart().length;
      if (trimmed && indent <= current.indent) { current = null; continue; }
      const spec = /^specifier:\s*(.+)$/.exec(trimmed);
      if (spec) specifiers.add(spec[1].trim().replace(/^['"]|['"]$/g, ""));
      const ver = /^version:\s*(.+)$/.exec(trimmed);
      if (ver) versions.add(ver[1].trim().replace(/\(.*$/, "").replace(/^['"]|['"]$/g, ""));
    }
  }
  return { path: lockPath, versions: Array.from(versions).sort(), specifiers: Array.from(specifiers) };
}

function readInstalled(packageDir, baseRepo) {
  const installPath = path.join(packageDir, "node_modules", DEP);
  if (!exists(installPath)) return { path: installPath, exists: false };
  let link = null;
  let target = installPath;
  try {
    const stat = fs.lstatSync(installPath);
    if (stat.isSymbolicLink()) { link = fs.readlinkSync(installPath); target = safeRealpath(installPath); }
    else { target = safeRealpath(installPath); }
  } catch (e) { return { path: installPath, exists: false, error: String(e.message || e) }; }
  const pkg = readJson(path.join(target, "package.json"));
  return {
    path: installPath,
    exists: true,
    link,
    realpath: target,
    version: pkg ? pkg.version || null : null,
    pointsIntoBaseRepo: isInsidePath(target, baseRepo),
  };
}

function readClientBanner(repoPath, rel) {
  if (!rel) return null;
  const p = path.join(repoPath, rel);
  const text = readText(p);
  if (!text) return null;
  const m = /dsh-featherhunter-plugin-base v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/.exec(text);
  const m2 = m ? null : /dsh-featherhunter-plugin-base@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/.exec(text);
  const m3 = m || m2 ? null : /"version":\s*"([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)"/.exec(text);
  return { path: p, baseVersion: m ? m[1] : m2 ? m2[1] : m3 ? m3[1] : null };
}

function readVerify(packageDirs) {
  const profiles = [];
  const scripts = [];
  for (const dir of packageDirs) {
    const profile = path.join(dir, "verify", "profile.ts");
    const pkg = readJson(path.join(dir, "package.json"));
    if (exists(profile)) profiles.push(profile);
    if (pkg && pkg.scripts) {
      for (const [name, cmd] of Object.entries(pkg.scripts)) {
        if (name === "verify" || name.startsWith("verify:")) scripts.push({ dir, name, cmd });
      }
    }
  }
  return { profiles, scripts };
}

function inspectRepo(repo, baseRepo) {
  const result = { name: repo.name, path: repo.path, role: repo.role, errors: [], warnings: [], drift: [] };
  if (!exists(repo.path)) {
    result.errors.push("repo path does not exist");
    return result;
  }
  const inside = runCapture("git", ["-C", repo.path, "rev-parse", "--is-inside-work-tree"]);
  result.gitAvailable = inside.code === 0 && inside.stdout.trim() === "true";
  if (result.gitAvailable) {
    const branch = git(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const head = git(repo.path, ["rev-parse", "HEAD"]);
    result.branch = branch.code === 0 ? branch.stdout.trim() : null;
    result.head = head.code === 0 ? head.stdout.trim() : null;
    const up = git(repo.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    result.upstream = up.code === 0 ? up.stdout.trim() : null;
    if (result.upstream) {
      const counts = git(repo.path, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
      if (counts.code === 0) {
        const parts = counts.stdout.trim().split(/\s+/);
        result.ahead = Number(parts[0] || 0);
        result.behind = Number(parts[1] || 0);
      }
    }
    const status = git(repo.path, ["status", "--porcelain"]);
    if (status.code === 0) {
      const lines = status.stdout.split("\n").filter(Boolean);
      result.dirtyCount = lines.length;
      result.dirtyPaths = lines.slice(0, 12);
    }
  }
  const packageDirs = parsePackageDirs(repo.path);
  result.packages = [];
  for (const dir of packageDirs) {
    const pkg = readJson(path.join(dir, "package.json"));
    const pins = findPin(pkg);
    result.packages.push({
      dir,
      name: pkg ? pkg.name || null : null,
      version: pkg ? pkg.version || null : null,
      pins,
      npmLock: readNpmLock(dir),
      installed: readInstalled(dir, baseRepo),
    });
  }
  result.pnpmLock = scanPnpmLock(repo.path);
  const verifyInfo = readVerify(packageDirs);
  result.verifyProfiles = verifyInfo.profiles;
  result.verifyScripts = verifyInfo.scripts;
  result.clientBanner = readClientBanner(repo.path, repo.client);
  result.publisherVersion = repo.role === "publisher" ? (readJson(path.join(repo.path, "packages", "base", "package.json")) || {}).version || null : null;
  result.publisherDist = repo.role === "publisher" ? exists(path.join(repo.path, "packages", "base", "dist", "real-machine-verification", "index.js")) : undefined;

  if (repo.role === "consumer") {
    if (!result.packages.length) result.errors.push("no package.json found");
    for (const pkg of result.packages) {
      const pin = pkg.pins.find((p) => p.field === "devDependencies") || pkg.pins[0];
      if (!pin) {
        if (pkg.dir === repo.path) result.drift.push({ pkg: pkg.dir, code: "pin-missing", message: "no " + DEP + " dependency" });
        continue;
      }
      if (!exactVersion(pin.value)) {
        result.drift.push({ pkg: pkg.dir, code: "pin-not-exact", message: pin.field + " is " + pin.value + " (expected an exact version)" });
      } else {
        if (pkg.installed.exists && pkg.installed.version && pkg.installed.version !== pin.value.trim()) {
          result.drift.push({ pkg: pkg.dir, code: "installed-version-mismatch", message: "pin " + pin.value.trim() + " but installed " + pkg.installed.version });
        }
        if (!pkg.installed.exists) result.drift.push({ pkg: pkg.dir, code: "not-installed", message: "node_modules/" + DEP + " missing" });
        if (pkg.installed.pointsIntoBaseRepo) result.drift.push({ pkg: pkg.dir, code: "points-into-base-repo", message: "installed copy resolves inside the base repo: " + pkg.installed.realpath });
        const lockV = pkg.npmLock ? pkg.npmLock.version : null;
        if (pkg.npmLock && lockV && lockV !== pin.value.trim()) result.drift.push({ pkg: pkg.dir, code: "npm-lock-mismatch", message: "lock " + lockV + " vs pin " + pin.value.trim() });
        if (pkg.npmLock && pkg.npmLock.resolved && pkg.npmLock.resolved.indexOf("registry.npmjs.org") < 0) result.drift.push({ pkg: pkg.dir, code: "npm-lock-not-registry", message: pkg.npmLock.resolved });
      }
    }
    if (result.pnpmLock) {
      const pinVersion = result.packages.map((p) => p.pins[0] && p.pins[0].value).find((v) => exactVersion(v));
      if (pinVersion && result.pnpmLock.versions.length && result.pnpmLock.versions.indexOf(pinVersion.trim()) < 0) {
        result.drift.push({ pkg: result.pnpmLock.path, code: "pnpm-lock-mismatch", message: "lock versions " + result.pnpmLock.versions.join(",") + " vs pin " + pinVersion.trim() });
      }
    }
    if (!result.verifyProfiles.length) result.drift.push({ code: "verify-profile-missing", message: "no verify/profile.ts" });
    if (!result.verifyScripts.length) result.drift.push({ code: "verify-scripts-missing", message: "no verify / verify:* npm script" });
    if (result.clientBanner && result.clientBanner.baseVersion) {
      const pinVersion = result.packages.map((p) => p.pins[0] && p.pins[0].value).find((v) => exactVersion(v));
      if (pinVersion && result.clientBanner.baseVersion !== pinVersion.trim()) {
        result.warnings.push({ code: "banner-version-mismatch", message: "client banner base " + result.clientBanner.baseVersion + " vs pin " + pinVersion.trim() });
      }
    } else if (repo.client && exists(path.join(repo.path, repo.client))) {
      result.warnings.push({ code: "banner-unreadable", message: "could not read base version from " + repo.client });
    }
  }
  if (result.dirtyCount > 0) result.warnings.push({ code: "dirty-worktree", message: result.dirtyCount + " changed path(s)" });
  if (result.ahead) result.warnings.push({ code: "ahead", message: result.ahead + " commit(s) ahead of upstream" });
  if (result.behind) result.warnings.push({ code: "behind", message: result.behind + " commit(s) behind upstream" });
  return result;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), {
    flags: {
      repo: { type: "multi" }, strictGit: { type: "boolean" }, json: { type: "boolean" },
    },
  });
  const options = parsed.options;
  if (options.help) { printHelp("repos-status - cross-repo base-package health report", HELP); return; }
  if (parsed.unknown.length) { die("unknown option(s): " + parsed.unknown.join(" "), 2); return; }
  let repos = DEFAULT_REPOS.slice();
  if (options.repo && options.repo.length) {
    for (const spec of options.repo) {
      const i = spec.indexOf("=");
      if (i < 0) { die("--repo expects name=path, got " + spec, 2); return; }
      repos.push({ name: spec.slice(0, i), path: spec.slice(i + 1), role: "consumer" });
    }
  }
  const base = repos.find((r) => r.role === "publisher");
  const baseRepo = base ? base.path : "";
  const results = repos.map((repo) => inspectRepo(repo, baseRepo));
  if (options.strictGit) {
    for (const r of results) {
      for (const w of r.warnings) {
        if (w.code === "dirty-worktree" || w.code === "ahead" || w.code === "behind") r.drift.push(w);
      }
    }
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    repos: results,
    summary: {
      repos: results.length,
      drift: results.reduce((n, r) => n + r.drift.length, 0),
      errors: results.reduce((n, r) => n + r.errors.length, 0),
      warnings: results.reduce((n, r) => n + r.warnings.length, 0),
    },
  };
  if (options.json) { emitJson(payload); process.exitCode = payload.summary.drift ? 1 : 0; return; }

  console.log("repos-status @ " + payload.generatedAt);
  for (const r of results) {
    console.log("");
    console.log("== " + r.name + "  (" + r.path + ")");
    if (r.errors.length) { for (const e of r.errors) console.log("  " + red("ERROR") + " " + e); continue; }
    if (r.gitAvailable) {
      console.log("  branch " + r.branch + "  head " + String(r.head).slice(0, 12) + (r.upstream ? "  upstream " + r.upstream + "  ahead " + (r.ahead || 0) + " behind " + (r.behind || 0) : "  upstream none") + "  dirty " + (r.dirtyCount || 0));
    } else {
      console.log("  " + yellow("no git"));
    }
    if (r.role === "consumer") {
      for (const pkg of r.packages) {
        if (!pkg.pins.length) continue;
        const pin = pkg.pins.map((p) => p.field + "=" + p.value).join(", ");
        const inst = pkg.installed.exists ? pkg.installed.version + (pkg.installed.link ? " (link)" : "") : "not installed";
        console.log("  " + path.basename(pkg.dir) + ": pin " + pin + "  installed " + inst);
        if (pkg.installed.realpath) console.log("    realpath " + dim(pkg.installed.realpath));
        if (pkg.npmLock) console.log("    npm lock " + (pkg.npmLock.version || "?") + " " + dim(pkg.npmLock.resolved || ""));
      }
      if (r.pnpmLock) console.log("  pnpm lock versions " + (r.pnpmLock.versions.join(", ") || "?"));
      console.log("  verify profile " + (r.verifyProfiles.length ? "yes" : red("missing")) + "  scripts " + (r.verifyScripts.map((s) => s.name).join(", ") || red("missing")));
      console.log("  client banner base " + (r.clientBanner ? r.clientBanner.baseVersion || "?" : "n/a"));
    } else {
      console.log("  base package version " + (r.publisherVersion || "?") + "  dist " + (r.publisherDist ? "present" : "missing"));
    }
    for (const d of r.drift) console.log("  " + red("DRIFT") + " [" + d.code + "] " + d.message);
    for (const w of r.warnings) console.log("  " + yellow("warn ") + " [" + w.code + "] " + w.message);
  }
  console.log("");
  console.log("summary: " + results.length + " repos, " + payload.summary.drift + " drift, " + payload.summary.errors + " errors, " + payload.summary.warnings + " warnings");
  process.exitCode = payload.summary.drift || payload.summary.errors ? 1 : 0;
}

main().catch((e) => { console.error("repos-status crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
