/**
 * The two post-build contracts are the guarantee that makes this package safe to
 * inline: a plugin can paste `client/index` into its host, and a node bundle can
 * never drag a dependency into another plugin's process.
 *
 * These are the same checks the build runs, exercised as a pure function: a red
 * build must be caused by a specific rule, not by "esbuild happened to fail".
 */
import { describe, expect, it } from "vitest";

import {
  assertBundleContract,
  checkBundleContract,
  externalSpecifiers,
} from "../scripts/bundle-contract";

describe("self-contained bundles", () => {
  it("accepts a bundle that references nothing outside itself", () => {
    const source = "var answer = 42;\nexport { answer };\n";
    expect(checkBundleContract("client/index", source, "self-contained")).toEqual([]);
  });

  it("rejects a surviving static import", () => {
    const violations = checkBundleContract("client/index", 'import { x } from "left-pad";\n', "self-contained");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe("client/index must stay self-contained; found static import");
  });

  it("rejects require()", () => {
    const violations = checkBundleContract("client/index", 'var x = require("left-pad");\n', "self-contained");
    expect(violations.map((violation) => violation.message)).toEqual([
      "client/index must stay self-contained; found require()",
    ]);
  });

  it("rejects a dynamic import()", () => {
    const violations = checkBundleContract("client/index", 'var p = import("left-pad");\n', "self-contained");
    expect(violations.some((violation) => violation.message.includes("dynamic import()"))).toBe(true);
  });

  it("reports every broken rule, not just the first", () => {
    const source = 'import "a";\nvar b = require("b");\nvar c = import("c");\n';
    const violations = checkBundleContract("client/index", source, "self-contained");
    expect(violations.map((violation) => violation.message)).toEqual([
      "client/index must stay self-contained; found static import",
      "client/index must stay self-contained; found require()",
      "client/index must stay self-contained; found dynamic import()",
    ]);
  });

  it("throws a message that names the bundle and the broken rule", () => {
    expect(() => assertBundleContract("client/index", 'import "left-pad";', "self-contained")).toThrow(
      /client\/index must stay self-contained; found static import/,
    );
  });
});

describe("node-platform bundles", () => {
  it("accepts node: builtins and relative imports", () => {
    const source = 'import { readFileSync } from "node:fs";\nimport { local } from "./local.js";\nexport { readFileSync, local };\n';
    expect(checkBundleContract("node/index", source, "node-builtins")).toEqual([]);
  });

  it("rejects a third-party static import", () => {
    const violations = checkBundleContract("node/index", 'import leftPad from "left-pad";\n', "node-builtins");
    expect(violations.map((violation) => violation.message)).toEqual([
      'node/index imports "left-pad" — node-platform bundles may only import node: builtins',
    ]);
  });

  it("rejects a side-effect import of a package", () => {
    const violations = checkBundleContract("node/cli", 'import "left-pad";\n', "node-builtins");
    expect(violations.map((violation) => violation.message)).toEqual([
      'node/cli imports "left-pad" — node-platform bundles may only import node: builtins',
    ]);
  });

  it("rejects a re-export from a package", () => {
    const violations = checkBundleContract("node/index", 'export { default } from "left-pad";\n', "node-builtins");
    expect(violations).toHaveLength(1);
  });

  it("throws a message that names the bundle and the offending specifier", () => {
    expect(() => assertBundleContract("node/index", 'import "fs";', "node-builtins")).toThrow(
      /node\/index imports "fs" — node-platform bundles may only import node: builtins/,
    );
  });
});

describe("externalSpecifiers", () => {
  it("returns only the non-relative specifiers a bundle imports or re-exports", () => {
    const source = [
      'import { a } from "node:path";',
      'import { b } from "./b.js";',
      'import "side-effect-package";',
      'export { c } from "another-package";',
    ].join("\n");
    // Order is not contractual (a Set over two scan passes); uniqueness and membership are.
    expect(externalSpecifiers(source).sort()).toEqual(["another-package", "node:path", "side-effect-package"]);
  });
});
