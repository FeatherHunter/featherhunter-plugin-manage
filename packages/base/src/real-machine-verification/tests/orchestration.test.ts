/**
 * The plan → execute → report seam.
 *
 * These tests avoid a real machine entirely: they hand the runner a plan whose
 * checks are literals, and assert the three rules later tickets depend on — the
 * order comes from the plan, a missing optional capability becomes blocked or
 * skip (never fail), and a throwing check still produces a readable result. The
 * reporter is tested here too because its format is a contract a human and a grep
 * both read.
 */
import { describe, expect, it } from "vitest";

import { createRunReport, finishRunReport } from "../contracts/run-state";
import type { CheckResult } from "../contracts/check";
import { createEvidenceStore } from "../evidence/store";
import { prepareRunDirectory } from "../orchestration/run-directory";
import { renderCheckLines, renderSelfCheckHuman } from "../orchestration/report";
import { executePlan } from "../orchestration/runner";
import { planSelfCheck } from "../orchestration/self-check";
import { blocked, checkId, failed, passed, type CheckModule, type CheckPlan } from "../orchestration/types";
import { FakeClock, FakeFs } from "./support/fake-fs";
import { FakeScreen, makePorts } from "./support/fake-ports";
import { buildProfile, customCheckFixture } from "./support/fake-machine";

function planOf(checks: readonly CheckModule<unknown>[]): CheckPlan<unknown> {
  return { command: "self-check", checks };
}

function moduleOf(id: string, run: CheckModule<unknown>["run"], overrides: Partial<CheckModule<unknown>> = {}): CheckModule<unknown> {
  return { id: checkId(id), title: `check ${id}`, hard: true, requires: [], onMissing: "blocked", run, ...overrides };
}

async function runPlan(plan: CheckPlan<unknown>, ports = makePorts({ fs: new FakeFs() })) {
  const clock = new FakeClock();
  return executePlan(plan, {}, { ports, clock });
}

describe("planSelfCheck", () => {
  it("runs the four built-in checks plus the declaration check in report order", () => {
    const plan = planSelfCheck({ profile: buildProfile(), screenRequested: false });
    expect(plan.command).toBe("self-check");
    expect(plan.checks.map((check) => check.id)).toEqual([
      "profile-declaration",
      "dsh-runtime",
      "node-version",
      "profile-present",
      "package-installed",
      "skills-set",
      "model-configured",
      "model-credential",
    ]);
  });

  it("adds the display check only when --screen was requested", () => {
    const without = planSelfCheck({ profile: buildProfile(), screenRequested: false });
    const withScreen = planSelfCheck({ profile: buildProfile(), screenRequested: true });
    expect(without.checks.some((check) => check.id === "screen-present")).toBe(false);
    expect(withScreen.checks.some((check) => check.id === "screen-present")).toBe(true);
  });

  it("appends profile-supplied custom checks and drops duplicates of built-in ids", () => {
    const profile = buildProfile({
      checks: [
        customCheckFixture(() => true, { id: "fixture-a" as never, title: "a" }),
        customCheckFixture(() => true, { id: "profile-present" as never, title: "shadowing" }),
      ],
    });
    const ids = planSelfCheck({ profile, screenRequested: false }).checks.map((check) => check.id);

    const indexOf = (id: string): number => ids.findIndex((candidate) => candidate === id);
    expect(ids).toContain("fixture-a");
    expect(ids.filter((id) => id === "profile-present")).toHaveLength(1);
    expect(indexOf("fixture-a")).toBeGreaterThan(indexOf("package-installed"));
  });
});

describe("executePlan", () => {
  it("reports a missing required capability as blocked, not as a failure", async () => {
    const plan = planOf([moduleOf("browser-demo", () => passed("should not run"), { requires: ["browser"] })]);
    const outcome = await runPlan(plan);

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.status).toBe("blocked");
    expect(outcome.results[0]?.hard).toBe(true);
    expect(outcome.results[0]?.hint).toContain("browser");
  });

  it("reports a missing capability as skip when the plan says so", async () => {
    const plan = planOf([
      moduleOf("optional-demo", () => passed("should not run"), { requires: ["browser"], onMissing: "skip" }),
    ]);
    const outcome = await runPlan(plan);
    expect(outcome.results[0]?.status).toBe("skip");
  });

  it("runs a gated check when an explicit capability override says the adapter exists", async () => {
    const plan = planOf([moduleOf("browser-demo", () => passed("ran"), { requires: ["browser"] })]);
    const ports = makePorts({ fs: new FakeFs() });
    const outcome = await executePlan(plan, {}, { ports, clock: new FakeClock(), capabilities: { browser: true } });
    expect(outcome.results[0]?.status).toBe("pass");
  });

  it("keeps plan order and stops at nothing: every check produces a result", async () => {
    const plan = planOf([
      moduleOf("first", () => passed("one")),
      moduleOf("second", () => failed("two", "expected two", "got two", "fix two")),
      moduleOf("third", () => blocked("three", "install three")),
    ]);
    const outcome = await runPlan(plan);
    expect(outcome.results.map((result) => result.id)).toEqual(["first", "second", "third"]);
    expect(outcome.results.map((result) => result.status)).toEqual(["pass", "fail", "blocked"]);
    expect(outcome.steps).toEqual([]);
  });

  it("turns a throwing check into a fail with expected, actual and hint", async () => {
    const plan = planOf([
      moduleOf("explodes", () => {
        throw new Error("the adapter is undefined");
      }),
    ]);
    const outcome = await runPlan(plan);
    const result = outcome.results[0];
    expect(result?.status).toBe("fail");
    expect(result?.actual).toContain("the adapter is undefined");
    expect(result?.expected).toBeTypeOf("string");
    expect(result?.hint).toBeTypeOf("string");
  });

  it("measures duration with the injected clock", async () => {
    const clock = new FakeClock();
    const plan = planOf([
      moduleOf("slow", async () => {
        clock.advance(42);
        return passed("done");
      }),
    ]);
    const outcome = await executePlan(plan, {}, { ports: makePorts({ fs: new FakeFs() }), clock });
    expect(outcome.results[0]?.durationMs).toBe(42);
  });
});

describe("human report format", () => {
  function result(overrides: Partial<CheckResult>): CheckResult {
    return {
      id: checkId("dsh-runtime"),
      title: "the DSH install is complete",
      hard: true,
      status: "pass",
      detail: "found it",
      evidence: [],
      durationMs: 0,
      ...overrides,
    };
  }

  it("renders pass, skip and blocked lines as one status word plus id and detail", () => {
    expect(renderCheckLines(result({ status: "pass", detail: "found DSH" }))[0]).toBe("ok dsh-runtime found DSH");
    expect(renderCheckLines(result({ status: "skip", detail: "not requested" }))[0]).toBe(
      "skip dsh-runtime not requested",
    );
    expect(renderCheckLines(result({ status: "blocked", detail: "missing", hint: "install it" }))).toEqual([
      "blocked dsh-runtime missing",
      "  hint:     install it",
    ]);
  });

  it("renders a fail line with the expected/actual/hint lines under it", () => {
    const lines = renderCheckLines(
      result({ status: "fail", detail: "versions differ", expected: "1.2.3", actual: "1.2.2", hint: "reinstall" }),
    );
    expect(lines[0]).toMatch(/^fail dsh-runtime /);
    expect(lines[1]).toMatch(/^ {2}expected: 1\.2\.3$/);
    expect(lines[2]).toMatch(/^ {2}actual: {3}1\.2\.2$/);
    expect(lines[3]).toMatch(/^ {2}hint: {5}reinstall$/);
  });

  it("prints the report path, its digest and the evidence directory at the end", () => {
    const report = finishRunReport(createRunReport({ command: "self-check", profile: "web", startedAt: "t0" }), {
      checks: [result({ status: "pass" })],
      steps: [],
      finishedAt: "t1",
    });
    const text = renderSelfCheckHuman(report, {
      reportPath: "C:\\Temp\\verify-work\\runs\\run-1\\run.json",
      reportSha256: "a".repeat(64) as never,
      evidenceDir: "C:\\Temp\\verify-work\\runs\\run-1\\evidence",
      evidenceCount: 2,
    });

    expect(text).toContain("report: C:\\Temp\\verify-work\\runs\\run-1\\run.json");
    expect(text).toContain(`report-sha256: ${"a".repeat(64)}`);
    expect(text).toContain("evidence: C:\\Temp\\verify-work\\runs\\run-1\\evidence (2 item(s))");
  });
});

describe("run directories", () => {
  it("never reuses a run id: a second run in the same millisecond gets -2", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    const options = { fs, workRoot: "C:\\Temp\\verify-work", command: "self-check", startedAt: "2026-11-01T21:00:00.000+08:00" };

    const first = await prepareRunDirectory(options);
    const second = await prepareRunDirectory(options);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.runId).toBe("self-check-2026-11-01T21-00-00-000-08-00");
    expect(second.value.runId).toBe(`${first.value.runId}-2`);
    expect(second.value.evidenceDir).toContain("evidence");
  });

  it("creates the evidence store under the run directory on first write", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    const store = createEvidenceStore({ fs, root: "C:\\Temp\\verify-work\\runs\\r\\evidence", clock: new FakeClock() });
    const written = await store.recordText("environment", "cwd: fixture-repo\n");
    expect(written.ok).toBe(true);
    expect(fs.readFileSync("C:\\Temp\\verify-work\\runs\\r\\evidence\\environment.txt")).toContain("fixture-repo");
  });
});

describe("screen fixture sanity", () => {
  it("a fake screen returns a display and an error when asked", async () => {
    const good = await new FakeScreen().screens();
    expect(good.ok && good.value).toHaveLength(1);
    const bad = await new FakeScreen({ ok: false, error: { code: "unsupported", message: "no display" } }).screens();
    expect(bad.ok).toBe(false);
  });
});
