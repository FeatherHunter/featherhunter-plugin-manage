/**
 * Documentation contract for AGENTS.md (ticket 06).
 *
 * AGENTS.md is the entry point for agents: it must route "change the
 * real-machine-verification code" to the authoritative documents and sections,
 * state the base-only boundary, and pin the four working rules. Every pointer
 * is resolved against the document it names, so renaming a section breaks this
 * test instead of silently rotting the navigation.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./support/ops-fixtures";

const AGENTS_PATH = join(REPO_ROOT, "AGENTS.md");

const NAV_HEADING = "## 导航：改真机验证代码先读什么";
const BOUNDARY_HEADING = "## 边界：只建设 base";

interface Pointer {
  /** Repo-relative path of the document the pointer names. */
  path: string;
  /** Exact heading that must exist in that document. */
  heading: string;
}

const POINTERS: readonly Pointer[] = [
  { path: "packages/base/src/real-machine-verification/DESIGN.md", heading: "## 10. CLI 表面" },
  { path: "packages/base/src/real-machine-verification/DESIGN.md", heading: "## 11. 证据与身份链" },
  { path: "docs/adr/0002-real-machine-verification-as-built.md", heading: "## 决定" },
  {
    path: "packages/base/src/real-machine-verification/AGENTS-USAGE.md",
    heading: "## 3. 证据与身份：先冻、再绑、再归档",
  },
];

function readRepoFile(relPath: string): string {
  const abs = join(REPO_ROOT, relPath);
  expect(existsSync(abs), "missing document: " + relPath).toBe(true);
  return readFileSync(abs, "utf8");
}

function splitLines(markdown: string): string[] {
  return markdown.split(/\r?\n/);
}

/** True when the exact heading line exists in the document. */
function hasHeadingLine(markdown: string, heading: string): boolean {
  return splitLines(markdown).some((line) => line.trim() === heading);
}

/**
 * Body of the section that starts at the exact heading, up to the next heading
 * of the same or a higher level (### inside ## stays in the body).
 */
function sectionBody(markdown: string, heading: string): string {
  const lines = splitLines(markdown);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return "";
  const level = (heading.match(/^#+/) ?? [""])[0].length;
  const body: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    const next = /^(#+)\s/.exec(lines[i].trim());
    if (next && next[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

const agentsDoc = existsSync(AGENTS_PATH) ? readFileSync(AGENTS_PATH, "utf8") : "";

describe("AGENTS.md navigation, boundary and working rules", () => {
  it("keeps the existing Agent skills section intact", () => {
    for (const heading of ["## Agent skills", "### Issue tracker", "### Triage labels", "### Domain docs"]) {
      expect(hasHeadingLine(agentsDoc, heading), "lost existing heading: " + heading).toBe(true);
    }
    expect(agentsDoc).toContain("docs/agents/issue-tracker.md");
    expect(agentsDoc).toContain("docs/agents/triage-labels.md");
    expect(agentsDoc).toContain("docs/agents/domain.md");
  });

  it("has the navigation section mapping real-machine-verification changes to documents", () => {
    expect(hasHeadingLine(agentsDoc, NAV_HEADING), "missing navigation heading").toBe(true);
    const nav = sectionBody(agentsDoc, NAV_HEADING);
    expect(nav.length, "navigation section is empty").toBeGreaterThan(0);
    for (const pointer of POINTERS) {
      expect(nav, "navigation does not name " + pointer.path).toContain(pointer.path);
      expect(nav, "navigation does not name " + pointer.heading).toContain(pointer.heading);
    }
  });

  it("points only at sections that really exist in the target documents", () => {
    for (const pointer of POINTERS) {
      const target = readRepoFile(pointer.path);
      expect(
        hasHeadingLine(target, pointer.heading),
        pointer.path + " no longer has the heading " + JSON.stringify(pointer.heading),
      ).toBe(true);
    }
  });

  it("states the base-only boundary and the self-service contract of the five repos", () => {
    expect(hasHeadingLine(agentsDoc, BOUNDARY_HEADING), "missing boundary heading").toBe(true);
    const boundary = sectionBody(agentsDoc, BOUNDARY_HEADING);
    for (const claim of ["只建设 base", "发布包", "README", "AGENTS-USAGE", "不代跑五仓", "不向五仓安装"]) {
      expect(boundary, "boundary section does not state: " + claim).toContain(claim);
    }
  });

  it("pins the four working rules as fixed headings with content", () => {
    const rules: ReadonlyArray<readonly [string, string]> = [
      ["### 等待规则", "等待"],
      ["### 长任务规则", "90 秒"],
      ["### 多步操作规则", "三步以上"],
      ["### 证据规则", "结构化 JSON"],
    ];
    for (const [heading, keyword] of rules) {
      expect(hasHeadingLine(agentsDoc, heading), "missing rule heading: " + heading).toBe(true);
      const body = sectionBody(agentsDoc, heading);
      expect(body.length, "empty rule: " + heading).toBeGreaterThan(heading.length);
      expect(body, heading + " does not mention " + keyword).toContain(keyword);
    }
  });
});
