// Shared helpers for scripts/ops. Zero dependencies, Node 20+.
// Design rule: these scripts are read-only unless a command explicitly says otherwise.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const IS_WIN = process.platform === "win32";

// This toolkit lives at <repo>/scripts/ops/lib, so the owning repo is three levels
// up from this file. Deriving it from import.meta.url keeps every clone location
// (and CI) working at any cwd; no machine-specific absolute path is involved.
export const OPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(OPS_DIR, "..", "..");

// The publisher repo is derived from the toolkit location above. The five plugin
// repositories keep their machine-local paths: this spec does not delete the
// cross-repo tools, and no new capability depends on them.
export const DEFAULT_REPOS = {
  base: REPO_ROOT,
  prompt: "D:/dsh-plugin/dsh-prompt",
  palette: "D:/dsh-plugin/dsh-opencode-palette",
  im: "D:/dsh-plugin/dsh-im-companion",
  ilife: "D:/dsh-plugin/ilife",
  matt: "D:/dsh-plugin/dsh-mattpocock-skills-deck",
};

export function resolveRepoSpec(value) {
  if (!value) throw new Error("empty --repo value");
  if (DEFAULT_REPOS[value]) return { name: value, path: path.resolve(DEFAULT_REPOS[value]) };
  if (exists(value)) {
    const abs = path.resolve(value);
    const name = path.basename(abs);
    return { name, path: abs };
  }
  throw new Error("unknown repo (not a path, not one of " + Object.keys(DEFAULT_REPOS).join(", ") + "): " + value);
}

export function bin(name) {
  if (!IS_WIN) return name;
  if (name === "node") return process.execPath;
  if (name.endsWith(".cmd") || name.endsWith(".exe")) return name;
  return name + ".cmd";
}

export function parseArgs(argv, spec) {
  const options = Object.assign({}, spec.defaults || {});
  const positionals = [];
  const unknown = [];
  const byAlias = {};
  for (const [name, def] of Object.entries(spec.flags || {})) {
    if (def.alias) byAlias[def.alias] = name;
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { options.help = true; continue; }
    if (arg.startsWith("--")) {
      let name = arg.slice(2);
      let value;
      const eq = name.indexOf("=");
      if (eq >= 0) { value = name.slice(eq + 1); name = name.slice(0, eq); }
      const canonical = byAlias[name] || name;
      const def = spec.flags[canonical];
      if (!def) { unknown.push(arg); continue; }
      if (def.type === "boolean") { options[canonical] = value === undefined ? true : value !== "false"; continue; }
      if (value === undefined) {
        value = argv[i + 1];
        if (value === undefined || value.startsWith("--")) { unknown.push(arg); continue; }
        i++;
      }
      if (def.type === "multi") { if (!options[canonical]) options[canonical] = []; options[canonical].push(value); }
      else options[canonical] = value;
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) { unknown.push(arg); continue; }
    positionals.push(arg);
  }
  return { options, positionals, unknown };
}

export function runCapture(command, args, options) {
  options = options || {};
  const res = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    code: res.status === null ? 1 : res.status,
    signal: res.signal || null,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    error: res.error ? String(res.error.message || res.error) : null,
  };
}

// Run a shell-free single command line through cmd.exe. Use this for npm/pnpm scripts:
// on Windows their .cmd shims cannot be spawned without a shell.
export async function runCommandLine(line, options) {
  const comspec = process.env.ComSpec || "cmd.exe";
  return runLogged(comspec, ["/d", "/s", "/c", line], options);
}

export function git(repo, args) {
  return runCapture("git", ["-C", repo].concat(args));
}

export function gitText(repo, args) {
  const r = git(repo, args);
  if (r.code !== 0) throw new Error("git " + args.join(" ") + " failed: " + r.stderr.trim());
  return r.stdout.trim();
}

export async function runLogged(command, args, options) {
  options = options || {};
  const started = Date.now();
  const echo = options.echo !== false;
  const logStream = options.logFile ? fs.createWriteStream(options.logFile, { flags: "a" }) : null;
  const out = [];
  const err = [];
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    windowsHide: true,
    shell: false,
  });
  child.stdout.on("data", (buf) => {
    const s = buf.toString("utf8");
    out.push(s);
    if (echo) process.stdout.write(s);
    if (logStream) logStream.write(s);
  });
  child.stderr.on("data", (buf) => {
    const s = buf.toString("utf8");
    err.push(s);
    if (echo) process.stderr.write(s);
    if (logStream) logStream.write(s);
  });
  const code = await new Promise((resolve) => {
    let settled = false;
    const finish = (c) => { if (!settled) { settled = true; resolve(c); } };
    child.on("error", (e) => { err.push(String(e)); finish(1); });
    child.on("close", (c) => finish(c === null ? 1 : c));
  });
  if (logStream) await new Promise((resolve) => logStream.end(resolve));
  return { code, durationMs: Date.now() - started, stdout: out.join(""), stderr: err.join("") };
}

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
export function color(code, s) { return useColor ? "\u001b[" + code + "m" + s + "\u001b[0m" : String(s); }
export const red = (s) => color("31", s);
export const green = (s) => color("32", s);
export const yellow = (s) => color("33", s);
export const cyan = (s) => color("36", s);
export const dim = (s) => color("90", s);

export function formatDuration(ms) {
  if (ms < 1000) return ms + "ms";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return m + "m" + String(rest).padStart(2, "0") + "s";
}

export function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

export function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

export function readText(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

export function sha256Text(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
}

export function safeRealpath(p) {
  try { return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); }
  catch { return path.resolve(p); }
}

export function isInsidePath(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  const norm = (s) => (IS_WIN ? s.toLowerCase() : s);
  const cc = norm(c);
  const pp = norm(p);
  if (cc === pp) return true;
  return cc.startsWith(pp.endsWith(path.sep) ? pp : pp + path.sep);
}

// In --json mode keep stdout machine-readable: all human progress goes to stderr.
export function routeLogsToStderrWhenJson(json) {
  if (!json) return;
  console.log = (...args) => process.stderr.write(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
}

export function emitJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function printHelp(title, lines) {
  process.stdout.write(title + "\n\n" + lines.join("\n") + "\n");
}

export function die(message, code) {
  process.stderr.write("OPS-ERROR " + message + "\n");
  process.exitCode = code || 2;
}

export function tail(s, n) {
  const lines = String(s).split("\n");
  return lines.slice(Math.max(0, lines.length - (n || 20))).join("\n");
}

export function detectJson(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}
