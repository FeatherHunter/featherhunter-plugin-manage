/**
 * Architecture gate: the capability is self-contained in both directions.
 *
 * The published bundle already proves half of this (it may only import
 * `node:` builtins), but the bundle is generated from source: a source file that
 * imports `../core` would be inlined and the bundle would still look clean. So
 * the rule is checked where it is actually made — in the source tree.
 *
 * Both directions matter:
 * - this directory imports nothing from `src/core` or `src/client`, so a plugin
 *   repository can consume it without the rest of the package;
 * - no other base module imports this directory, so the capability cannot become
 *   a hidden dependency of the package's public surface.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface SourceFile {
  /** Absolute path, as found on disk. */
  readonly path: string;
  readonly source: string;
}

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const RMV_ROOT = resolve(TESTS_DIR, "..");
const SRC_ROOT = resolve(RMV_ROOT, "..");

/** Messages stay comparable across platforms. */
function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** Strip comments before scanning: prose about imports is not an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Every module specifier a file mentions through a form that creates a dependency:
 * static import/export-from, side-effect import, dynamic import, require.
 */
function importedSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specifiers = new Set<string>();
  const patterns: readonly RegExp[] = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

function isUnder(path: string, root: string): boolean {
  const normalized = toPosix(path).replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/, "");
  const normalizedRoot = toPosix(root);
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
}

/** A relative specifier resolved from `file` lands under `root`. */
function resolvesUnder(file: string, specifier: string, root: string): boolean {
  if (!specifier.startsWith(".")) return false;
  return isUnder(resolve(dirname(file), specifier), root);
}

/** Files whose imports reach into one of the forbidden directories. */
function violationsReachingInto(files: readonly SourceFile[], forbiddenRoots: readonly string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const specifier of importedSpecifiers(file.source)) {
      for (const root of forbiddenRoots) {
        if (resolvesUnder(file.path, specifier, root)) {
          violations.push(`${toPosix(file.path)} imports "${specifier}" which resolves under ${toPosix(root)}`);
        }
      }
    }
  }
  return violations;
}

/** Files that name a forbidden directory at all (relative path or package subpath). */
function violationsMentioning(
  files: readonly SourceFile[],
  directory: string,
  needle: string,
): string[] {
  return files.flatMap((file) =>
    importedSpecifiers(file.source)
      .filter((specifier) => specifier.includes(needle) || resolvesUnder(file.path, specifier, directory))
      .map((specifier) => `${toPosix(file.path)} imports "${specifier}"`),
  );
}

function listSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push({ path, source: readFileSync(path, "utf8") });
    }
  }
  return files;
}

/**
 * The gate covers shipped source. The `tests/` directory is excluded because this
 * file embeds import-looking strings as fixtures; its fixtures are what prove the
 * scanner works, and tests are not part of the published bundle.
 */
const RMV_TESTS_ROOT = resolve(RMV_ROOT, "tests");
const RMV_FILES = listSourceFiles(RMV_ROOT).filter((file) => !isUnder(file.path, RMV_TESTS_ROOT));
const BASE_FILES = listSourceFiles(SRC_ROOT).filter((file) => !isUnder(file.path, RMV_ROOT));

describe("self-containment (real source tree)", () => {
  it("scans a non-trivial number of files, so an empty scan cannot pass silently", () => {
    expect(RMV_FILES.length).toBeGreaterThan(15);
    expect(BASE_FILES.length).toBeGreaterThan(5);
  });

  it("does not import base core or client", () => {
    const violations = violationsReachingInto(RMV_FILES, [
      resolve(SRC_ROOT, "core"),
      resolve(SRC_ROOT, "client"),
    ]);
    expect(violations).toEqual([]);
  });

  it("is not imported by any other base module", () => {
    const violations = violationsMentioning(BASE_FILES, RMV_ROOT, "real-machine-verification");
    expect(violations).toEqual([]);
  });
});

describe("self-containment scanner (synthetic fixtures, so the gate has teeth)", () => {
  const probe = resolve(RMV_ROOT, "probe.ts");

  it("flags a relative import that resolves into core or client", () => {
    const files: SourceFile[] = [
      { path: probe, source: 'import { render } from "../core/index";' },
      { path: resolve(RMV_ROOT, "nested/probe.ts"), source: 'export * from "../../client/render";' },
    ];
    expect(violationsReachingInto(files, [resolve(SRC_ROOT, "core"), resolve(SRC_ROOT, "client")])).toHaveLength(2);
  });

  it("flags type-only, dynamic and require forms, not just static imports", () => {
    const files: SourceFile[] = [
      { path: probe, source: 'import type { Model } from "../core/types";' },
      { path: probe, source: 'const m = await import("../client/index.js");' },
      { path: probe, source: 'const m = require("../core/index");' },
    ];
    expect(violationsReachingInto(files, [resolve(SRC_ROOT, "core"), resolve(SRC_ROOT, "client")])).toHaveLength(3);
  });

  it("accepts relative imports that stay inside and node: builtins", () => {
    const files: SourceFile[] = [
      { path: probe, source: 'import { parse } from "./contracts/scenario";\nimport { readFileSync } from "node:fs";' },
      { path: probe, source: 'import "vitest";' },
    ];
    expect(violationsReachingInto(files, [resolve(SRC_ROOT, "core"), resolve(SRC_ROOT, "client")])).toEqual([]);
  });

  it("ignores imports that only appear in comments", () => {
    const files: SourceFile[] = [
      { path: probe, source: '// import { render } from "../core/index";\n/* import { x } from "../client/index"; */\nexport const a = 1;' },
    ];
    expect(violationsReachingInto(files, [resolve(SRC_ROOT, "core"), resolve(SRC_ROOT, "client")])).toEqual([]);
  });

  it("flags another base module that imports the capability", () => {
    const files: SourceFile[] = [
      { path: resolve(SRC_ROOT, "node/probe.ts"), source: 'import { run } from "../real-machine-verification/index";' },
      { path: resolve(SRC_ROOT, "node/probe.ts"), source: 'import type { Ports } from "dsh-featherhunter-plugin-base/real-machine-verification";' },
    ];
    expect(violationsMentioning(files, RMV_ROOT, "real-machine-verification")).toHaveLength(2);
  });
});
