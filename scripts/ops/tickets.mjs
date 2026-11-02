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
  "  --effort <name>    Limit to one .scratch/<effort> directory (exact name wins).",
  "  --state <s>        open | closed | all (default: all).",
  "  --key <k>          Exact ticket key (accepts 1, 01, 001).",
  "  --find <text>      Case-insensitive substring in title / body.",
  "  --comments <n>     With --key: print the last n comments (default 0).",
  "  --full             With --key: print the full body.",
  "  --json             Machine-readable output.",
  "  --help             This message.",
  "",
  "Exit codes: 0 success, 1 key not found / ambiguous / filtered out, 2 prerequisite error.",
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

// Ticket keys are numbered, and "8", "08" and the spec's "00" must all mean the
// same ticket. Normalising once at the edge keeps the later comparison exact.
function normalizeKey(raw) {
  const s = String(raw === undefined || raw === null ? "" : raw).trim();
  return s.replace(/^0+(\d)/, "$1");
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
  const lines = text.split(/\r?\n/);
  let inProgress = false;
  let last = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+进度/.test(trimmed)) { inProgress = true; continue; }
    if (inProgress && /^##\s+/.test(trimmed)) break;
    if (!inProgress) continue;
    const m = /^-\s*进度[：:]\s*(\d+)\s*%(.*)$/.exec(trimmed);
    // Deck writes the newest progress entry at the TOP of the section; keep the first one.
    if (m && last === null) last = { percent: Number(m[1]), raw: trimmed, rest: m[2].trim() };
  }
  return last;
}

function parseComments(text) {
  const lines = text.split(/\r?\n/);
  let inComments = false;
  const comments = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+(Comments|评论)/i.test(trimmed)) { inComments = true; continue; }
    if (inComments && /^##\s+/.test(trimmed)) break;
    if (!inComments) continue;
    const m = /^###\s+(.+)$/.exec(trimmed);
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
    key: "0",
    displayKey: "00",
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
  // firstHeading() already dropped the leading "# ", so the heading key must
  // match both "# 08: title" and "08: title".
  const headingKey = (/^(?:#\s*)?(\d{1,3})\b/.exec(firstHeading(text)) || [])[1];
  const keyRaw = fileKey || headingKey || "?";
  const key = normalizeKey(keyRaw);
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

function compareCandidates(a, b) {
  if (a.effort !== b.effort) return a.effort < b.effort ? -1 : 1;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return 0;
}

function candidateJson(t) {
  return {
    key: t.key,
    displayKey: t.displayKey,
    type: t.type,
    effort: t.effort,
    state: t.state,
    stateRaw: t.stateRaw,
    title: t.title,
    parent: t.parent,
    file: t.file,
  };
}

// Key resolution never guesses. An ambiguous or filtered-out key exits 1 and
// lists every candidate with its effort and state; --json gets the same list
// in structured form on stdout while stderr stays readable for humans.
function reportKeyFailure(reason, wanted, candidates, json) {
  if (reason === "not-found") {
    if (json) emitJson({ error: "not-found", key: wanted, candidates: [] });
    die("ticket not found: " + wanted, 1);
    return;
  }
  const list = candidates.slice().sort(compareCandidates);
  const header = reason === "ambiguous-key"
    ? "ambiguous key " + wanted + ": " + list.length + " candidate(s)"
    : "ticket " + wanted + " is filtered out by --effort/--state/--find: " + list.length + " candidate(s)";
  const lines = [header];
  for (const c of list) {
    lines.push("  - effort=" + c.effort + " state=" + c.state + " title=" + c.title + " file=" + c.file);
  }
  if (json) emitJson({ error: reason, key: wanted, candidates: list.map(candidateJson) });
  die(lines.join("\n"), 1);
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
  if (options.effort) {
    // Exact directory names win: base-package and base-package-rollout both
    // exist, and a plain substring match would turn a unique key into a
    // false ambiguity. Substring stays as a convenience only when no effort
    // directory matches exactly.
    const wantedEffort = String(options.effort);
    const lower = wantedEffort.toLowerCase();
    const effortNames = Array.from(new Set(discovered.tickets.map((t) => t.effort)));
    let chosen = effortNames.filter((name) => name === wantedEffort);
    if (!chosen.length) chosen = effortNames.filter((name) => name.toLowerCase() === lower);
    if (!chosen.length) chosen = effortNames.filter((name) => name.toLowerCase().indexOf(lower) >= 0);
    const keep = new Set(chosen);
    tickets = tickets.filter((t) => keep.has(t.effort));
  }
  if (state !== "all") tickets = tickets.filter((t) => t.state === state);
  if (options.find) {
    const needle = String(options.find).toLowerCase();
    tickets = tickets.filter((t) => (t.title + "\n" + t.body).toLowerCase().indexOf(needle) >= 0);
  }
  tickets.sort((a, b) => (a.effort === b.effort ? Number(a.key) - Number(b.key) : a.effort.localeCompare(b.effort)));

  if (options.key !== undefined) {
    const wanted = normalizeKey(options.key);
    const json = Boolean(options.json);
    const matches = tickets.filter((t) => t.key === wanted);
    if (!matches.length) {
      const elsewhere = discovered.tickets.filter((t) => t.key === wanted);
      reportKeyFailure(elsewhere.length ? "filtered-out" : "not-found", wanted, elsewhere, json);
      return;
    }
    if (matches.length > 1) {
      reportKeyFailure("ambiguous-key", wanted, matches, json);
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
