/**
 * Architecture gates (DESIGN.md §4): dependency direction, no plugin constants,
 * zero dependencies.
 *
 * The gates exist so a refactor cannot quietly break the promise the capability
 * makes to five plugin repositories: this directory depends on nothing but Node,
 * it does not know any concrete plugin, and its documents are projections of
 * `describeCapability()` rather than a second hand-written list.
 *
 * Why a second test file when the scans already live elsewhere:
 * - direction also lives in self-contained.test.ts (regex scanner over the source
 *   tree) and zero-dependency is enforced for the built bundle by
 *   scripts/bundle-contract.ts + test/bundle-contract.test.ts;
 * - the gate that was *missing* is "no plugin constants". This file re-implements
 *   the three scans over one shared reader so they are auditable in one place, and
 *   every scan carries a synthetic fixture proving it can go red (a gate that
 *   cannot fail is theatre).
 *
 * The fourth gate, documents-are-generated, lives in test/docs-sync.test.ts: it
 * needs `scripts/docs.ts`, which sits outside `src`, and `tsconfig.build.json`
 * pins `rootDir: src`, so a static import from a test under `src` would fail the
 * declaration build (TS6059). The split is recorded in ADR-0002 §6.
 *
 * The import reader is a small hand-written scanner rather than a regex because a
 * regex cannot tell code from a string: the isolation probe embeds
 * `require("os")` inside a template literal, and a bundle scanner that counts that
 * as a dependency would be wrong.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Source reader
// ---------------------------------------------------------------------------

interface SourceFile {
  readonly path: string;
  readonly source: string;
}

const QUOTES: ReadonlySet<string> = new Set(["'", '"']);

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function wordAt(source: string, index: number, word: string): boolean {
  if (!source.startsWith(word, index)) return false;
  return !isWordChar(source[index - 1]) && !isWordChar(source[index + word.length]);
}

function skipSpaces(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function skipLineComment(source: string, index: number): number {
  const newline = source.indexOf("\n", index);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, index: number): number {
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
}

function skipQuoted(source: string, index: number): number {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

/** Skip a template literal, including nested `${...}` expressions. */
function skipTemplate(source: string, index: number): number {
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "`") return cursor + 1;
    if (char === "$" && source[cursor + 1] === "{") {
      cursor = skipInterpolation(source, cursor + 2);
      continue;
    }
    cursor += 1;
  }
  return source.length;
}

function skipInterpolation(source: string, index: number): number {
  let depth = 1;
  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "{") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      cursor += 1;
      if (depth === 0) return cursor;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    if (QUOTES.has(char ?? "")) {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === "`") {
      cursor = skipTemplate(source, cursor);
      continue;
    }
    cursor += 1;
  }
  return source.length;
}

interface FoundSpecifier {
  readonly specifier: string;
  readonly end: number;
}

/**
 * Read the module specifier of a static import/export clause.
 *
 * Stops without a result at a semicolon, a string or an assignment: those mean
 * the statement is not `import ... from "..."` / `export ... from "..."`.
 */
function findFromSpecifier(source: string, start: number): FoundSpecifier | null {
  let cursor = start;
  const limit = Math.min(source.length, start + 4000);
  while (cursor < limit) {
    const char = source[cursor];
    if (char === ";") return null;
    if (char === "=") return null;
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    if (QUOTES.has(char ?? "")) return null;
    if (char === "{") {
      const close = source.indexOf("}", cursor);
      if (close === -1) return null;
      cursor = close + 1;
      continue;
    }
    if (wordAt(source, cursor, "from")) {
      const quote = skipSpaces(source, cursor + 4);
      const quoteChar = source[quote];
      if (quoteChar === '"' || quoteChar === "'") {
        const end = skipQuoted(source, quote);
        if (end > quote + 1 && source[end - 1] === quoteChar) {
          return { specifier: source.slice(quote + 1, end - 1), end };
        }
        return null;
      }
    }
    cursor += 1;
  }
  return null;
}

/** Every module specifier the file mentions through a form that creates a dependency. */
function moduleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    if (QUOTES.has(char ?? "")) {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === "`") {
      cursor = skipTemplate(source, cursor);
      continue;
    }
    if (!isWordChar(source[cursor - 1]) && wordAt(source, cursor, "import")) {
      const next = skipSpaces(source, cursor + 6);
      const nextChar = source[next];
      if (nextChar === ".") {
        // import.meta is not a dependency.
        cursor = next + 1;
        continue;
      }
      if (nextChar === "(") {
        const argument = skipSpaces(source, next + 1);
        if (QUOTES.has(source[argument] ?? "")) {
          const end = skipQuoted(source, argument);
          specifiers.push(source.slice(argument + 1, end - 1));
          cursor = end;
          continue;
        }
        cursor = next + 1;
        continue;
      }
      if (QUOTES.has(nextChar ?? "")) {
        const end = skipQuoted(source, next);
        specifiers.push(source.slice(next + 1, end - 1));
        cursor = end;
        continue;
      }
      const found = findFromSpecifier(source, cursor + 6);
      if (found !== null) {
        specifiers.push(found.specifier);
        cursor = found.end;
        continue;
      }
      cursor = next;
      continue;
    }
    if (!isWordChar(source[cursor - 1]) && wordAt(source, cursor, "export")) {
      const found = findFromSpecifier(source, cursor + 6);
      if (found !== null) {
        specifiers.push(found.specifier);
        cursor = found.end;
        continue;
      }
      cursor += 6;
      continue;
    }
    if (!isWordChar(source[cursor - 1]) && wordAt(source, cursor, "require")) {
      const open = skipSpaces(source, cursor + 7);
      if (source[open] === "(") {
        const argument = skipSpaces(source, open + 1);
        if (QUOTES.has(source[argument] ?? "")) {
          const end = skipQuoted(source, argument);
          specifiers.push(source.slice(argument + 1, end - 1));
          cursor = end;
          continue;
        }
      }
      cursor += 7;
      continue;
    }
    cursor += 1;
  }
  return specifiers;
}

/** Remove comments, keeping strings and template literals intact. */
function stripComments(source: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      out += "\n";
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    if (QUOTES.has(char ?? "") || char === "`") {
      const end = char === "`" ? skipTemplate(source, cursor) : skipQuoted(source, cursor);
      out += source.slice(cursor, end);
      cursor = end;
      continue;
    }
    out += char;
    cursor += 1;
  }
  return out;
}

/** String literals that are code, not template text and not comments. */
function codeStringLiterals(source: string): string[] {
  const literals: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    if (char === "`") {
      cursor = skipTemplate(source, cursor);
      continue;
    }
    if (QUOTES.has(char ?? "")) {
      const end = skipQuoted(source, cursor);
      literals.push(source.slice(cursor + 1, end - 1));
      cursor = end;
      continue;
    }
    cursor += 1;
  }
  return literals;
}

// ---------------------------------------------------------------------------
// Real source tree
// ---------------------------------------------------------------------------

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const RMV_ROOT = resolve(TESTS_DIR, "..");
const SRC_ROOT = resolve(RMV_ROOT, "..");

const CONTRACTS_DIR = resolve(RMV_ROOT, "contracts");
const RUNTIME_DIR = resolve(RMV_ROOT, "runtime");
const ADAPTERS_DIR = resolve(RMV_ROOT, "adapters");
const CORE_DIR = resolve(SRC_ROOT, "core");
const CLIENT_DIR = resolve(SRC_ROOT, "client");

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function isUnder(path: string, root: string): boolean {
  const normalized = toPosix(resolve(path)).replace(/\.(ts|tsx)$/, "");
  const normalizedRoot = toPosix(resolve(root)).replace(/\.(ts|tsx)$/, "");
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
}

function resolvesUnder(file: string, specifier: string, root: string): boolean {
  if (!specifier.startsWith(".")) return false;
  return isUnder(resolve(dirname(file), specifier), root);
}

function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...listTypeScriptFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function readFiles(paths: readonly string[]): SourceFile[] {
  return paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

/** Production source only: tests are not part of the shipped contract. */
const PRODUCTION_FILES = readFiles(listTypeScriptFiles(RMV_ROOT).filter((path) => !isUnder(path, TESTS_DIR)));
const CONTRACT_FILES = PRODUCTION_FILES.filter((file) => isUnder(file.path, CONTRACTS_DIR));
const RUNTIME_FILES = PRODUCTION_FILES.filter((file) => isUnder(file.path, RUNTIME_DIR));
const BASE_OTHER_FILES = readFiles(listTypeScriptFiles(SRC_ROOT).filter((path) => !isUnder(path, RMV_ROOT)));

function describeFile(file: string): string {
  return toPosix(file).replace(`${toPosix(RMV_ROOT)}/`, "");
}

interface Violation {
  readonly file: string;
  readonly problem: string;
}

// ---------------------------------------------------------------------------
// Gate 1: dependency direction
// ---------------------------------------------------------------------------

function contractDirectionViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const specifier of moduleSpecifiers(file.source)) {
      if (specifier.startsWith(".")) {
        if (!resolvesUnder(file.path, specifier, CONTRACTS_DIR)) {
          violations.push({ file: file.path, problem: `contracts must not import upper layers: "${specifier}"` });
        }
        continue;
      }
      if (!specifier.startsWith("node:")) {
        violations.push({ file: file.path, problem: `contracts must stay dependency-free; found "${specifier}"` });
      }
    }
  }
  return violations;
}

function runtimeAdapterViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const specifier of moduleSpecifiers(file.source)) {
      if (resolvesUnder(file.path, specifier, ADAPTERS_DIR) || specifier.includes("adapters/")) {
        violations.push({ file: file.path, problem: `runtime must not depend on adapters: "${specifier}"` });
      }
    }
  }
  return violations;
}

function baseCouplingViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const specifier of moduleSpecifiers(file.source)) {
      if (resolvesUnder(file.path, specifier, CORE_DIR) || resolvesUnder(file.path, specifier, CLIENT_DIR)) {
        violations.push({ file: file.path, problem: `the capability must not import base core/client: "${specifier}"` });
      }
    }
  }
  return violations;
}

function reverseCouplingViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const specifier of moduleSpecifiers(file.source)) {
      if (resolvesUnder(file.path, specifier, RMV_ROOT) || specifier.includes("real-machine-verification")) {
        violations.push({ file: file.path, problem: `base must not import the capability: "${specifier}"` });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Gate 2: no plugin constants
// ---------------------------------------------------------------------------

/**
 * The five repositories this capability is shared by. The capability itself may
 * know the *shape* of a plugin (profile fields) but never a concrete identity.
 * `agent-default-model` / `llm-pi-ai` are deliberately absent: they are DSH host
 * schema keys, not target-plugin identities (see docs/adr/0002).
 */
const TARGET_PLUGIN_TOKENS: readonly string[] = [
  "dsh-mattpocock-skills-deck",
  "mattskillsdeck",
  "mattpocock",
  "dsh-opencode-palette",
  "opencode-palette",
  "dsh-im-companion",
  "im-companion",
  "dsh-prompt",
  "ilife",
];

const CACHE_DIRECTORY_LITERAL = /\.dsh-[a-z0-9][a-z0-9-]*/gi;
const PROFILE_NAME_LITERAL = /^(web|desktop)$/;

function pluginConstantViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const code = stripComments(file.source);
    for (const token of TARGET_PLUGIN_TOKENS) {
      if (new RegExp(`\\b${token}\\b`, "i").test(code)) {
        violations.push({ file: file.path, problem: `names a concrete target plugin: "${token}"` });
      }
    }
    for (const match of code.matchAll(CACHE_DIRECTORY_LITERAL)) {
      violations.push({ file: file.path, problem: `hardcodes a plugin cache directory: "${match[0]}"` });
    }
    for (const literal of codeStringLiterals(file.source)) {
      if (PROFILE_NAME_LITERAL.test(literal)) {
        violations.push({ file: file.path, problem: `hardcodes a profile name: "${literal}"` });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Gate 3: zero dependencies
// ---------------------------------------------------------------------------

function nonNodeDependencyViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const specifier of moduleSpecifiers(file.source)) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      violations.push({ file: file.path, problem: `the capability may only import node: builtins; found "${specifier}"` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("architecture gate 1: dependency direction", () => {
  it("scans a non-trivial source tree, so an empty scan cannot pass silently", () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(40);
    expect(CONTRACT_FILES.length).toBeGreaterThan(8);
    expect(RUNTIME_FILES.length).toBeGreaterThan(5);
    expect(BASE_OTHER_FILES.length).toBeGreaterThan(5);
  });

  it("keeps contracts below every other layer (node: builtins and contracts only)", () => {
    expect(contractDirectionViolations(CONTRACT_FILES)).toEqual([]);
  });

  it("keeps runtime independent of adapters", () => {
    expect(runtimeAdapterViolations(RUNTIME_FILES)).toEqual([]);
  });

  it("keeps the capability independent of base core/client", () => {
    expect(baseCouplingViolations(PRODUCTION_FILES)).toEqual([]);
  });

  it("keeps base modules out of the capability", () => {
    expect(reverseCouplingViolations(BASE_OTHER_FILES)).toEqual([]);
  });

  it("flags each prohibited edge when one is planted (the gate has teeth)", () => {
    const contractsProbe = resolve(CONTRACTS_DIR, "probe.ts");
    const runtimeProbe = resolve(RUNTIME_DIR, "probe.ts");
    const rmvProbe = resolve(RMV_ROOT, "probe.ts");
    const baseProbe = resolve(SRC_ROOT, "node/probe.ts");
    expect(
      contractDirectionViolations([
        { path: contractsProbe, source: 'import { run } from "../orchestration/probe";' },
        { path: contractsProbe, source: 'import "zod";' },
      ]),
    ).toHaveLength(2);
    expect(
      contractDirectionViolations([
        { path: contractsProbe, source: 'import { ok } from "./result";' },
        { path: contractsProbe, source: 'import { createHash } from "node:crypto";' },
      ]),
    ).toEqual([]);
    expect(
      runtimeAdapterViolations([{ path: runtimeProbe, source: 'import { load } from "../adapters/browser/loader";' }]),
    ).toHaveLength(1);
    expect(
      baseCouplingViolations([{ path: rmvProbe, source: 'import { render } from "../core/index";' }]),
    ).toHaveLength(1);
    expect(
      reverseCouplingViolations([{ path: baseProbe, source: 'import { run } from "../real-machine-verification/index";' }]),
    ).toHaveLength(1);
  });
});

describe("architecture gate 2: no plugin constants", () => {
  it("finds no concrete plugin identity, cache directory or profile constant in production source", () => {
    expect(pluginConstantViolations(PRODUCTION_FILES)).toEqual([]);
  });

  it("flags a planted plugin name, cache literal and profile constant (the gate has teeth)", () => {
    const probe = resolve(RMV_ROOT, "probe.ts");
    const violations = pluginConstantViolations([
      { path: probe, source: 'const id = "dsh-mattpocock-skills-deck";' },
      { path: probe, source: 'const cache = ".dsh-mattskillsdeck-cache";' },
      { path: probe, source: 'const profile = { defaultProfile: "web" };' },
    ]);
    // The token list is blunt on purpose: a full plugin name also contains its
    // component tokens ("mattpocock", "mattskillsdeck"), so all of them trip.
    expect(violations.map((violation) => violation.problem)).toEqual([
      'names a concrete target plugin: "dsh-mattpocock-skills-deck"',
      'names a concrete target plugin: "mattpocock"',
      'names a concrete target plugin: "mattskillsdeck"',
      'hardcodes a plugin cache directory: ".dsh-mattskillsdeck-cache"',
      'hardcodes a profile name: "web"',
    ]);
  });

  it("allows host schema keys, comments and template text", () => {
    const probe = resolve(RMV_ROOT, "probe.ts");
    expect(
      pluginConstantViolations([
        { path: probe, source: 'const hostEntries = ["agent-default-model", "llm-pi-ai"];' },
        { path: probe, source: '// mattskillsdeck and .dsh-mattskillsdeck-cache are prose\nconst x = 1;' },
        { path: probe, source: "const template = `defaultProfile: \"web\"`;" },
      ]),
    ).toEqual([]);
  });
});

describe("architecture gate 3: zero dependencies", () => {
  it("only names node: builtins outside relative imports", () => {
    expect(nonNodeDependencyViolations(PRODUCTION_FILES)).toEqual([]);
  });

  it("flags a package import but not strings, templates or comments that look like one", () => {
    const probe = resolve(RMV_ROOT, "probe.ts");
    expect(nonNodeDependencyViolations([{ path: probe, source: 'import { z } from "zod";' }])).toHaveLength(1);
    expect(
      nonNodeDependencyViolations([
        { path: probe, source: 'const label = "import x from \"left-pad\"";' },
        { path: probe, source: "const script = `const os = require(\"os\");`;" },
        { path: probe, source: "// import leftPad from \"left-pad\";\nconst ok = 1;" },
        { path: probe, source: 'import { readFileSync } from "node:fs";\nimport { ok } from "./result";' },
      ]),
    ).toEqual([]);
  });
});


