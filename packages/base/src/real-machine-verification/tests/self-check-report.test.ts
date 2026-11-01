/**
 * Report-level contracts of `dsh-verify self-check`: stream separation, exit
 * codes, evidence naming, report hashing and secret hygiene.
 *
 * These are asserted through the in-process CLI with the fake machine — no real
 * home, no real desktop app, no network — because the contracts belong to the CLI,
 * not to one machine's state.
 */
import { describe, expect, it } from "vitest";

import { main } from "../cli/main";
import { sha256Text } from "../contracts/identity";
import { ok } from "../contracts/result";
import type { RunReport } from "../contracts/run-state";
import { loadVerificationDeclaration } from "../declaration/loader";
import type { SelfCheckContext } from "../orchestration/self-check";
import { captureIo } from "./support/fake-capture";
import {
  buildProfile,
  createFixture,
  customCheckFixture,
  declarationLoader,
  fakeDeclarationImport,
  fixtureDeclaration,
  fakePath,
  readEvidenceText,
  readRunDirectory,
} from "./support/fake-machine";
import type { DeclarationLoadResult } from "../declaration/loader";
import type { Fixture } from "./support/fake-machine";

interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly report: RunReport;
}

async function runCli(
  fixture: Fixture,
  argv: readonly string[] = [],
  loadDeclaration?: (options: Parameters<typeof loadVerificationDeclaration>[0]) => Promise<DeclarationLoadResult>,
): Promise<CliRun> {
  const capture = captureIo();
  const loader = loadDeclaration ?? declarationLoader(ok(fixtureDeclaration(fixture)));
  const code = await main(["self-check", "--work-root", fixture.paths.workRoot, ...argv], {
    ports: fixture.ports,
    io: capture.io,
    runtime: fixture.runtime,
    loadDeclaration: loader,
  });
  const stdout = capture.stdout();
  const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);
  const report = argv.includes("--json") ? (JSON.parse(stdout) as RunReport) : (JSON.parse(run.content) as RunReport);
  return { code, stdout, stderr: capture.stderr(), report };
}

function evidenceText(fixture: Fixture): string {
  return readEvidenceText(fixture.fs, fixture.paths.workRoot);
}

describe("self-check: --json output contract", () => {
  it("prints exactly one JSON document on stdout and the human rendering on stderr", async () => {
    const fixture = createFixture();
    const result = await runCli(fixture, ["--json"]);

    // stdout is one JSON document and nothing else.
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);
    expect(result.stdout.trimEnd().endsWith("}")).toBe(true);
    expect(result.stdout).not.toContain("ok profile-declaration ");
    expect(result.stdout).not.toContain("report-sha256: ");

    // stderr carries the shared human rendering plus the verdict line.
    expect(result.stderr).toMatch(/^ok profile-declaration .+$/m);
    expect(result.stderr).toMatch(/^report: .+$/m);
    expect(result.stderr).toMatch(/^report-sha256: [0-9a-f]{64}$/m);
    expect(result.stderr).toMatch(/^passed \(5 pass, 0 fail, 3 skip, 0 blocked\)$/m);

    // The printed digest names the bytes that were written to disk.
    const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    expect(fakePath(result.report.artifacts?.["report"] ?? "")).toBe(`${run.runDir}/run.json`);
    expect(result.report.artifacts?.["reportSha256"]).toBe(run.sha256);
    expect(result.code).toBe(0);
  });

  it("maps the three outcomes to exit codes 0, 1 and 2", async () => {
    const green = await runCli(createFixture(), ["--json"]);
    expect(green.code).toBe(0);
    expect(green.report.exitCode).toBe(0);

    const failing = await runCli(createFixture({ nodeVersion: "20.11.0" }), ["--json"]);
    expect(failing.code).toBe(1);
    expect(failing.report.exitCode).toBe(1);
    expect(failing.report.checks.some((check) => check.status === "fail")).toBe(true);

    const blocked = await runCli(createFixture({ dshPresent: false }), ["--json"]);
    expect(blocked.code).toBe(2);
    expect(blocked.report.exitCode).toBe(2);
    expect(blocked.report.checks.some((check) => check.status === "blocked")).toBe(true);
  });
});

describe("self-check: report artifacts", () => {
  it("keeps the human tail's report hash verifiable against run.json", async () => {
    const fixture = createFixture();
    const result = await runCli(fixture);
    const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);

    const printed = /^report-sha256: ([0-9a-f]{64})$/m.exec(result.stdout)?.[1];
    expect(printed).toBeDefined();
    expect(printed).toBe(run.sha256);
    expect(printed).toBe(sha256Text(run.content));
  });

  it("numbers same-named evidence files instead of overwriting them", async () => {
    const fixture = createFixture({
      profileOverrides: {
        checks: [
          customCheckFixture(
            async (context) => {
              const selfCheck = context as SelfCheckContext;
              await selfCheck.evidence.recordJson("same-name", { attempt: 1 });
              await selfCheck.evidence.recordJson("same-name", { attempt: 2 });
              return true;
            },
            { id: "fixture-evidence" as never, title: "writes evidence twice", hard: false },
          ),
        ],
      },
    });

    const result = await runCli(fixture, ["--json"]);
    expect(result.code).toBe(0);

    const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    const evidenceDir = run.runDir.replace(/\\/g, "/") + "/evidence";
    const saved = fixture.fs.children(evidenceDir);
    const first = saved.find((file) => file.endsWith("same-name.json"));
    const second = saved.find((file) => file.endsWith("same-name-2.json"));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(fixture.fs.readFileSync(first)).not.toBe(fixture.fs.readFileSync(second));
    expect(JSON.parse(fixture.fs.readFileSync(second))).toEqual({ attempt: 2 });
  });

  it("gives a second run in the same work root its own numbered directory", async () => {
    const fixture = createFixture();
    const runOnce = async (): Promise<number> => {
      const capture = captureIo();
      return main(["self-check", "--work-root", fixture.paths.workRoot], {
        ports: fixture.ports,
        io: capture.io,
        runtime: fixture.runtime,
        loadDeclaration: declarationLoader(ok(fixtureDeclaration(fixture))),
      });
    };

    expect(await runOnce()).toBe(0);
    expect(await runOnce()).toBe(0);

    const runs = fixture.fs.children(`${fixture.paths.workRoot}/runs`);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatch(/-2$/);
    for (const runDir of runs) {
      const names = fixture.fs.children(runDir).map((path) => path.split("/").pop());
      expect(names).toEqual(expect.arrayContaining(["run.json", "run.json.sha256"]));
    }
  });

  it("never writes a credential value into the report, evidence or human output", async () => {
    const secret = "sk-secret-canary-123";
    const fixture = createFixture({
      envValues: { MINIMAX_API_KEY: secret },
      profileOverrides: {
        model: { provider: "minimax", model: "fixture-model", apiKeyEnv: "MINIMAX_API_KEY" },
      },
    });

    // The credential check resolves the reference from the process environment;
    // the model-configuration check needs the profile's patch layer to match the
    // declaration, so seed a consistent patch. This test is about secret hygiene,
    // not about model-configuration detection (that has its own tests).
    fixture.fs.seedFile(
      `${fixture.paths.profileDir}\\cordis.patch.yml`,
      [
        "- id: agent-default-model",
        "  config:",
        "    provider: minimax",
        "    model: fixture-model",
        "- id: llm-pi-ai",
        "  config:",
        "    providers:",
        "      minimax:",
        "        apiKeyEnv: MINIMAX_API_KEY",
        "        models:",
        "          - id: fixture-model",
        "",
      ].join("\n"),
    );

    const result = await runCli(fixture, ["--json"]);
    const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    const haystacks = [result.stdout, result.stderr, run.content, evidenceText(fixture)];
    for (const haystack of haystacks) {
      expect(haystack).not.toContain(secret);
    }
    expect(result.code).toBe(0);
  });
});

describe("self-check: --declaration", () => {
  it("loads an explicitly named declaration instead of the discovered one", async () => {
    const fixture = createFixture();
    const declarationPath = `${fixture.paths.cwd}\\ad-hoc\\decl.ts`;
    fixture.fs.seedFile(declarationPath, "export default {};\n");

    const result = await runCli(fixture, ["--declaration", declarationPath, "--json"], (options) =>
      loadVerificationDeclaration({
        ...options,
        importModule: fakeDeclarationImport({ default: buildProfile() }),
      }),
    );

    expect(result.code).toBe(0);
    expect(result.report.profile).toBe("web");

    const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    const environment = fixture.fs.readJsonSync(run.runDir.replace(/\\/g, "/") + "/evidence/environment.json") as {
      declaration?: { path?: string };
    };
    expect(environment.declaration?.path).toBe(declarationPath);
  });
});
