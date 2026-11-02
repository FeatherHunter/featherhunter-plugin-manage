#!/usr/bin/env node
// Scan this repo's text sources for content that must never reach a commit:
// NUL bytes (binary data smuggled into source) and text that cannot be decoded
// as UTF-8. Read-only; no network, no git (fixtures are not git repos).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs, resolveRepoSpec, routeLogsToStderrWhenJson, emitJson, printHelp, die,
  REPO_ROOT, green, red, dim,
} from "./lib/common.mjs";

const HELP = [
  "Usage: node scripts/ops/scan-sources.mjs [options]",
  "",
  "Scan this repo's text sources for NUL bytes and undecodable UTF-8.",
  "",
  "Options:",
  "  --repo <name|path>   Repo to scan (default: base).",
  "  --json               Machine-readable report (stdout is JSON only).",
  "  --help               This message.",
  "",
  "Scope: packages/base/{src,scripts,test,demo}, scripts/ (including ops), docs/",
  "and the text files directly under the repo root. Skips node_modules, .git,",
  "dist, .tmp, .local, .scratch and non-text extensions.",
  "",
  "Exit codes: 0 clean, 1 issues found, 2 prerequisite error.",
];

// Directories that are scanned recursively, relative to the repo root. Missing
// entries are skipped so a fixture checkout does not need every directory.
export const SCAN_DIRS = [
  "packages/base/src",
  "packages/base/scripts",
  "packages/base/test",
  "packages/base/demo",
  "scripts",
  "docs",
];

// Any directory with one of these names is skipped wherever it appears.
export const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist", ".tmp", ".local", ".scratch"]);

// Only text-ish extensions are opened. data/ binary assets and other payloads
// are deliberately out of scope; the gate guards source, scripts and docs.
export const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".rst",
  ".json", ".jsonc", ".json5", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf",
  ".mjs", ".cjs", ".js", ".jsx", ".ts", ".tsx", ".mts", ".cts",
  ".css", ".scss", ".less", ".html", ".htm", ".xml", ".svg",
  ".ps1", ".cmd", ".bat", ".sh", ".bash", ".py",
  ".tsv", ".csv", ".snap",
]);

// Extensionless text files are recognised by name (root .gitignore & friends).
export const TEXT_FILENAMES = new Set([
  "license", "licence", "readme", "changelog", "contributing", "authors", "notice",
  "makefile", "dockerfile", ".gitignore", ".gitattributes", ".editorconfig",
  ".npmrc", ".nvmrc", ".prettierignore", ".prettierrc", ".eslintignore", ".eslintrc",
]);

// Fail closed on absurdly large "text" files instead of streaming forever.
export const MAX_SCAN_BYTES = 64 * 1024 * 1024;

const CHUNK_BYTES = 1024 * 1024;

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relativePath(repoRoot, abs) {
  const rel = toPosix(path.relative(repoRoot, abs));
  return rel === "" ? "." : rel;
}

function isTextName(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext) return TEXT_EXTENSIONS.has(ext);
  return TEXT_FILENAMES.has(name.toLowerCase());
}

function errorText(error) {
  const code = error && error.code ? String(error.code) + ": " : "";
  const message = error && error.message ? String(error.message) : String(error);
  return code + message;
}

/**
 * Walk the scan scope under repoRoot and return
 * { repo, roots, scanned, skipped, issues, ok }.
 * Issues carry both an absolute file path and a repo-relative posix path.
 */
export function scanSources(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const result = { repo: repoRoot, roots: [], scanned: 0, skipped: 0, issues: [], ok: true };

  const reportIssue = (abs, reason, message) => {
    result.issues.push({ file: abs, path: relativePath(repoRoot, abs), reason, message });
  };

  const scanFile = (abs) => {
    let size;
    try {
      size = fs.statSync(abs).size;
    } catch (error) {
      reportIssue(abs, "unreadable", "cannot stat file: " + errorText(error));
      return;
    }
    if (size > MAX_SCAN_BYTES) {
      reportIssue(abs, "too-large", "file exceeds the " + Math.floor(MAX_SCAN_BYTES / (1024 * 1024)) + " MiB scan limit");
      return;
    }
    let fd;
    try {
      fd = fs.openSync(abs, "r");
    } catch (error) {
      reportIssue(abs, "unreadable", "cannot open file: " + errorText(error));
      return;
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let nulOffset = -1;
    let invalidUtf8 = false;
    let offset = 0;
    try {
      for (;;) {
        const read = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (read <= 0) break;
        const chunk = buffer.subarray(0, read);
        if (nulOffset < 0) {
          const index = chunk.indexOf(0);
          if (index >= 0) nulOffset = offset + index;
        }
        // Once a NUL is found (or the stream stopped being valid UTF-8) there
        // is nothing left to decode; keep reading only to locate the NUL.
        if (!invalidUtf8 && nulOffset < 0) {
          try {
            decoder.decode(chunk, { stream: true });
          } catch {
            invalidUtf8 = true;
          }
        }
        offset += read;
      }
      if (!invalidUtf8 && nulOffset < 0) {
        try {
          decoder.decode();
        } catch {
          invalidUtf8 = true;
        }
      }
    } catch (error) {
      reportIssue(abs, "unreadable", "cannot read file: " + errorText(error));
      return;
    } finally {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    result.scanned++;
    if (nulOffset >= 0) {
      reportIssue(abs, "nul-byte", "file contains a NUL byte at offset " + nulOffset);
      return;
    }
    if (invalidUtf8) {
      reportIssue(abs, "invalid-utf8", "file is not valid UTF-8 text");
    }
  };

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      reportIssue(dir, "unreadable", "cannot read directory: " + errorText(error));
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { result.skipped++; continue; }
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) { result.skipped++; continue; }
        walk(abs);
        continue;
      }
      if (!entry.isFile()) { result.skipped++; continue; }
      if (!isTextName(entry.name)) { result.skipped++; continue; }
      scanFile(abs);
    }
  };

  // Text files directly under the repo root (not recursive).
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch (error) {
    reportIssue(repoRoot, "unreadable", "cannot read repo root: " + errorText(error));
  }
  rootEntries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of rootEntries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (!isTextName(entry.name)) { result.skipped++; continue; }
    scanFile(path.join(repoRoot, entry.name));
  }

  for (const rel of SCAN_DIRS) {
    const abs = path.join(repoRoot, rel);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      result.roots.push({ path: rel, exists: false });
      continue;
    }
    // Refuse to follow junctions/symlinks out of the repo.
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      result.roots.push({ path: rel, exists: false });
      continue;
    }
    result.roots.push({ path: rel, exists: true });
    walk(abs);
  }

  result.ok = result.issues.length === 0;
  return result;
}

export function formatScanText(result) {
  const head = "scan: " + result.scanned + " text file(s) checked, " + result.issues.length + " issue(s)";
  const lines = [result.ok ? green(head) : red(head)];
  for (const issue of result.issues) {
    lines.push("  " + red(String(issue.reason).padEnd(12)) + " " + issue.path + "  " + dim(issue.message));
  }
  return lines.join("\n");
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), {
    flags: { repo: { type: "value" }, json: { type: "boolean" }, help: { type: "boolean" } },
  });
  const options = parsed.options;
  routeLogsToStderrWhenJson(Boolean(options.json));
  if (options.help) { printHelp("scan-sources - reject NUL bytes and undecodable UTF-8 in repo text", HELP); return; }
  if (parsed.unknown.length) { die("unknown option(s): " + parsed.unknown.join(" "), 2); return; }
  let repo;
  try {
    repo = resolveRepoSpec(options.repo || "base");
  } catch (error) {
    die(String(error && error.message ? error.message : error), 2);
    return;
  }
  const result = scanSources({ repoRoot: repo.path });
  console.log(formatScanText(result));
  if (options.json) emitJson(result);
  process.exitCode = result.ok ? 0 : 1;
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const entry = path.resolve(process.argv[1]);
  return process.platform === "win32" ? entry.toLowerCase() === self.toLowerCase() : entry === self;
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error("scan-sources crashed:", error && error.stack ? error.stack : error);
    process.exitCode = 2;
  });
}
