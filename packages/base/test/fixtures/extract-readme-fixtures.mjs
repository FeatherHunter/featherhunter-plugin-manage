#!/usr/bin/env node
/**
 * Snapshot the current README blocks of the five FeatherHunter plugin repos
 * into test/fixtures/readme-blocks.json.
 *
 * The five external repositories are READ-ONLY inputs: this script never writes
 * to them. Re-run it manually when the upstream READMEs change:
 *
 *   node test/fixtures/extract-readme-fixtures.mjs
 *
 * Override the checkout root with README_SOURCE_ROOT (defaults to D:/dsh-plugin).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const fixturesDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(fixturesDir, "../..");
const sourceRoot = process.env.README_SOURCE_ROOT ?? "D:/dsh-plugin";
const outputFile = resolve(fixturesDir, "readme-blocks.json");

/** The 11 README files that carry the four managed blocks today. */
const FILES = [
  { id: "deck", repo: "dsh-mattpocock-skills-deck", repoPath: "README.md" },
  { id: "deck-pkg", repo: "dsh-mattpocock-skills-deck", repoPath: "package/README.md" },
  { id: "deck-en", repo: "dsh-mattpocock-skills-deck", repoPath: "docs/README.en.md" },
  { id: "palette", repo: "dsh-opencode-palette", repoPath: "README.md" },
  { id: "palette-pkg", repo: "dsh-opencode-palette", repoPath: "package/README.md" },
  { id: "palette-en", repo: "dsh-opencode-palette", repoPath: "docs/README.en.md" },
  { id: "im", repo: "dsh-im-companion", repoPath: "README.md" },
  { id: "im-en", repo: "dsh-im-companion", repoPath: "docs/README.en.md" },
  { id: "prompt", repo: "dsh-prompt", repoPath: "README.md" },
  { id: "prompt-en", repo: "dsh-prompt", repoPath: "docs/README.en.md" },
  { id: "ilife", repo: "ilife", repoPath: "README.md" },
];

const BLOCK_KINDS = ["contact", "star-history", "thanks", "more"];

/** Blocks that are known to be absent before migration (F21: both are additions). */
const KNOWN_MISSING = {
  ilife: {
    "star-history": "ilife 当前没有星图区；F21 明确迁移后为新增块，不是迁移。",
    more: "ilife 当前没有作者其他作品区；F21 明确迁移后为新增块，不是迁移。",
  },
};

const PARSERS = {
  contact: "parseContactBlock",
  "star-history": "parseStarHistoryBlock",
  thanks: "parseThanksBlock",
  more: "parseMoreBlock",
};

async function importComparator() {
  const result = await build({
    entryPoints: [resolve(packageRoot, "src/node/readme-compare.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  const url = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  return import(url);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function detectLang(repoPath, blocks) {
  if (/\.en\.md$/i.test(repoPath)) return "en";
  const heading =
    blocks.contact?.parsed?.heading?.text ??
    blocks.thanks?.parsed?.heading?.text ??
    "";
  return heading !== "" && !/[\u4e00-\u9fff]/.test(heading) ? "en" : "zh";
}

const api = await importComparator();
const files = [];

for (const entry of FILES) {
  const absolutePath = resolve(sourceRoot, entry.repo, entry.repoPath);
  const markdown = readFileSync(absolutePath, "utf8");
  const located = api.locateReadmeBlocks(markdown);
  const blocks = {};
  for (const kind of BLOCK_KINDS) {
    const raw = located.blocks[kind];
    if (raw === null) {
      const note = KNOWN_MISSING[entry.id]?.[kind];
      blocks[kind] = { raw: null, parsed: null, missing: true, ...(note === undefined ? {} : { note }) };
      continue;
    }
    const parsed = api[PARSERS[kind]](raw);
    blocks[kind] = { raw, parsed, missing: false };
  }
  files.push({
    id: entry.id,
    repo: entry.repo,
    repoPath: entry.repoPath,
    lang: detectLang(entry.repoPath, blocks),
    sha256: sha256(markdown),
    bytes: Buffer.byteLength(markdown, "utf8"),
    lines: markdown.split(/\r?\n/).length,
    order: located.order,
    suspicious: located.suspicious,
    blocks,
  });
}

const missing = [];
for (const file of files) {
  for (const kind of BLOCK_KINDS) {
    if (file.blocks[kind].missing) missing.push(file.id + "." + kind);
  }
}

const fixture = {
  meta: {
    generator: "test/fixtures/extract-readme-fixtures.mjs",
    comparator: "src/node/readme-compare.ts",
    sourceRoot,
    readOnly: true,
    blockKinds: BLOCK_KINDS,
    fileCount: files.length,
    missingBlocks: missing,
    note:
      "Snapshot of the four hand-written README blocks in the five plugin repos, taken before " +
      "ticket 09/10 migration. Upstream repos are read-only inputs; regenerate manually when they change.",
  },
  files,
};

writeFileSync(outputFile, JSON.stringify(fixture, null, 2) + "\n", "utf8");

// Human-readable extraction report so reviewers can check the inventory quickly.
console.log("fixture:", outputFile);
console.log("files:", files.length, "bytes:", Buffer.byteLength(JSON.stringify(fixture), "utf8"));
for (const file of files) {
  const blocks = BLOCK_KINDS.map((kind) => (file.blocks[kind].missing ? kind + ":MISSING" : kind)).join(", ");
  const variants = {
    contact: file.blocks.contact.parsed?.variant ?? null,
    star: file.blocks["star-history"].parsed?.variant ?? null,
    thanks: file.blocks.thanks.parsed?.variant ?? null,
    more: file.blocks.more.parsed?.variant ?? null,
  };
  console.log("-", file.id, "[" + file.lang + "]", "order=" + file.order.join(">"), "|", blocks);
  console.log("  variants:", JSON.stringify(variants), "suspicious:", file.suspicious.length);
}
console.log("missing:", missing.join(", ") || "(none)");
