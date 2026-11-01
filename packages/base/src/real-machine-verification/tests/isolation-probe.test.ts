/**
 * Ticket 05 — the settings isolation probe, end to end but in-process.
 *
 * Every test drives the real command, the real checks and the real probe runtime;
 * only the machine is fake: the command handler simulates the probe child and the
 * filesystem is in memory. Each test breaks exactly one assumption, so a red
 * status is attributable to the thing the ticket names, not to a generic failure.
 *
 * Two invariants are asserted throughout: the real settings file is never written
 * and its content never reaches a report, an evidence file or a stream.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args";
import { FALLBACK_PLAN, ISOLATION_COMMAND, runIsolationCommand } from "../cli/commands/isolation";
import { sha256Text } from "../contracts/identity";
import { err, failure } from "../contracts/result";
import type { RunReport } from "../contracts/run-state";
import { PROBE_MARKER_CONTENT } from "../runtime/dsh/isolation";
import { joinFsPath } from "../runtime/paths";
import { captureIo } from "./support/fake-capture";
import {
  createIsolationFixture,
  ISOLATION_CANARY,
  onlyProbeRoot,
  probePathsFor,
  type IsolationFixture,
} from "./support/fake-isolation";
import { fakePath } from "./support/fake-fs";
import { readEvidenceText, readRunDirectory } from "./support/fake-machine";

interface IsolationRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Drive the command with the fixture's ports; flags are appended after the command. */
async function runIsolation(fixture: IsolationFixture, flags: readonly string[] = []): Promise<IsolationRun> {
  const capture = captureIo();
  const args = parseArgs([ISOLATION_COMMAND, "--work-root", fixture.paths.workRoot, ...flags]);
  const code = await runIsolationCommand(args, {
    ports: fixture.ports,
    io: capture.io,
    runtime: fixture.runtime,
    loadDeclaration: fixture.loadDeclaration,
  });
  return { code, out: capture.stdout(), err: capture.stderr() };
}

function parseReport(out: string): RunReport {
  return JSON.parse(out) as RunReport;
}

function checkById(report: RunReport, id: string): RunReport["checks"][number] | undefined {
  return report.checks.find((check) => check.id === id);
}

describe("dsh-verify isolation", () => {
  it("passes when the child sees the redirected home, writes the marker and leaves the real file untouched", async () => {
    const fixture = createIsolationFixture();
    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(0);
    const report = parseReport(run.out);
    expect(report.state).toBe("passed");
    expect(report.exitCode).toBe(0);
    expect(checkById(report, "isolation-home")?.status).toBe("pass");
    expect(checkById(report, "settings-isolated")?.status).toBe("pass");

    // Both checks observed the same single child, not one child each.
    expect(fixture.command.requests).toHaveLength(1);
    const request = fixture.command.requests[0];
    const probeRoot = onlyProbeRoot(fixture.fs, fixture.paths.workRoot);
    const expected = probePathsFor(probeRoot, fixture.paths.pluginSettingsDir ?? "");
    expect(request?.argv[0]).toBe(fixture.env.execPath());
    expect(request?.argv[1]).toBe("-e");
    expect(request?.cwd).toBe(expected.workdir);
    expect(request?.env?.["USERPROFILE"]).toBe(expected.redirectedHome);
    expect(request?.env?.["HOME"]).toBe(expected.redirectedHome);
    expect(request?.env?.["DSH_HOME"]).toBe(joinFsPath(expected.redirectedHome, ".dsh"));
    // Only the allowlist crosses into the child: a stray parent secret does not.
    expect(request?.env?.["UNRELATED_SECRET"]).toBeUndefined();

    // The marker landed under the redirected home with the fixed bytes...
    expect(fixture.fs.readFileSync(expected.markerPath)).toBe(PROBE_MARKER_CONTENT);
    // ...and the real file kept its bytes.
    expect(fixture.fs.readFileSync(fixture.paths.realSettingsPath ?? "")).toBe(fixture.paths.realSettingsContent);
    const realHomePrefix = `${fakePath(fixture.paths.realHome)}/`;
    expect(fixture.fs.writes.every((write) => !fakePath(write.path).startsWith(realHomePrefix))).toBe(true);

    // run.json + its sibling hash exist; stdout is the single JSON document and
    // the human lines went to stderr.
    const written = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    expect(written.content).toContain('"isolation-home"');
    expect(run.out.trim().startsWith("{")).toBe(true);
    expect(run.err).toContain("ok isolation-home");
    expect(run.err).toContain("ok settings-isolated");

    // Evidence records the hash of the real file, never its content.
    const evidence = readEvidenceText(fixture.fs, fixture.paths.workRoot);
    expect(evidence).toContain(sha256Text(fixture.paths.realSettingsContent));
  });

  it("turns isolation-home red and names both homes when the child ignores the redirect", async () => {
    const fixture = createIsolationFixture({ child: { ignoreRedirect: true } });
    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(1);
    const report = parseReport(run.out);
    expect(report.state).toBe("failed");
    const home = checkById(report, "isolation-home");
    expect(home?.status).toBe("fail");
    const probeRoot = onlyProbeRoot(fixture.fs, fixture.paths.workRoot);
    const expected = probePathsFor(probeRoot, fixture.paths.pluginSettingsDir ?? "");
    expect(home?.expected).toContain(expected.redirectedHome);
    expect(home?.actual).toContain(fixture.paths.realHome);
    expect(home?.detail).toContain("not the redirected");
    expect(home?.hint).toContain("USERPROFILE");
    expect(run.err).toContain("fail isolation-home");
    expect(run.err).toContain("expected:");
    expect(run.err).toContain("actual:");
  });

  it("turns settings-isolated red when the child cannot write or reread the marker", async () => {
    const fixture = createIsolationFixture({ child: { writeFails: true } });
    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(1);
    const report = parseReport(run.out);
    expect(checkById(report, "isolation-home")?.status).toBe("pass");
    const settings = checkById(report, "settings-isolated");
    expect(settings?.status).toBe("fail");
    expect(settings?.detail).toContain("marker");
    expect(settings?.expected).toContain("marker:");
    expect(settings?.actual).toContain("marker present: false");
  });

  it("turns settings-isolated red and prints the fallback plan when the child damages the real settings file", async () => {
    const fixture = createIsolationFixture({ childWritesToRealSettings: true });
    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(1);
    const report = parseReport(run.out);
    const settings = checkById(report, "settings-isolated");
    expect(settings?.status).toBe("fail");
    expect(settings?.detail).toContain(fixture.paths.realSettingsPath ?? "");
    expect(settings?.expected).toContain("keeps sha256");
    // The plan is printed on stderr in --json mode and copied into the report.
    expect(run.err).toContain("fallback plan");
    expect(run.err).toContain("take a global mutex");
    const notes = (report.notes ?? []).join("\n");
    expect(notes).toContain(FALLBACK_PLAN[0]);
    expect(notes).toContain("restore the file from the backup");
    // stdout is still exactly one JSON document.
    expect(() => JSON.parse(run.out)).not.toThrow();
  });

  it("prints the four-step fallback plan on stdout in human mode", async () => {
    const fixture = createIsolationFixture({ childWritesToRealSettings: true });
    const run = await runIsolation(fixture);

    expect(run.code).toBe(1);
    expect(run.out).toContain("fallback plan");
    expect(run.out).toContain("take a global mutex");
    expect(run.out).toContain("release the mutex");
    expect(run.err).toBe("");
  });

  it("passes with existed=false when the real settings file does not exist", async () => {
    const fixture = createIsolationFixture({ realSettingsPresent: false });
    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(0);
    const report = parseReport(run.out);
    const settings = checkById(report, "settings-isolated");
    expect(settings?.status).toBe("pass");
    expect(settings?.detail).toContain("existed=false");
    expect(await fixture.fs.exists(fixture.paths.realSettingsPath ?? "")).toBe(false);
    const evidence = readEvidenceText(fixture.fs, fixture.paths.workRoot);
    expect(evidence).toContain('"existedBefore": false');
    expect(evidence).toContain('"unchanged": true');
  });

  it("blocks both checks without starting a child when the declaration lacks pluginSettingsDir", async () => {
    const fixture = createIsolationFixture({ pluginSettingsDir: null });
    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(2);
    const report = parseReport(run.out);
    expect(report.state).toBe("blocked");
    expect(report.checks.map((check) => check.status)).toEqual(["blocked", "blocked"]);
    expect(fixture.command.requests).toHaveLength(0);
    expect(run.err).toContain("pluginSettingsDir");
    expect(checkById(report, "isolation-home")?.hint).toContain("pluginSettingsDir");
  });

  it("blocks instead of passing when the real settings file exists but cannot be hashed", async () => {
    const fixture = createIsolationFixture();
    const realSettingsPath = fixture.paths.realSettingsPath ?? "";
    const originalHash = fixture.fs.hashFile.bind(fixture.fs);
    fixture.fs.hashFile = async (path: string) =>
      fakePath(path) === fakePath(realSettingsPath)
        ? err(failure("io", "EACCES: permission denied, open 'settings.yaml'"))
        : originalHash(path);

    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(2);
    const report = parseReport(run.out);
    const settings = checkById(report, "settings-isolated");
    expect(settings?.status).toBe("blocked");
    expect(settings?.detail).toContain("could not hash");
    // The old prototype's null === null would have claimed a pass here.
    expect(settings?.status).not.toBe("pass");
  });

  it("turns isolation-home red when the child process exits non-zero", async () => {
    const fixture = createIsolationFixture({ child: { writeFails: true, exitCode: 1 } });
    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(1);
    const report = parseReport(run.out);
    const home = checkById(report, "isolation-home");
    expect(home?.status).toBe("fail");
    expect(home?.detail).toContain("exited with code 1");
    expect(home?.actual).toContain("exit code: 1");
  });

  it("never records the real settings content (canary has zero hits)", async () => {
    const fixture = createIsolationFixture();
    const run = await runIsolation(fixture, ["--json"]);
    const written = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    const evidence = readEvidenceText(fixture.fs, fixture.paths.workRoot);
    const everything = [run.out, run.err, written.content, evidence].join("\n");

    expect(everything.includes(ISOLATION_CANARY)).toBe(false);
    expect(everything.includes("apiKey")).toBe(false);
    expect(evidence).toContain(sha256Text(fixture.paths.realSettingsContent));
  });

  it("writes a blocked report when the declaration cannot load", async () => {
    const fixture = createIsolationFixture({
      declarationResult: err({
        kind: "blocked",
        code: "not-found",
        message: "no verify/profile.ts found",
        hint: "create verify/profile.ts",
      }),
    });
    const run = await runIsolation(fixture, ["--json"]);

    expect(run.code).toBe(2);
    const report = parseReport(run.out);
    expect(report.state).toBe("blocked");
    expect(report.checks.map((check) => check.status)).toEqual(["blocked", "blocked"]);
    expect(fixture.command.requests).toHaveLength(0);
    const written = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    expect(written.content).toContain("no verify/profile.ts found");
  });

  it("rejects an unknown flag with exactly one JSON error document", async () => {
    const fixture = createIsolationFixture();
    const capture = captureIo();
    const code = await runIsolationCommand(parseArgs([ISOLATION_COMMAND, "--bogus", "--json"]), {
      ports: fixture.ports,
      io: capture.io,
      runtime: fixture.runtime,
      loadDeclaration: fixture.loadDeclaration,
    });

    expect(code).toBe(2);
    const doc = JSON.parse(capture.stdout()) as { ok: boolean; error: { message: string } };
    expect(doc.ok).toBe(false);
    expect(doc.error.message).toContain("--bogus");
  });
});
