/**
 * In-process CLI tests: `main(argv, deps)` against a fake machine.
 *
 * Every case here starts from the all-green fixture and breaks one assumption, so
 * the asserted status names the defect. Nothing touches the real DSH home, starts
 * an app, or uses the network — which is what makes this suite runnable on any
 * checkout while still exercising the real check functions and report writer.
 */
import { describe, expect, it } from "vitest";

import { loadVerificationDeclaration, type LoadDeclarationOptions } from "../declaration/loader";
import type { RunReport } from "../contracts/run-state";
import { ok } from "../contracts/result";
import { main } from "../cli/main";
import { captureIo } from "./support/fake-capture";
import {
  buildProfile,
  createFixture,
  customCheckFixture,
  declarationLoader,
  fakeDeclarationImport,
  fixtureDeclaration,
  readRunDirectory,
  type Fixture,
} from "./support/fake-machine";

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly report: RunReport;
}

async function runSelfCheck(
  fixture: Fixture,
  argv: readonly string[] = [],
  loadDeclaration: ((options: LoadDeclarationOptions) => ReturnType<typeof loadVerificationDeclaration>) | undefined = undefined,
): Promise<RunResult> {
  const capture = captureIo();
  const loader = loadDeclaration ?? declarationLoader(ok(fixtureDeclaration(fixture)));
  const code = await main(["self-check", "--work-root", fixture.paths.workRoot, ...argv], {
    ports: fixture.ports,
    io: capture.io,
    runtime: fixture.runtime,
    loadDeclaration: loader,
  });
  const stdout = capture.stdout();
  const json = argv.includes("--json") ? (JSON.parse(stdout) as RunReport) : undefined;
  const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);
  return { code, stdout, stderr: capture.stderr(), report: json ?? (JSON.parse(run.content) as RunReport) };
}

function statusOf(report: RunReport, id: string): string | undefined {
  return report.checks.find((check) => check.id === id)?.status;
}

function checkOf(report: RunReport, id: string) {
  return report.checks.find((check) => check.id === id);
}

describe("self-check: the green path", () => {
  it("passes the five built-in checks, skips the undeclared skill/model checks and exits 0", async () => {
    const fixture = createFixture();
    const result = await runSelfCheck(fixture);

    expect(result.code).toBe(0);
    expect(result.report.command).toBe("self-check");
    expect(result.report.profile).toBe("web");
    expect(result.report.state).toBe("passed");
    expect(result.report.checks.map((check) => check.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
      "skip",
      "skip",
      "skip",
    ]);
    expect(statusOf(result.report, "dsh-runtime")).toBe("pass");
    expect(statusOf(result.report, "node-version")).toBe("pass");
    expect(statusOf(result.report, "profile-present")).toBe("pass");
    expect(statusOf(result.report, "package-installed")).toBe("pass");
    expect(statusOf(result.report, "skills-set")).toBe("skip");
    expect(statusOf(result.report, "model-configured")).toBe("skip");
    expect(statusOf(result.report, "model-credential")).toBe("skip");
  });

  it("names the executable, the archive entry and the client entry digest in detail", async () => {
    const fixture = createFixture();
    const result = await runSelfCheck(fixture);

    const dsh = checkOf(result.report, "dsh-runtime");
    expect(dsh?.detail).toContain("DeepSeek Harness.exe");
    expect(dsh?.detail).toContain("cli.js");
    const installed = checkOf(result.report, "package-installed");
    expect(installed?.detail).toContain(fixture.paths.clientEntrySha256);
    expect(installed?.detail).toContain("1.2.3");
  });

  it("prints human lines as 'status id detail' and ends with the report path", async () => {
    const result = await runSelfCheck(createFixture());
    const lines = result.stdout.split("\n");

    for (const id of ["profile-declaration", "dsh-runtime", "node-version", "profile-present", "package-installed"]) {
      const matching = lines.filter((line) => line.startsWith(`ok ${id} `));
      expect(matching, id).toHaveLength(1);
      expect(matching[0], id).toMatch(/^ok [a-z][a-z0-9-]+ .+$/);
    }
    for (const id of ["skills-set", "model-configured", "model-credential"]) {
      const matching = lines.filter((line) => line.startsWith(`skip ${id} `));
      expect(matching, id).toHaveLength(1);
    }
    expect(result.stdout).toContain("report: ");
    expect(result.stdout).toContain("report-sha256: ");
    expect(result.stdout).toContain("evidence: ");
    expect(result.stderr).toBe("");
  });

  it("writes run.json with a sibling sha256 that matches its bytes", async () => {
    const fixture = createFixture();
    await runSelfCheck(fixture);
    const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);

    expect(run.content.length).toBeGreaterThan(0);
    expect(run.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.content).toContain('"command": "self-check"');
    expect(run.evidenceFiles.length).toBeGreaterThan(0);
    expect(result0(run.content)).toBeTruthy();
  });

  it("uses the default work root under .scratch/verify when --work-root is omitted", async () => {
    const fixture = createFixture();
    const capture = captureIo();
    const code = await main(["self-check"], {
      ports: fixture.ports,
      io: capture.io,
      runtime: fixture.runtime,
      loadDeclaration: declarationLoader(ok(fixtureDeclaration(fixture))),
    });
    expect(code).toBe(0);
    expect(fixture.fs.children(`${fixture.paths.cwd}/.scratch/verify/runs`)).toHaveLength(1);
  });
});

function result0(content: string): unknown {
  return JSON.parse(content) as unknown;
}

describe("self-check: one broken assumption at a time", () => {
  it("reports a missing DSH install as blocked (exit 2), never as a failure", async () => {
    const fixture = createFixture({ dshPresent: false });
    const result = await runSelfCheck(fixture);

    expect(statusOf(result.report, "dsh-runtime")).toBe("blocked");
    expect(checkOf(result.report, "dsh-runtime")?.hint).toContain("DeepSeek Harness");
    expect(result.report.checks.some((check) => check.status === "fail")).toBe(false);
    expect(result.code).toBe(2);
  });

  it("reports an install without app.asar as a failure with expected and actual", async () => {
    const fixture = createFixture({ asarPresent: false });
    const result = await runSelfCheck(fixture);

    const dsh = checkOf(result.report, "dsh-runtime");
    expect(dsh?.status).toBe("fail");
    expect(dsh?.expected).toBeTypeOf("string");
    expect(dsh?.actual).toContain("app.asar");
    expect(result.code).toBe(1);
  });

  it("fails a Node version below the declaration floor, naming both versions", async () => {
    const fixture = createFixture({ nodeVersion: "20.11.0" });
    const result = await runSelfCheck(fixture);

    const node = checkOf(result.report, "node-version");
    expect(node?.status).toBe("fail");
    expect(node?.expected).toContain("22.6.0");
    expect(node?.actual).toContain("20.11.0");
    expect(node?.hint).toContain("tsc");
    expect(result.stdout).toContain("  expected: ");
    expect(result.stdout).toContain("  actual:   ");
    expect(result.stdout).toContain("  hint:     ");
    expect(result.code).toBe(1);
  });

  it("reports a missing DSH profile as blocked with a hint", async () => {
    const fixture = createFixture({ profilePresent: false });
    const result = await runSelfCheck(fixture);

    expect(statusOf(result.report, "profile-present")).toBe("blocked");
    expect(checkOf(result.report, "profile-present")?.hint).toBeTruthy();
  });

  it("fails when the profile manifest does not declare the package", async () => {
    const fixture = createFixture({ declareDependency: false });
    const result = await runSelfCheck(fixture);

    const installed = checkOf(result.report, "package-installed");
    expect(installed?.status).toBe("fail");
    expect(installed?.expected).toContain("fixture-plugin");
    expect(installed?.actual).toContain("not declared");
    expect(result.code).toBe(1);
  });

  it("fails when the installed package is not on disk", async () => {
    const fixture = createFixture();
    await fixture.fs.remove(`${fixture.paths.packageDir}\\package.json`);
    const result = await runSelfCheck(fixture);

    expect(statusOf(result.report, "package-installed")).toBe("fail");
    expect(result.code).toBe(1);
  });

  it("fails a version mismatch and points at both versions", async () => {
    const fixture = createFixture({ localVersion: "1.3.0" });
    const result = await runSelfCheck(fixture);

    const installed = checkOf(result.report, "package-installed");
    expect(installed?.status).toBe("fail");
    expect(installed?.expected).toBe("1.3.0");
    expect(installed?.actual).toBe("1.2.3");
    expect(installed?.detail).toContain("1.3.0");
    expect(installed?.detail).toContain("1.2.3");
    expect(installed?.hint).toContain("install");
    expect(result.code).toBe(1);
  });

  it("degrades to reporting the installed version when cwd is not that plugin repo", async () => {
    const fixture = createFixture({ localName: "some-other-repo" });
    const result = await runSelfCheck(fixture);

    const installed = checkOf(result.report, "package-installed");
    expect(installed?.status).toBe("pass");
    expect(installed?.detail).toContain("1.2.3");
    expect(installed?.detail).toContain("skipped");
    expect(result.code).toBe(0);
  });

  it("fails when the declared client entry is missing from the installed package", async () => {
    const fixture = createFixture({ clientEntryPresent: false });
    const result = await runSelfCheck(fixture);

    const installed = checkOf(result.report, "package-installed");
    expect(installed?.status).toBe("fail");
    expect(installed?.expected).toContain("client.js");
    expect(installed?.actual).toBeTypeOf("string");
    expect(result.code).toBe(1);
  });
});

describe("self-check: declarations", () => {
  it("blocks with a copy-pasteable template when no declaration exists, exit 2", async () => {
    const fixture = createFixture();
    const result = await runSelfCheck(fixture, [], (options) => loadVerificationDeclaration(options));

    expect(result.code).toBe(2);
    expect(result.report.checks).toHaveLength(1);
    expect(result.report.checks[0]?.id).toBe("profile-declaration");
    expect(result.report.checks[0]?.status).toBe("blocked");
    expect(result.stdout).toContain("verify/profile.ts");
    expect(result.stdout).toContain("defineVerificationProfile");
    expect(result.stdout).toContain("dsh-featherhunter-plugin-base/real-machine-verification");
  });

  it("blocks (exit 2) when the declaration imports a package the repository has not installed", async () => {
    const fixture = createFixture();
    fixture.fs.seedFile(`${fixture.paths.cwd}\\verify\\profile.ts`, "export default {};\n");
    const result = await runSelfCheck(fixture, [], (options) =>
      loadVerificationDeclaration({
        ...options,
        importModule: async () => {
          throw Object.assign(
            new Error(
              "Cannot find package 'dsh-featherhunter-plugin-base' imported from C:\\fixture-repo\\verify\\profile.ts",
            ),
            { code: "ERR_MODULE_NOT_FOUND" },
          );
        },
      }),
    );

    expect(result.code).toBe(2);
    expect(result.report.checks[0]?.id).toBe("profile-declaration");
    expect(result.report.checks[0]?.status).toBe("blocked");
    expect(result.report.checks[0]?.hint).toContain("install dsh-featherhunter-plugin-base");
  });

  it("exits 1 when the declaration is invalid", async () => {
    const fixture = createFixture();
    fixture.fs.seedFile(`${fixture.paths.cwd}\\verify\\profile.ts`, "export default {};\n");
    const result = await runSelfCheck(fixture, [], (options) =>
      loadVerificationDeclaration({
        ...options,
        importModule: fakeDeclarationImport({
          default: { ...(buildProfile() as unknown as Record<string, unknown>), id: "Bad ID" },
        }),
      }),
    );

    expect(result.code).toBe(1);
    expect(result.report.checks[0]?.status).toBe("fail");
    expect(result.report.checks[0]?.expected).toBeTypeOf("string");
    expect(result.report.checks[0]?.hint).toBeTypeOf("string");
  });

  it("honours --profile over the declared defaultProfile", async () => {
    const fixture = createFixture({ profileName: "web" });
    fixture.fs.seedJson("C:\\fake-dsh-home\\profiles\\custom\\package.json", {
      name: "custom",
      version: "0.0.1",
      dependencies: { "fixture-plugin": "1.2.3" },
    });
    fixture.fs.seedJson("C:\\fake-dsh-home\\profiles\\custom\\node_modules\\fixture-plugin\\package.json", {
      name: "fixture-plugin",
      version: "1.2.3",
    });
    fixture.fs.seedFile(
      "C:\\fake-dsh-home\\profiles\\custom\\node_modules\\fixture-plugin\\lib\\client.js",
      fixture.paths.clientEntryContent,
    );
    const result = await runSelfCheck(fixture, ["--profile", "custom"]);

    expect(result.report.profile).toBe("custom");
    expect(result.code).toBe(0);
  });
});

describe("self-check: optional capabilities", () => {
  it("produces no failure when browser and screen are not injected", async () => {
    const fixture = createFixture();
    const result = await runSelfCheck(fixture);
    expect(result.report.checks.some((check) => check.status === "fail")).toBe(false);
  });

  it("reports an unavailable screen as blocked when --screen was requested, not as a failure", async () => {
    const fixture = createFixture({
      screen: { ok: false, error: { code: "unsupported", message: "no display detected" } },
    });
    const result = await runSelfCheck(fixture, ["--screen"]);

    const screen = checkOf(result.report, "screen-present");
    expect(screen?.status).toBe("blocked");
    expect(screen?.hint).toContain("ScreenPort");
    expect(screen?.blockedReason?.code).toBe("prerequisite-missing");
    expect(result.report.checks.some((check) => check.status === "fail")).toBe(false);
    expect(result.code).toBe(2);
  });

  it("passes the screen check when a display is reported", async () => {
    const fixture = createFixture();
    const result = await runSelfCheck(fixture, ["--screen"]);
    expect(statusOf(result.report, "screen-present")).toBe("pass");
    expect(result.code).toBe(0);
  });
});

describe("self-check: profile custom checks", () => {
  it("runs a plugin-supplied check after the built-ins", async () => {
    const fixture = createFixture({
      profileOverrides: { checks: [customCheckFixture(() => true, { id: "fixture-extra" as never, title: "extra" })] },
    });
    const result = await runSelfCheck(fixture);

    expect(result.report.checks.map((check) => check.id)).toContain("fixture-extra");
    expect(statusOf(result.report, "fixture-extra")).toBe("pass");
    expect(result.code).toBe(0);
  });

  it("maps a blocked custom check to blocked and keeps its structured reason", async () => {
    const fixture = createFixture({
      profileOverrides: {
        checks: [
          customCheckFixture(
            () => ({
              status: "blocked" as const,
              detail: "the fixture adapter is not installed",
              hint: "install the fixture adapter, then rerun",
              blockedReason: { code: "adapter-missing" as const, message: "the fixture adapter is not installed" },
            }),
            { id: "fixture-blocked" as never, title: "blocked" },
          ),
        ],
      },
    });
    const result = await runSelfCheck(fixture);

    const check = checkOf(result.report, "fixture-blocked");
    expect(check?.status).toBe("blocked");
    expect(check?.blockedReason?.code).toBe("adapter-missing");
    expect(check?.hint).toContain("rerun");
    expect(result.code).toBe(2);
  });

  it("maps a skipped custom check to skip without failing the run", async () => {
    const fixture = createFixture({
      profileOverrides: {
        checks: [
          customCheckFixture(() => ({ status: "skip" as const, detail: "the feature is not requested", hint: "enable it" }), {
            id: "fixture-skipped" as never,
            title: "skipped",
          }),
        ],
      },
    });
    const result = await runSelfCheck(fixture);

    const check = checkOf(result.report, "fixture-skipped");
    expect(check?.status).toBe("skip");
    expect(result.code).toBe(0);
  });
});

describe("self-check --dry-run", () => {
  it("prints the run plan and check list without creating the run directory", async () => {
    const fixture = createFixture();
    const capture = captureIo();
    const code = await main(
      ["self-check", "--work-root", fixture.paths.workRoot, "--dry-run", "--json"],
      {
        ports: fixture.ports,
        io: capture.io,
        runtime: fixture.runtime,
        loadDeclaration: declarationLoader(ok(fixtureDeclaration(fixture))),
      },
    );

    expect(code).toBe(0);
    expect(capture.stderr()).toBe("");
    const stdout = capture.stdout();
    expect(stdout.trim().split("\n")).toHaveLength(1);
    const doc = JSON.parse(stdout) as {
      readonly schemaVersion: number;
      readonly command: string;
      readonly dryRun?: boolean;
      readonly plan?: {
        readonly runId: string;
        readonly runDir: string;
        readonly evidenceDir: string;
        readonly profile: string;
        readonly declaration: { readonly path: string; readonly kind: string; readonly requiredNode: string };
        readonly screenRequested: boolean;
        readonly checks: readonly { readonly id: string }[];
        readonly checkCount: number;
      };
    };
    expect(doc.schemaVersion).toBe(1);
    expect(doc.command).toBe("self-check");
    expect(doc.dryRun).toBe(true);
    expect(doc.plan?.runId.startsWith("self-check-")).toBe(true);
    expect(doc.plan?.profile).toBe("web");
    expect(doc.plan?.declaration.path).toBe(fixture.paths.cwd + "\\verify\\profile.ts");
    expect(doc.plan?.declaration.requiredNode).toBe("22.6.0");
    expect(doc.plan?.screenRequested).toBe(false);
    expect(doc.plan?.checkCount).toBe(doc.plan?.checks.length);
    expect(doc.plan?.checks.length).toBeGreaterThan(0);

    expect(fixture.fs.writes).toEqual([]);
    expect(await fixture.fs.exists(fixture.paths.workRoot)).toBe(false);
  });
});

describe("argument errors", () => {
  async function runMain(
    fixture: Fixture,
    argv: readonly string[],
  ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
    const capture = captureIo();
    const code = await main(argv, {
      ports: fixture.ports,
      io: capture.io,
      runtime: fixture.runtime,
      loadDeclaration: declarationLoader(ok(fixtureDeclaration(fixture))),
    });
    return { code, stdout: capture.stdout(), stderr: capture.stderr() };
  }

  it("prints the command usage and exits 2 for an unknown flag", async () => {
    const fixture = createFixture();
    const result = await runMain(fixture, ["self-check", "--bogus"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown option(s): --bogus");
    expect(result.stderr).toMatch(/usage:/i);
    expect(result.stderr).not.toContain("fail self-check");
  });

  it("prints the command usage and exits 2 for a flag without a value", async () => {
    const fixture = createFixture();
    const result = await runMain(fixture, ["self-check", "--profile"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--profile needs a value");
    expect(result.stderr).toMatch(/usage:/i);
    expect(result.stderr).not.toContain("fail self-check");
  });

  it("prints the command usage and exits 2 for an unexpected argument", async () => {
    const fixture = createFixture();
    const result = await runMain(fixture, ["self-check", "extra"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unexpected argument(s): extra");
    expect(result.stderr).toMatch(/usage:/i);
    expect(result.stderr).not.toContain("fail self-check");
  });

  it("names an unknown global flag instead of pretending no command was given", async () => {
    const fixture = createFixture();
    const result = await runMain(fixture, ["--bogus"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown option(s): --bogus");
    expect(result.stderr).not.toContain("no command given");
    expect(result.stderr).toMatch(/usage:/i);
  });

  it("emits a usage failure document on stdout with --json", async () => {
    const fixture = createFixture();
    const result = await runMain(fixture, ["self-check", "--bogus", "--json"]);

    expect(result.code).toBe(2);
    const doc = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly command: string;
      readonly error?: { readonly code: string; readonly stage?: string; readonly hint?: string };
    };
    expect(doc.ok).toBe(false);
    expect(doc.command).toBe("self-check");
    expect(doc.error?.code).toBe("invalid-input");
    expect(doc.error?.stage).toBe("usage");
    expect(doc.error?.hint).toContain("usage:");
  });

  it("emits the same usage failure document when the bad flag comes before any command", async () => {
    const fixture = createFixture();
    const result = await runMain(fixture, ["--bogus", "--json"]);

    expect(result.code).toBe(2);
    const doc = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly command: string;
      readonly error?: { readonly code: string; readonly stage?: string; readonly hint?: string };
    };
    expect(doc.ok).toBe(false);
    // No command was parsed, so the document names none; the message carries the defect.
    expect(doc.command).toBe("");
    expect(doc.error?.code).toBe("invalid-input");
    expect(doc.error?.stage).toBe("usage");
    expect(doc.error?.hint).toContain("usage:");
    expect(result.stderr).toContain("unknown option(s): --bogus");
  });

  it("keeps the --json contract for a bare --json with no command", async () => {
    const fixture = createFixture();
    const result = await runMain(fixture, ["--json"]);

    expect(result.code).toBe(2);
    const doc = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly command: string;
      readonly error?: { readonly code: string; readonly stage?: string };
    };
    expect(doc.ok).toBe(false);
    expect(doc.command).toBe("");
    expect(doc.error?.code).toBe("invalid-input");
    expect(doc.error?.stage).toBe("usage");
    expect(result.stderr).toContain("no command given");
  });
});
