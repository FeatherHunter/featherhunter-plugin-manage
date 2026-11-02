#!/usr/bin/env node
// Read-only view of the local markdown issue tracker (.scratch/<effort>/spec.md + issues/*.md).
// Why this exists: deck_issue_get without an effort/feature scope can silently resolve a
// same-numbered ticket from a DIFFERENT effort. This script reads the files directly and
// never guesses: keys are matched exactly, and ambiguities are reported.
import fs from "node:fs";
import path from "node:path";
import { parseArgs, readText, exists, emitJson, printHelp, red, yellow, dim, die } from "./lib/common.mjs";

const HELP = [
  "Usage: node scripts/ops/tickets.mjs [options]",
  "",
  "Options:",
  "  --repo <path>      Repo root (default: current working directory).",
  "  --effort <name>    Only tickets in this .scratch/<effort> directory.",
  "  --state <s>        open | closed | all (default: all).",
  "  --key <k>          Exact ticket key (accepts 1, 01, 001).",
  "  --find <text>      Case-insensitive substring in title / body.",
  "  --comments <n>     With --key: print the last n comments (default 0).",
  "  --full             With --key: print the full body.",
  "  --json             Machine-readable output.",
  "  --help             This message.",
  "",
  "Exit codes: 0 success, 1 key not found, 2 prerequisite error.",
];

function headerMap(text) {
  const map = {};
  const re = /<!--\s*DSH-([A-Z0-9-]+):\s*([\s\S]*?)\s*-->/g;
  let m;
  while ((m = re.exec(text)) !== null) map[m[1]] = m[2].trim();
  return map;
}

function firstHeading(text) {
  const lines = text.split("\n");
  for (const line of lines) {
    if (/^#\s+/.test(line)) return line.replace(/^#\s+/, "").trim();
  }
  return "(no title)";
}

function normalizeState(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s === "closed" || s === "resolved" || s === "done") return "closed";
  if (s === "open" || s === "ready-for-agent" || s === "in-progress" || s === "needs-triage" || s === "needs-info") return "open";
  return s;
}

function parseBlockedBy(text, headers) {
  const fromHeader = headers["BLOCKED-BY"];
  let raw = fromHeader;
  if (!raw) {
    const m = /\*\*Blocked by:\*\*\s*(.+)/.exec(text);
    if (m) raw = m[1];
  }
  if (!raw) return [];
  const cleaned = raw.trim();
  if (/^(none|无|n\/a)$/i.test(cleaned)) return [];
  const keys = [];
  const re = /\b(\d{1,3})\b/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) keys.push(m[1]);
  return Array.from(new Set(keys));
}

function parseProgress(text) {
  const lines = text.split("\n");
  let inProgress = false;
  let last = null;
  for (const line of lines) {
    if (/^##\s+进度/.test(line)) { inProgress = true; continue; }
    if (inProgress && /^##\s+/.test(line)) break;
    if (!inProgress) continue;
    const m = /^-\s*进度：\s*(\d+)%(.*)$/.exec(line.trim());
    // Deck writes the newest progress entry at the TOP of the section; keep the first one.
    if (m && last === null) last = { percent: Number(m[1]), raw: line.trim(), rest: m[2].trim() };
  }
  return last;
}

function parseComments(text) {
  const lines = text.split("\n");
  let inComments = false;
  const comments = [];
  for (const line of lines) {
    if (/^##\s+Comments/.test(line)) { inComments = true; continue; }
    if (inComments && /^##\s+/.test(line)) break;
    if (!inComments) continue;
    const m = /^###\s+(.+)$/.exec(line.trim());
    if (m) comments.push({ heading: m[1], lines: [] });
    else if (comments.length) comments[comments.length - 1].lines.push(line);
  }
  return comments;
}

function parseSpecTicket(effortDir, effortName) {
  const specPath = path.join(effortDir, "spec.md");
  const text = readText(specPath);
  if (!text) return null;
  const headers = headerMap(text);
  const title = headers.TITLE || firstHeading(text);
  const statusRaw = headers.STATUS || (/\*\*Status:\*\*\s*(.+)/.exec(text) || [])[1] || "";
  return {
    effort: effortName,
    key: "00",
    type: "spec",
    title,
    state: normalizeState(statusRaw),
    stateRaw: String(statusRaw).trim(),
    parent: null,
    labels: (headers.LABELS || "").split(",").map((s) => s.trim()).filter(Boolean),
    blockedBy: parseBlockedBy(text, headers),
    progress: parseProgress(text),
    comments: parseComments(text).length,
    lastCommentAt: null,
    file: specPath,
    body: text,
  };
}

function parseIssue(issuePath, effortName) {
  const fileName = path.basename(issuePath);
  const text = readText(issuePath);
  if (!text) return null;
  const headers = headerMap(text);
  const fileKey = (/^(\d{1,3})-/.exec(fileName) || [])[1];
  const headingKey = (/^#\s*(\d{1,3})\b/.exec(firstHeading(text)) || [])[1];
  const keyRaw = fileKey || headingKey || "?";
  const key = String(keyRaw).replace(/^0+(\d)/, "$1");
  const statusRaw = headers.STATUS || (/\*\*Status:\*\*\s*(.+)/.exec(text) || [])[1] || "";
  const comments = parseComments(text);
  return {
    effort: effortName,
    key: key,
    displayKey: fileKey || key,
    type: "issue",
    title: firstHeading(text).replace(/^\d+\s*[:.]\s*/, "").replace(/^\d+\s+/, "").trim(),
    state: normalizeState(statusRaw),
    stateRaw: String(statusRaw).trim(),
    parent: headers.PARENT || null,
    labels: (headers.LABELS || "").split(",").map((s) => s.trim()).filter(Boolean),
    blockedBy: parseBlockedBy(text, headers),
    progress: parseProgress(text),
    comments: comments.length,
    lastCommentAt: comments.length ? comments[comments.length - 1].heading : null,
    file: issuePath,
    body: text,
    commentsText: comments,
  };
}

function discover(repo) {
  const scratch = path.join(repo, ".scratch");
  const out = [];
  const problems = [];
  if (!exists(scratch)) { problems.push("no .scratch directory at " + scratch); return { tickets: out, problems }; }
  let efforts = [];
  try { efforts = fs.readdirSync(scratch, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch (e) { problems.push("cannot list " + scratch + ": " + e.message); return { tickets: out, problems }; }
  for (const effortName of efforts) {
    const effortDir = path.join(scratch, effortName);
    const spec = parseSpecTicket(effortDir, effortName);
    if (spec) out.push(spec);
    const issuesDir = path.join(effortDir, "issues");
    if (!exists(issuesDir)) continue;
    let files = [];
    try { files = fs.readdirSync(issuesDir).filter((f) => f.endsWith(".md")); } catch { files = []; }
    for (const f of files) {
      const ticket = parseIssue(path.join(issuesDir, f), effortName);
      if (ticket) out.push(ticket);
    }
  }
  return { tickets: out, problems };
}

function fmtProgress(p) {
  if (!p) return "-";
  return String(p.percent).padStart(3, " ") + "%";
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), {
    flags: {
      repo: { type: "value" }, effort: { type: "value" }, state: { type: "value" },
      key: { type: "value" }, find: { type: "value" }, comments: { type: "value" },
      full: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  const options = parsed.options;
  if (options.help) { printHelp("tickets - read-only local markdown ticket view", HELP); return; }
  if (parsed.unknown.length) { die("unknown option(s): " + parsed.unknown.join(" "), 2); return; }
  const repo = path.resolve(options.repo || process.cwd());
  if (!exists(repo)) { die("repo not found: " + repo, 2); return; }
  const discovered = discover(repo);
  if (discovered.problems.length && !discovered.tickets.length) { die(discovered.problems.join("; "), 2); return; }
  let tickets = discovered.tickets;
  const state = (options.state || "all").toLowerCase();
  if (options.effort) tickets = tickets.filter((t) => t.effort === options.effort || t.effort.indexOf(options.effort) >= 0);
  if (state !== "all") tickets = tickets.filter((t) => t.state === state);
  if (options.find) {
    const needle = String(options.find).toLowerCase();
    tickets = tickets.filter((t) => (t.title + "\n" + t.body).toLowerCase().indexOf(needle) >= 0);
  }
  tickets.sort((a, b) => (a.effort === b.effort ? Number(a.key) - Number(b.key) : a.effort.localeCompare(b.effort)));

  if (options.key !== undefined) {
    const wanted = String(options.key).replace(/^0+(\d)/, "$1");
    const matches = tickets.filter((t) => t.key === wanted);
    if (!matches.length) {
      const all = discovered.tickets.filter((t) => t.key === wanted);
      if (all.length) {
        process.stderr.write("ticket " + wanted + " exists only in other efforts/states: " + all.map((t) => t.effort + "/" + t.state).join(", ") + "\n");
        process.exitCode = 1;
        return;
      }
      die("ticket not found: " + wanted, 1);
      return;
    }
    if (matches.length > 1) {
      process.stderr.write("ambiguous key " + wanted + " in efforts: " + matches.map((t) => t.effort).join(", ") + "\n");
      process.exitCode = 1;
      return;
    }
    const t = matches[0];
    if (options.json) { emitJson({ ticket: t, comments: options.comments ? t.commentsText.slice(-Number(options.comments)) : undefined }); return; }
    console.log("key:       " + t.key + (t.displayKey !== t.key ? " (" + t.displayKey + ")" : ""));
    console.log("title:     " + t.title);
    console.log("effort:    " + t.effort);
    console.log("state:     " + t.state + (t.stateRaw && t.stateRaw !== t.state ? " (" + t.stateRaw + ")" : ""));
    console.log("parent:    " + (t.parent || "-"));
    console.log("blockedBy: " + (t.blockedBy.length ? t.blockedBy.join(", ") : "-"));
    console.log("labels:    " + (t.labels.join(", ") || "-"));
    console.log("progress:  " + (t.progress ? t.progress.percent + "% " + (t.progress.rest || "") : "-"));
    console.log("comments:  " + t.comments + (t.lastCommentAt ? " (last " + t.lastCommentAt + ")" : ""));
    console.log("file:      " + t.file);
    console.log("");
    if (options.full) console.log(t.body);
    else console.log(t.body.split("\n").slice(0, 24).join("\n") + "\n...");
    if (options.comments) {
      const n = Number(options.comments);
      const list = t.commentsText.slice(-n);
      for (const c of list) {
        console.log("");
        console.log("--- " + c.heading + " ---");
        console.log(c.lines.join("\n").trim().slice(0, 4000));
      }
    }
    return;
  }

  if (options.json) {
    const counts = { total: tickets.length, open: tickets.filter((t) => t.state === "open").length, closed: tickets.filter((t) => t.state === "closed").length };
    emitJson({ repo, counts, tickets: tickets.map((t) => ({ effort: t.effort, key: t.key, type: t.type, state: t.state, title: t.title, parent: t.parent, blockedBy: t.blockedBy, progress: t.progress ? t.progress.percent : null, comments: t.comments, file: t.file })), problems: discovered.problems });
    return;
  }
  console.log("tickets in " + repo + " (effort/state filters: " + (options.effort || "*") + "/" + state + ")");
  let lastEffort = null;
  for (const t of tickets) {
    if (t.effort !== lastEffort) { console.log("\n== " + t.effort); lastEffort = t.effort; }
    const stateLabel = t.state === "closed" ? "closed" : t.state === "open" ? "open  " : t.state;
    console.log("  " + String(t.key).padStart(2, "0") + "  " + stateLabel + "  " + fmtProgress(t.progress) + "  " + (t.blockedBy.length ? "blocked:" + t.blockedBy.join(",") : "         ") + "  " + t.title);
  }
  console.log("\n" + tickets.length + " ticket(s); " + discovered.problems.length + " problem(s)");
  if (discovered.problems.length) for (const p of discovered.problems) console.log("  " + yellow(p));
  process.exitCode = 0;
}

main().catch((e) => { console.error("tickets crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
