/**
 * Keep the capability documents in step with `describeCapability()`.
 *
 * The CLI help, `describe --json` and the shipped markdown are three projections
 * of one data object; hand-writing the markdown next to it is how the old scripts'
 * docs drifted. Only the reference block below the markers is generated, because
 * the surrounding prose ("first step: install", troubleshooting) is advice rather
 * than a contract, while the block (commands, checks, profile fields, exit codes,
 * global options) must never disagree with the binary.
 *
 * Usage (from packages/base):
 *
 *   npm run docs:sync    # rewrite the marked blocks
 *   npm run docs:check   # exit 1 when a block is stale
 *
 * The two modes share `spliceReference`, so a check is exactly a sync without the
 * write; the vitest suite runs the same check, which is what makes drift visible
 * on every test run instead of only before a release.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeCapability,
  type CapabilityDescription,
} from "../src/real-machine-verification/capability-description";
import { renderCapabilityMarkdown } from "../src/real-machine-verification/docs";

/** The package this script belongs to; used to reject the wrong working directory. */
const PACKAGE_NAME = "dsh-featherhunter-plugin-base";

/** Markers are whole lines; everything between them is owned by this script. */
export const REFERENCE_BEGIN = "<!-- dsh-verify:reference:begin -->";
export const REFERENCE_END = "<!-- dsh-verify:reference:end -->";

/** Documents that embed the generated reference, relative to the package root. */
export const DOC_TARGETS: readonly string[] = [
  "src/real-machine-verification/README.md",
  "src/real-machine-verification/AGENTS-USAGE.md",
];

const GENERATED_NOTE =
  "<!-- 本段由 `dsh-verify describe` 生成：不要手改；改完能力描述后运行 `npm run docs:sync`。 -->";

/** One level deeper, because the block is embedded under a section heading. */
export function demoteHeadings(markdown: string): string {
  return markdown.replace(/^(#{1,6})(\s)/gm, "#$1$2");
}

/** The exact text that belongs between the markers. */
export function renderReferenceBlock(description: CapabilityDescription = describeCapability()): string {
  const generated = demoteHeadings(renderCapabilityMarkdown(description)).trimEnd();
  return [GENERATED_NOTE, "", generated].join("\n");
}

/** Replace the block; throws instead of guessing when the markers are malformed. */
export function spliceReference(text: string, block: string): string {
  const lines = text.split("\n");
  const begins = lines.flatMap((line, index) => (line === REFERENCE_BEGIN ? [index] : []));
  const ends = lines.flatMap((line, index) => (line === REFERENCE_END ? [index] : []));
  if (begins.length !== 1) {
    throw new Error(`expected exactly one ${REFERENCE_BEGIN} line, found ${begins.length}`);
  }
  if (ends.length !== 1) {
    throw new Error(`expected exactly one ${REFERENCE_END} line, found ${ends.length}`);
  }
  const begin = begins[0] as number;
  const end = ends[0] as number;
  if (end < begin) {
    throw new Error(`${REFERENCE_END} appears before ${REFERENCE_BEGIN}`);
  }
  return [...lines.slice(0, begin + 1), ...block.split("\n"), ...lines.slice(end)].join("\n");
}

export interface DocsProblem {
  readonly file: string;
  readonly problem: string;
}

export interface DocsCheck {
  readonly ok: boolean;
  readonly problems: readonly DocsProblem[];
}

/**
 * Compare the documents on disk with what the description would generate.
 *
 * Reads the real filesystem on purpose: this is the release check, and the files
 * are the deliverable. Tests call it with the package root so a stale block fails
 * `npm test`, not just `npm run docs:check`.
 */
export function checkDocs(root: string, description: CapabilityDescription = describeCapability()): DocsCheck {
  const block = renderReferenceBlock(description);
  const problems: DocsProblem[] = [];
  for (const target of DOC_TARGETS) {
    const path = resolve(root, target);
    if (!existsSync(path)) {
      problems.push({ file: target, problem: "missing document" });
      continue;
    }
    const text = readFileSync(path, "utf8");
    let next: string;
    try {
      next = spliceReference(text, block);
    } catch (error) {
      problems.push({ file: target, problem: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (next !== text) {
      problems.push({ file: target, problem: "reference block is stale; run npm run docs:sync" });
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Rewrite every stale document; returns the ones that changed. */
export function syncDocs(root: string, description: CapabilityDescription = describeCapability()): readonly string[] {
  const block = renderReferenceBlock(description);
  const changed: string[] = [];
  for (const target of DOC_TARGETS) {
    const path = resolve(root, target);
    if (!existsSync(path)) throw new Error(`${target} not found under ${root}`);
    const text = readFileSync(path, "utf8");
    const next = spliceReference(text, block);
    if (next === text) continue;
    writeFileSync(path, next, "utf8");
    changed.push(target);
  }
  return changed;
}

/**
 * Locate the package root without depending on how this file was launched.
 *
 * Same rule as scripts/build.ts: run-ts.mjs bundles us into `<root>/.tmp/scripts`,
 * so `import.meta.url` is two levels below the root; the manifest name is the tie
 * breaker and a wrong cwd produces an actionable message instead of a half sync.
 */
export function resolvePackageRoot(startDirectory: string = process.cwd()): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env["DSH_BASE_ROOT"],
    startDirectory,
    resolve(here, "..", ".."),
    resolve(here, ".."),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const manifestPath = resolve(candidate, "package.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string };
      if (manifest.name === PACKAGE_NAME) return resolve(candidate);
    } catch {
      // A malformed package.json elsewhere on the walk is not our problem.
    }
  }
  throw new Error(`cannot find the ${PACKAGE_NAME} package root; run this from packages/base`);
}

/** Entry point used by `node scripts/run-ts.mjs docs [--check]`. */
export async function runCli(args: readonly string[]): Promise<number> {
  const checkOnly = args.includes("--check");
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    console.error(`docs: unknown argument ${unknown[0]}; usage: docs [--check]`);
    return 2;
  }
  let root: string;
  try {
    root = resolvePackageRoot();
  } catch (error) {
    console.error(`docs failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (checkOnly) {
    const result = checkDocs(root);
    if (!result.ok) {
      for (const problem of result.problems) console.error(`docs stale: ${problem.file}: ${problem.problem}`);
      return 1;
    }
    console.log("docs ok: README.md and AGENTS-USAGE.md match describe");
    return 0;
  }
  const changed = syncDocs(root);
  console.log(changed.length === 0 ? "docs ok: nothing to update" : `docs updated: ${changed.join(", ")}`);
  return 0;
}
