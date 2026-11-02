/**
 * Contract for the post-publish tarball verification step (ticket 05).
 *
 * The publish workflow must run the *same* verification entry point that a
 * maintainer runs locally (scripts/ops/base-release.mjs --skip-publish), after
 * npm publish, with the version read from the package manifest, and must not
 * offer any way to skip it. Every assertion below is a file-level contract:
 * step order, the exact command surface, env exposure and artifact retention.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./support/ops-fixtures";

const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "publish-base.yml");
const VERIFY_SCRIPT = "scripts/ops/base-release.mjs";
const EVIDENCE_JSON = "base-release-verify.json";

interface WorkflowStep {
  name: string;
  /** Every line of the step body after its `- name:` line. */
  body: string;
}

interface Workflow {
  text: string;
  publishJob: string;
  steps: WorkflowStep[];
}

/** The `  <job>:` block of the `jobs:` mapping (this workflow declares no nested job keys). */
function jobBlock(text: string, job: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf("  " + job + ":");
  if (start < 0) throw new Error("workflow has no job " + job);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Split a job block into its steps: `      - name:` starts one, the next one or a shallower line ends it. */
function parseSteps(job: string): WorkflowStep[] {
  const lines = job.split("\n");
  const out: WorkflowStep[] = [];
  let name: string | null = null;
  let body: string[] = [];
  const flush = (): void => {
    if (name !== null) out.push({ name, body: body.join("\n") });
    name = null;
    body = [];
  };
  for (const line of lines) {
    const start = /^ {6}- name:\s*(.+?)\s*$/.exec(line);
    if (start) {
      flush();
      name = start[1].replace(/^["']|["']$/g, "");
      continue;
    }
    if (name === null) continue;
    if (line.trim() !== "" && !/^ {6}/.test(line)) {
      flush();
      continue;
    }
    body.push(line);
  }
  flush();
  return out;
}

function loadWorkflow(): Workflow {
  const text = readFileSync(WORKFLOW_PATH, "utf8").replace(/\r\n/g, "\n");
  const publishJob = jobBlock(text, "publish");
  return { text, publishJob, steps: parseSteps(publishJob) };
}

/** Input names declared under the workflow_dispatch trigger. */
function declaredInputs(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^ {4}inputs:\s*$/.test(line));
  if (start < 0) return [];
  const names: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (!/^ {6}/.test(line)) break;
    const match = /^ {6}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

const workflow = loadWorkflow();

function stepIndex(predicate: (step: WorkflowStep) => boolean): number {
  return workflow.steps.findIndex(predicate);
}

function stepAt(index: number, what: string): WorkflowStep {
  expect(index, "workflow has no " + what + " step").toBeGreaterThanOrEqual(0);
  return workflow.steps[index];
}

const publishIndex = stepIndex((step) => /(^|\s)npm publish(\s|$)/m.test(step.body));
const verifyIndex = stepIndex((step) => step.body.includes(VERIFY_SCRIPT) && step.body.includes("--skip-publish"));

describe("publish-base workflow verifies the published tarball", () => {
  it("runs the shared verification entry point after npm publish", () => {
    const publish = stepAt(publishIndex, "npm publish");
    const verify = stepAt(verifyIndex, "tarball verification");

    expect(publish.name, "npm publish step").toMatch(/publish/i);
    expect(verifyIndex, "verification must run after npm publish (publish at " + publishIndex + ")").toBeGreaterThan(publishIndex);
    expect(verify.body).toContain("node " + VERIFY_SCRIPT);
    expect(verify.body).toContain("--skip-publish");
    expect(verify.body).toContain("--registry https://registry.npmjs.org");
    expect(verify.body).toContain("--commit HEAD");
  });

  it("takes the version from packages/base/package.json instead of hardcoding it", () => {
    const verify = stepAt(verifyIndex, "tarball verification");

    expect(verify.body).toContain("packages/base/package.json");
    expect(verify.body, "version must be resolved at run time").toMatch(/node\s+-p\b/);
    expect(verify.body, "the resolved version must reach --version").toMatch(/--version\s+"?\$/);
    expect(verify.body, "no literal version may be passed to --version").not.toMatch(/--version\s+v?\d+\.\d+\.\d+/);
  });

  it("runs from the repository root (the job default is packages/base) with an explicit timeout", () => {
    const verify = stepAt(verifyIndex, "tarball verification");

    expect(verify.body, "verification must override the packages/base default cwd").toMatch(/^ {8}working-directory:\s*\.\s*$/m);
    const timeout = /^ {8}timeout-minutes:\s*(\d+)\s*$/m.exec(verify.body);
    expect(timeout, "the verification step needs an explicit timeout-minutes").not.toBeNull();
    expect(Number(timeout![1]), "registry propagation needs a generous timeout").toBeGreaterThanOrEqual(10);
  });

  it("has no input, switch or condition that can skip verification", () => {
    const verify = stepAt(verifyIndex, "tarball verification");

    expect(declaredInputs(workflow.text), "only the existing dist-tag input may exist").toEqual(["tag"]);
    expect(workflow.text, "no condition may gate on workflow inputs").not.toMatch(/if:\s*inputs\./);
    expect(workflow.text, "no step may be allowed to fail quietly").not.toMatch(/continue-on-error/);
    expect(verify.body, "the verification step must be unconditional").not.toMatch(/^ {8}if:\s*\S/m);
    expect(verify.body, "verification failure must fail the job").not.toMatch(/\|\|\s*true/);
  });

  it("does not expose the publish token to the verification step", () => {
    const verify = stepAt(verifyIndex, "tarball verification");
    const tokenSteps = workflow.steps
      .map((step, index) => (step.body.includes("NODE_AUTH_TOKEN") ? index : -1))
      .filter((index) => index >= 0);

    expect(tokenSteps, "NODE_AUTH_TOKEN belongs only to the npm publish step").toEqual([publishIndex]);
    expect(verify.body).not.toContain("NODE_AUTH_TOKEN");
    expect(verify.body).not.toContain("secrets.");
  });

  it("writes the verification JSON under RUNNER_TEMP and keeps it as an artifact", () => {
    const verify = stepAt(verifyIndex, "tarball verification");
    const uploadIndex = stepIndex((step) => step.body.includes("actions/upload-artifact"));

    expect(verify.body).toContain("--json");
    expect(verify.body, "evidence must go to the runner temp dir").toMatch(/\$RUNNER_TEMP|\$\{RUNNER_TEMP\}/);
    expect(verify.body).toContain(EVIDENCE_JSON);

    expect(uploadIndex, "the evidence JSON must be uploaded").toBeGreaterThan(verifyIndex);
    const upload = workflow.steps[uploadIndex];
    expect(upload.body).toMatch(/\$\{\{\s*runner\.temp\s*\}\}|\$RUNNER_TEMP/);
    expect(upload.body).toContain(EVIDENCE_JSON);
    expect(upload.body, "evidence must survive a failed verification").toMatch(/^ {8}if:\s*always\(\)\s*$/m);
  });

  it("keeps the release toolchain the workflow already uses", () => {
    expect(workflow.publishJob).toMatch(/node-version:\s*"22"/);
    expect(workflow.publishJob).toContain("actions/checkout@v4");
    expect(workflow.publishJob).toContain("actions/setup-node@v4");
  });
});
