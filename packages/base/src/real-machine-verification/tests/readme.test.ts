/**
 * The README is the document the adopting repository actually follows, so its
 * first sections are asserted like an interface: the five steps in order (install,
 * declaration, two npm scripts, run, read), the exact declaration template the
 * loader looks for, and a command line that matches `describe` rather than a
 * memory of it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { describeCapability } from "../capability-description";
import { DECLARATION_TEMPLATE } from "../declaration/loader";

const README = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");

const SELF_CHECK_CHECKS = [
  "profile-declaration",
  "dsh-runtime",
  "node-version",
  "profile-present",
  "package-installed",
  "skills-set",
  "model-configured",
  "model-credential",
  "screen-present",
] as const;

describe("README: the five-step entry", () => {
  it("starts from install, then declaration, then scripts, then the command, then the report", () => {
    const headings = ["第一步：安装", "第二步：写", "第三步：把两条命令写进", "第四步：运行", "第五步：读报告"];
    const indexes = headings.map((heading) => README.indexOf(heading));
    for (const index of indexes) expect(index).toBeGreaterThanOrEqual(0);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(README.indexOf("npm install --save-dev dsh-featherhunter-plugin-base")).toBeGreaterThan(
      indexes[0] ?? 0,
    );
    expect(README.indexOf("npm install --save-dev dsh-featherhunter-plugin-base")).toBeLessThan(indexes[1] ?? 0);
  });

  it("documents the two scripts and the 0-1 line packaging whitelist", () => {
    expect(README).toContain("npm run verify");
    expect(README).toContain('"verify:json"');
    expect(README).toContain("self-check --json");
    expect(README).toContain(".npmignore");
    expect(README).toContain("verify/");
    expect(README).toContain("files");
  });

  it("carries the exact declaration template the loader accepts", () => {
    expect(README).toContain(DECLARATION_TEMPLATE);
    expect(README).toContain("dsh-featherhunter-plugin-base/real-machine-verification");
    expect(README).toContain("defineVerificationProfile");
  });

  it("documents a command that matches describe", () => {
    const selfCheck = describeCapability().commands.find((command) => command.name === "self-check");
    expect(selfCheck).toBeDefined();
    expect(README).toContain(selfCheck?.usage ?? "");
    // The README must not promise that npx fails closed: a bare npx (and even
    // npx --no-install) can silently reuse a same-named package from the npx
    // cache. The documented interface is therefore the one that cannot hit it,
    // guarded by the --version capability fingerprint.
    expect(README).toContain("node_modules/.bin/dsh-verify --version");
    expect(README).toContain("capability real-machine-verification (schema 1)");
    expect(README).toContain("dsh-verify@0.9.6");
    expect(README).not.toContain("npx --no-install dsh-verify self-check");
    expect(README).toContain(
      "node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js self-check",
    );
    expect(README).toContain("node dist/real-machine-verification/cli/main.js self-check");
  });

  it("explains the report: human lines, --json, exit codes and the work root", () => {
    expect(README).toContain("ok|fail|skip|blocked");
    expect(README).toContain("--json");
    expect(README).toContain("run.json");
    expect(README).toContain(".scratch/verify");
    expect(README).toMatch(/退出码[\s\S]*?`0`[\s\S]*?`1`[\s\S]*?`2`/);
    expect(README).toContain("blocked");
  });

  it("names every check that self-check can report", () => {
    for (const id of SELF_CHECK_CHECKS) expect(README).toContain(id);
  });
});
