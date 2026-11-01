/**
 * In-process CLI tests for launch and stop.
 *
 * The CLI is exercised through `main(argv, deps)` with a fake machine, so the
 * assertions cover the whole contract a caller sees: exit codes, the single-JSON
 * stdout rule, the human lines, the files that appear on disk, and the split
 * between stdout and stderr. No test starts a real host or reads a real
 * credential store.
 */
import { describe, expect, it } from "vitest";

import { main, type CliDeps } from "../cli/main";
import { LAUNCH_EXE, ScriptedHttp, ScriptedProcess, createLaunchFixture, fixtureLoader, type LaunchFixture } from "./support/fake-launch";
import { captureIo } from "./support/fake-capture";
import { joinFsPath } from "../runtime/paths";

interface CliRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

interface LaunchJson {
  readonly schemaVersion: number;
  readonly command: string;
  readonly ok: boolean;
  readonly dryRun?: boolean;
  readonly plan?: {
    readonly argv: readonly string[];
    readonly instanceId: string;
    readonly envNames: readonly string[];
    readonly secretEnvNames: readonly string[];
    readonly logFiles: { readonly stdout: string; readonly stderr: string };
    readonly profileCopy: { readonly sourceProfileDir: string; readonly targetProfileDir: string };
  };
  readonly instance?: {
    readonly instanceId: string;
    readonly dir: string;
    readonly pid: number;
    readonly port: number;
    readonly home: string;
    readonly userprofile: string;
    readonly startCwd: string;
    readonly keep?: boolean;
    readonly planPath?: string;
  };
  readonly readiness?: {
    readonly connectStatus: number;
    readonly inventory: {
      readonly entryCount: number;
      readonly enabledCount: number;
      readonly activeCount: number;
      readonly offenders: readonly unknown[];
    };
  };
}

interface StopJson {
  readonly schemaVersion: number;
  readonly command: string;
  readonly ok: boolean;
  readonly results: readonly {
    readonly id?: string;
    readonly dir: string;
    readonly pid?: number;
    readonly killed?: boolean;
    readonly alreadyGone?: boolean;
    readonly aliveAfter?: boolean;
    readonly error?: string;
  }[];
}

async function runCli(fixture: LaunchFixture, argv: readonly string[]): Promise<CliRun> {
  const capture = captureIo();
  const deps: CliDeps = {
    ports: fixture.ports,
    io: capture.io,
    runtime: fixture.runtime,
    loadDeclaration: fixtureLoader(fixture),
  };
  const code = await main(argv, deps);
  return { code, out: capture.stdout(), err: capture.stderr() };
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function instancesRoot(fixture: LaunchFixture): string {
  return joinFsPath(fixture.paths.workRoot, "instances");
}

/** Seed a record that `stop` can read; only the fields stopRecord actually uses. */
function seedInstanceRecord(fixture: LaunchFixture, id: string, pid: number): string {
  const dir = joinFsPath(instancesRoot(fixture), id);
  fixture.fs.seedJson(joinFsPath(dir, "instance.json"), {
    schemaVersion: 1,
    instanceId: id,
    dir,
    pid,
    port: 50000,
    tokenUrl: "http://127.0.0.1:50000/?token=" + "t".repeat(43),
    originUrl: "http://127.0.0.1:50000",
    profile: "web",
    home: joinFsPath(dir, "home"),
    userprofile: joinFsPath(dir, "userprofile"),
    startCwd: joinFsPath(dir, "workdir"),
    startedAt: "2026-11-01T21:00:00.000+08:00",
    readyMs: 10,
    stdoutPath: joinFsPath(dir, "instance.stdout.log"),
    stderrPath: joinFsPath(dir, "instance.stderr.log"),
    pluginLogDir: null,
    exe: LAUNCH_EXE,
    cliJs: "C:/Harness/resources/app.asar/dsh/cli.js",
    envNames: [],
    secretEnvNames: [],
    model: null,
  });
  return dir;
}

/* ------------------------------------------------------------------ launch */

describe("launch command", () => {
  it("renders --dry-run --json as one JSON document and touches nothing", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, [
      "launch",
      "--dry-run",
      "--json",
      "--work-root",
      fixture.paths.workRoot,
    ]);

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.trim().split("\n")).toHaveLength(1);
    const doc = parseJson<LaunchJson>(result.out);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.command).toBe("launch");
    expect(doc.ok).toBe(true);
    expect(doc.dryRun).toBe(true);
    expect(doc.plan?.argv[0]).toBe(LAUNCH_EXE);
    expect(doc.plan?.argv[2]).toBe(
      "C:/Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js",
    );
    expect(doc.plan?.instanceId).toHaveLength(16);
    expect(doc.plan?.envNames).toContain("DSH_HOME");
    expect(doc.plan?.secretEnvNames).toEqual([]);
    expect(doc.plan?.profileCopy.sourceProfileDir).toBe(fixture.paths.profileDir);

    // The claim the dry run makes about itself.
    expect(fixture.fs.writes).toEqual([]);
    expect(await fixture.fs.exists(instancesRoot(fixture))).toBe(false);
    expect(fixture.process.spawns).toHaveLength(0);
    expect((fixture.http as ScriptedHttp).requests).toHaveLength(0);
  });

  it("prints the same plan in human form", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["launch", "--dry-run", "--work-root", fixture.paths.workRoot]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing was written and no process was started");
    expect(result.out).toContain("instance id: ");
    expect(result.out).toContain("argv: " + LAUNCH_EXE);
    expect(result.out).toContain("profile copy: ");
    expect(fixture.fs.writes).toEqual([]);
  });

  it("launches, records the handle and reports ready as JSON", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, [
      "launch",
      "--json",
      "--keep",
      "--work-root",
      fixture.paths.workRoot,
    ]);

    expect(result.code).toBe(0);
    const doc = parseJson<LaunchJson>(result.out);
    expect(doc.ok).toBe(true);
    expect(doc.command).toBe("launch");
    const instance = doc.instance;
    expect(instance).toBeDefined();
    if (instance === undefined) return;
    expect(instance.pid).toBe(4242);
    expect(instance.port).toBe(53211);
    expect(instance.keep).toBe(true);
    // Three different redirects, each inside the instance directory.
    expect(new Set([instance.home, instance.userprofile, instance.startCwd]).size).toBe(3);
    expect(instance.home.startsWith(instance.dir)).toBe(true);
    expect(instance.userprofile.startsWith(instance.dir)).toBe(true);
    expect(instance.startCwd.startsWith(instance.dir)).toBe(true);
    expect(instance.planPath).toBe(joinFsPath(instance.dir, "plan.json"));

    expect(doc.readiness?.connectStatus).toBe(302);
    expect(doc.readiness?.inventory.activeCount).toBe(2);
    expect(doc.readiness?.inventory.enabledCount).toBe(2);
    expect(doc.readiness?.inventory.offenders).toEqual([]);

    expect(await fixture.fs.exists(joinFsPath(instance.dir, "instance.json"))).toBe(true);
    expect(await fixture.fs.exists(joinFsPath(instance.dir, "plan.json"))).toBe(true);
    expect(fixture.process.spawns).toHaveLength(1);
    expect(fixture.process.spawns[0]?.argv[0]).toBe(LAUNCH_EXE);
    // Discovery reports the entry inside the archive; the spawn gets the joined path.
    expect(fixture.process.spawns[0]?.argv[2]).toBe(
      "C:/Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js",
    );
  });

  it("prints the human result with the stop hint", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["launch", "--work-root", fixture.paths.workRoot]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("is ready");
    expect(result.out).toContain("pid: 4242");
    expect(result.out).toContain("connect HTTP 302");
    expect(result.out).toContain("stop: dsh-verify stop --id ");
    // Progress lines are for stderr; stdout stays clean for the result.
    expect(result.err).toContain("copying profile");
    expect(result.err).toContain("starting the instance");
  });

  it("rejects an out-of-range --port with exit 2", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["launch", "--dry-run", "--port", "70000"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--port");
    expect(fixture.fs.writes).toEqual([]);
  });

  it("rejects a non-numeric --port with exit 2", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["launch", "--dry-run", "--port", "abc"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--port");
  });

  it("rejects an unknown flag with exit 2 before planning anything", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["launch", "--dry-run", "--bogus"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown option");
    expect(fixture.fs.writes).toEqual([]);
    expect(fixture.process.spawns).toHaveLength(0);
  });

  it("rejects a recognized flag this command does not implement", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["launch", "--dry-run", "--all"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("not valid for this command");
    expect(result.err).toContain("--all");
  });

  it("reports a missing profile as a prerequisite and exits 2", async () => {
    const fixture = createLaunchFixture({ profilePresent: false });
    const result = await runCli(fixture, [
      "launch",
      "--dry-run",
      "--json",
      "--work-root",
      fixture.paths.workRoot,
    ]);
    expect(result.code).toBe(2);
    const doc = parseJson<{ ok: boolean; error?: { message: string; stage?: string } }>(result.out);
    expect(doc.ok).toBe(false);
    expect(doc.error?.stage).toBe("prerequisite");
    expect(doc.error?.message).toContain(fixture.paths.profileDir);
  });
});

/* -------------------------------------------------------------------- stop */

describe("stop command", () => {
  it("refuses to guess: no target is a usage error", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["stop", "--json", "--work-root", fixture.paths.workRoot]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("nothing to stop");
    const doc = parseJson<StopJson>(result.out);
    expect(doc.ok).toBe(false);
    expect(doc.results).toEqual([]);
  });

  it("refuses --all together with --id", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["stop", "--all", "--id", "abc", "--work-root", fixture.paths.workRoot]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("cannot be combined");
  });

  it("stops a launched instance, then treats a second stop as already gone", async () => {
    const fixture = createLaunchFixture();
    const launched = parseJson<LaunchJson>(
      (await runCli(fixture, ["launch", "--json", "--work-root", fixture.paths.workRoot])).out,
    );
    const instance = launched.instance;
    expect(instance).toBeDefined();
    if (instance === undefined) return;

    const first = await runCli(fixture, [
      "stop",
      "--id",
      instance.instanceId,
      "--json",
      "--work-root",
      fixture.paths.workRoot,
    ]);
    expect(first.code).toBe(0);
    const firstDoc = parseJson<StopJson>(first.out);
    expect(firstDoc.ok).toBe(true);
    expect(firstDoc.results).toHaveLength(1);
    const row = firstDoc.results[0];
    expect(row?.id).toBe(instance.instanceId);
    expect(row?.pid).toBe(4242);
    expect(row?.killed).toBe(true);
    expect(row?.alreadyGone).toBe(false);
    expect(row?.aliveAfter).toBe(false);
    expect(await fixture.fs.exists(joinFsPath(instance.dir, "stopped.json"))).toBe(true);
    expect(fixture.process.isAlive(4242)).toBe(false);

    const second = await runCli(fixture, [
      "stop",
      "--id",
      instance.instanceId,
      "--json",
      "--work-root",
      fixture.paths.workRoot,
    ]);
    expect(second.code).toBe(0);
    const secondRow = parseJson<StopJson>(second.out).results[0];
    expect(secondRow?.alreadyGone).toBe(true);
    expect(secondRow?.killed).toBe(false);
    expect(secondRow?.aliveAfter).toBe(false);
  });

  it("records an already-gone pid without calling it a kill", async () => {
    const fixture = createLaunchFixture();
    const dir = seedInstanceRecord(fixture, "gone-instance", 777);
    const result = await runCli(fixture, ["stop", "--dir", dir, "--json"]);

    expect(result.code).toBe(0);
    const row = parseJson<StopJson>(result.out).results[0];
    expect(row?.pid).toBe(777);
    expect(row?.alreadyGone).toBe(true);
    expect(row?.killed).toBe(false);
    expect(row?.aliveAfter).toBe(false);
    const stopped = fixture.fs.readJsonSync(joinFsPath(dir, "stopped.json")) as Record<string, unknown>;
    expect(stopped["alreadyGone"]).toBe(true);
    expect(stopped["pid"]).toBe(777);
  });

  it("--all stops the others even when one pid refuses to die, and exits 1", async () => {
    // The stubborn pid stays alive no matter how often it is killed; the other
    // two die on the first kill. Cleanup must not be a transaction.
    const alive = new Set([9001, 9002, 9003]);
    const process = new ScriptedProcess({
      pid: 9000,
      alive: (pid) => alive.has(pid),
      kill: (pid) => {
        if (pid !== 9002) alive.delete(pid);
        return { killed: true, alreadyGone: false };
      },
    });
    const fixture = createLaunchFixture({ process });
    seedInstanceRecord(fixture, "instance-a", 9001);
    seedInstanceRecord(fixture, "instance-b", 9002);
    seedInstanceRecord(fixture, "instance-c", 9003);

    const result = await runCli(fixture, ["stop", "--all", "--json", "--work-root", fixture.paths.workRoot]);
    expect(result.code).toBe(1);
    const doc = parseJson<StopJson>(result.out);
    expect(doc.ok).toBe(false);
    expect(doc.results).toHaveLength(3);
    const byId = new Map(doc.results.map((row) => [row.id, row]));
    expect(byId.get("instance-a")?.aliveAfter).toBe(false);
    expect(byId.get("instance-a")?.killed).toBe(true);
    expect(byId.get("instance-c")?.aliveAfter).toBe(false);
    const stubborn = byId.get("instance-b");
    expect(stubborn?.pid).toBe(9002);
    expect(stubborn?.aliveAfter).toBe(true);
    expect(stubborn?.error).toBeDefined();
    expect(result.err).toContain("instance-b");
    expect(result.err).toContain("still alive");
    expect(process.kills.map((kill) => kill.pid)).toEqual(expect.arrayContaining([9001, 9002, 9003]));
  });

  it("--all with nothing recorded exits 0 and says so", async () => {
    const fixture = createLaunchFixture();
    const result = await runCli(fixture, ["stop", "--all", "--work-root", fixture.paths.workRoot]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("no instances found");
    expect(result.err).toBe("");
  });
});
