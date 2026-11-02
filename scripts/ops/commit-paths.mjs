#!/usr/bin/env node
// Commit exactly the given paths, with the message read from a file.
// Why: PowerShell mangles -m messages containing <field> / quotes; a message file is the
// reliable form. Also refuses when the index already holds unrelated staged changes.
import fs from "node:fs";
import path from "node:path";
import {
  parseArgs, runCapture, exists, emitJson, printHelp, die, yellow, dim, green, routeLogsToStderrWhenJson,
} from "./lib/common.mjs";

const HELP = [
  "Usage: node scripts/ops/commit-paths.mjs --message-file <file> <path> [<path>...]",
  "",
  "Commits only the listed paths (git add -- <paths>, then git commit -F <file>).",
  "",
  "Options:",
  "  --repo <path>       Repo root (default: current directory).",
  "  --message-file <f>  UTF-8 commit message file.",
  "  --dry-run           Show what would be staged/committed; write nothing.",
  "  --include-staged    Allow other already-staged changes to ride along (default: refuse).",
  "  --no-verify         Pass --no-verify to git commit.",
  "  --json              Machine-readable result.",
  "  --help              This message.",
  "",
  "Exit codes: 0 committed, 1 git refused, 2 prerequisite error.",
];

function git(repo, args) {
  return runCapture("git", ["-C", repo].concat(args), {});
}

function fail(message, code) {
  die(message, code);
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  // allow positionals that start with a dash only after --, keep it simple: all non-flags are paths
  const parsed = parseArgs(argv, {
    flags: {
      repo: { type: "value" }, "message-file": { type: "value" }, "dry-run": { type: "boolean" },
      "include-staged": { type: "boolean" }, "no-verify": { type: "boolean" },
      json: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  const options = parsed.options;
  routeLogsToStderrWhenJson(Boolean(options.json));
  if (options.help) { printHelp("commit-paths - commit only the listed paths", HELP); return; }
  if (parsed.unknown.length) { fail("unknown option(s): " + parsed.unknown.join(" "), 2); return; }
  const repo = path.resolve(options.repo || process.cwd());
  if (!exists(path.join(repo, ".git"))) { fail("not a git worktree: " + repo, 2); return; }
  if (!parsed.positionals.length) { fail("no paths given", 2); return; }
  const messageFile = options["message-file"] ? path.resolve(options["message-file"]) : null;
  if (!messageFile || !exists(messageFile) || !fs.statSync(messageFile).isFile()) { fail("--message-file is missing or not a file", 2); return; }
  const message = fs.readFileSync(messageFile, "utf8").replace(/^\uFEFF/, "");
  if (!message.trim()) { fail("commit message file is empty", 2); return; }

  const paths = [];
  for (const rel of parsed.positionals) {
    const abs = path.resolve(repo, rel);
    const relToRepo = path.relative(repo, abs);
    if (relToRepo.startsWith("..") || path.isAbsolute(relToRepo)) { fail("path escapes the repo: " + rel, 2); return; }
    const status = git(repo, ["status", "--porcelain", "--", relToRepo]);
    if (status.code !== 0) { fail("git status failed for " + rel + ": " + status.stderr.trim(), 2); return; }
    const line = status.stdout.replace(/\r/g, "").trim();
    if (!line && !exists(abs)) { fail("path has no change and does not exist: " + rel, 2); return; }
    paths.push(relToRepo);
  }

  const staged = git(repo, ["diff", "--cached", "--name-only"]);
  if (staged.code !== 0) fail("git diff --cached failed: " + staged.stderr.trim(), 2);
  const stagedNames = staged.stdout.replace(/\r/g, "").split("\n").filter(Boolean);
  if (stagedNames.length && !options["include-staged"]) {
    console.log(yellow("the index already has staged changes:"));
    for (const name of stagedNames) console.log("  " + name);
    fail("refusing to commit; unstage them or pass --include-staged", 2);
    return;
  }

  const plan = { repo, paths, messageFile, messageFirstLine: message.split("\n")[0], dryRun: Boolean(options["dry-run"]) };
  if (options["dry-run"]) {
    console.log("would stage:");
    for (const p of paths) console.log("  " + p);
    console.log("would commit with message from " + messageFile + ":");
    console.log(dim(message.split("\n").slice(0, 6).join("\n")));
    if (options.json) emitJson(Object.assign({ ok: true, dryRun: true }, plan));
    return;
  }

  let added = git(repo, ["add", "--"].concat(paths));
  if (added.code !== 0) { fail("git add failed: " + (added.stderr || added.stdout).trim(), 1); return; }
  const after = git(repo, ["diff", "--cached", "--name-only"]);
  const stagedAfter = after.stdout.replace(/\r/g, "").split("\n").filter(Boolean);
  const norm = (v) => v.replace(/\\/g, "/");
  const missing = paths.filter((p) => {
    const abs = path.join(repo, p);
    if (exists(abs) && fs.statSync(abs).isDirectory()) {
      const prefix = norm(p).split("/").filter(Boolean).join("/") + "/";
      return !stagedAfter.some((s) => norm(s).startsWith(prefix));
    }
    return !stagedAfter.some((s) => norm(s) === norm(p)) && exists(abs);
  });
  if (missing.length) { fail("git add did not stage: " + missing.join(", "), 1); return; }

  const commitArgs = ["commit", "-F", messageFile];
  if (options["no-verify"]) commitArgs.push("--no-verify");
  const commit = git(repo, commitArgs);
  if (commit.code !== 0) {
    console.log(dim((commit.stdout + "\n" + commit.stderr).trim().split("\n").slice(-12).join("\n")));
    fail("git commit failed; staged paths were left in the index: " + paths.join(", "), 1);
    return;
  }
  const hash = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  const stat = git(repo, ["show", "--stat", "--oneline", "--no-color", "HEAD"]).stdout.replace(/\r/g, "").trim();
  const files = git(repo, ["show", "--pretty=format:", "--name-only", "HEAD"]).stdout.replace(/\r/g, "").split("\n").filter(Boolean);
  if (options.json) { emitJson({ ok: true, hash, message: plan.messageFirstLine, files, stat }); return; }
  console.log(green("committed " + hash));
  console.log(dim(stat.split("\n")[0]));
  console.log("files: " + files.length);
  for (const f of files) console.log("  " + f);
}

main().catch((e) => { console.error("commit-paths crashed:", e && e.stack ? e.stack : e); process.exitCode = 2; });
