/**
 * CI gate contract (ticket 04).
 *
 * The workflow is a configuration artifact, so its contract is asserted at the
 * file level: triggers, the single gate entry point, Node version parity with
 * the publish workflow, and the absence of everything the spec forbids
 * (per-step gate commands, five-repo paths, release secrets).
 *
 * No YAML parser is used on purpose: these are text assertions over the same
 * bytes a reviewer reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./support/ops-fixtures";

const WORKFLOW_DIR = join(REPO_ROOT, ".github", "workflows");
const CI_PATH = join(WORKFLOW_DIR, "ci.yml");
const PUBLISH_PATH = join(WORKFLOW_DIR, "publish-base.yml");
const GATE_ENTRY = join(REPO_ROOT, "scripts", "ops", "base-verify.mjs");
const GATE_COMMAND = "node scripts/ops/base-verify.mjs --json";

function readText(path: string): string {
  expect(existsSync(path), "missing file: " + path).toBe(true);
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

/** The lines of a top-level YAML key: the key itself plus its indented block. */
function topLevelBlock(text: string, key: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp("^" + key + ":\\s*(#.*)?$").test(line));
  expect(start, "workflow has no top-level '" + key + ":' key").toBeGreaterThanOrEqual(0);
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() !== "" && !/^\s/.test(line)) break;
    block.push(line);
  }
  return block;
}

/** node-version from a workflow, without the surrounding quotes. */
function nodeVersion(text: string): string {
  const match = /^\s*node-version:\s*["']?([^"'\s#]+)["']?/m.exec(text);
  expect(match, "workflow has no node-version").not.toBeNull();
  return (match as RegExpExecArray)[1];
}

/** Single-line run: scalars, i.e. every shell command the workflow executes. */
function runCommands(text: string): string[] {
  return text
    .split("\n")
    .map((line) => /^\s*-?\s*run:\s*(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1].replace(/^["']|["']$/g, ""));
}

describe("CI workflow contract", () => {
  it("exists and runs on both push and pull_request", () => {
    const ci = readText(CI_PATH);
    const triggers = topLevelBlock(ci, "on").join("\n");
    expect(triggers, "CI must run on push").toMatch(/^\s+push:\s*($|#)/m);
    expect(triggers, "CI must run on pull_request").toMatch(/^\s+pull_request:\s*($|#)/m);
    expect(ci).toMatch(/^\s*runs-on:\s*ubuntu-latest\s*$/m);
  });

  it("calls the same gate entry point that maintainers run locally", () => {
    const ci = readText(CI_PATH);
    expect(existsSync(GATE_ENTRY), "local gate entry is missing: " + GATE_ENTRY).toBe(true);
    expect(runCommands(ci), "workflow must run: " + GATE_COMMAND).toContain(GATE_COMMAND);
    expect(ci).toContain("scripts/ops/base-verify.mjs");
  });

  it("pins the same Node version as the publish workflow", () => {
    const ci = readText(CI_PATH);
    const publish = readText(PUBLISH_PATH);
    expect(nodeVersion(ci), "Node version drifted from the publish workflow").toBe(nodeVersion(publish));
  });

  it("runs on Node 22", () => {
    expect(nodeVersion(readText(CI_PATH))).toBe("22");
  });

  it("installs the package with npm ci and caches the package lockfile", () => {
    const ci = readText(CI_PATH);
    expect(runCommands(ci), "workflow must install with npm ci").toContain("npm ci");
    expect(ci, "setup-node must cache npm").toMatch(/^\s*cache:\s*npm\s*$/m);
    expect(ci, "cache must key on the package lockfile").toMatch(
      /^\s*cache-dependency-path:\s*packages\/base\/package-lock\.json\s*$/m,
    );
    expect(ci, "npm ci must run inside packages/base").toMatch(/^\s*working-directory:\s*packages\/base\s*$/m);
    expect(existsSync(join(REPO_ROOT, "packages", "base", "package-lock.json")), "package lockfile is missing").toBe(true);
  });

  it("does not restate the gate as individual npm commands", () => {
    const ci = readText(CI_PATH);
    const forbidden: Array<[string, RegExp]> = [
      ["npm run typecheck", /npm\s+run\s+typecheck\b/],
      ["npm test", /npm\s+(run\s+)?test\b/],
      ["npm run build", /npm\s+run\s+build\b/],
      ["npm run docs:check", /npm\s+run\s+docs:check\b/],
    ];
    for (const [label, pattern] of forbidden) {
      expect(ci, "workflow must not run " + label + " directly").not.toMatch(pattern);
    }
    expect(ci, "workflow must not call vitest directly").not.toMatch(/\bvitest\b/);
  });

  it("runs nothing besides npm ci and the gate entry", () => {
    const unexpected = runCommands(readText(CI_PATH)).filter(
      (command) => command !== "npm ci" && !/^node\s+scripts\/ops\/base-verify\.mjs(\s|$)/.test(command),
    );
    expect(unexpected, "unexpected workflow commands: " + unexpected.join(" | ")).toEqual([]);
  });

  it("does not reference the five consumer repos or machine-local paths", () => {
    const ci = readText(CI_PATH);
    const forbidden: Array<[string, RegExp]> = [
      ["dsh-prompt", /dsh-prompt/i],
      ["palette", /palette/i],
      ["dsh-im", /\bdsh-im\b/i],
      ["ilife", /\bilife\b/i],
      ["matt", /\bmatt\b/i],
      ["a D:/dsh-plugin checkout", /dsh-plugin/i],
      ["a Windows drive path", /(?:^|[\s"'(])[A-Za-z]:[\\/]/m],
    ];
    for (const [label, pattern] of forbidden) {
      expect(ci, "workflow must not reference " + label).not.toMatch(pattern);
    }
  });

  it("needs no release secrets and fails the job by default", () => {
    const ci = readText(CI_PATH);
    expect(ci, "CI must not read repository secrets").not.toMatch(/\bsecrets\./);
    expect(ci, "CI must not use the publish token").not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(ci, "gate failures must turn the job red").not.toMatch(/continue-on-error/);
    expect(ci, "gate failures must not be swallowed").not.toMatch(/\|\|\s*true\b/);
  });
});
