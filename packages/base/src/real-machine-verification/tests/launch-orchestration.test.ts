/**
 * Launch orchestration, end to end against doubles.
 *
 * Two claims are load-bearing and each gets its own kind of assertion:
 *
 * - *The plan is honest.* --dry-run and a real launch must derive from the same
 *   value, so the fake spawn is compared against the plan item by item, and a
 *   plan-only pass must record no write, no spawn and no HTTP call.
 * - *A failed launch leaves nothing behind.* Early exits, timeouts and a
 *   half-loaded plugin inventory must all come back as not-ready, must report
 *   the captured log tail (or the offending entries), and must not leave a live
 *   host or an instance.json that a later command could mistake for a handle.
 *
 * The secret cases use a canary: the value may only ever appear inside the child
 * environment, never in plan.json, instance.json, a log file or stdout.
 */
import { describe, expect, it } from "vitest";

import type { ProfileName } from "../contracts/branding";
import type { DshRuntimePaths } from "../contracts/launch-plan";
import type { SpawnRequest } from "../contracts/ports";
import type { ModelSelection } from "../contracts/verification-profile";
import {
  READINESS_CRITERION,
  describeOffenders,
  executeInstance,
  instanceIdFor,
  instanceLayoutFor,
  planInstance,
  projectInstancePlan,
  type InstancePlan,
  type PlanInstanceOptions,
} from "../orchestration/instance";
import { joinFsPath } from "../runtime/paths";
import {
  FIXTURE_TOKEN,
  LAUNCH_EXE,
  ScriptedHttp,
  ScriptedProcess,
  allActiveInventory,
  connectResponse,
  createLaunchFixture,
  inventoryOf,
  readyLine,
  rpcEnvelope,
  type LaunchFixture,
} from "./support/fake-launch";

const RUNTIME: DshRuntimePaths = { exe: LAUNCH_EXE, cliJs: "C:/Harness/resources/app.asar/dsh/cli.js" };
const CANARY = "sk-canary-launch-orchestration-4b7e-never-persisted";
const MODEL: ModelSelection = {
  provider: "deepseek",
  model: "deepseek-chat",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  contextWindow: 1_000_000,
  maxTokens: 120_000,
  input: ["text"],
};

function optionsFor(fixture: LaunchFixture, overrides: Partial<PlanInstanceOptions> = {}): PlanInstanceOptions {
  return {
    ports: fixture.ports,
    runtime: RUNTIME,
    dshHome: fixture.paths.dshHome,
    profileName: fixture.paths.profileName as ProfileName,
    profile: fixture.profile,
    profileDir: fixture.paths.profileDir,
    workRoot: fixture.paths.workRoot,
    keep: false,
    startedAtMs: fixture.clock.nowMs(),
    ...overrides,
  };
}

async function planned(fixture: LaunchFixture, overrides: Partial<PlanInstanceOptions> = {}): Promise<InstancePlan> {
  const result = await planInstance(optionsFor(fixture, overrides));
  if (!result.ok) throw new Error("the fixture plan failed: " + result.error.message);
  return result.value;
}

function requestsOf(fixture: LaunchFixture): readonly { url: string; method?: string }[] {
  return (fixture.http as ScriptedHttp).requests;
}

/** Every file directly inside the instance directory, as text. */
function instanceFileTexts(fixture: LaunchFixture, plan: InstancePlan): string[] {
  return fixture.fs
    .children(plan.layout.dir)
    .filter((path) => !path.endsWith("/home") && !path.endsWith("/userprofile") && !path.endsWith("/workdir"))
    .map((path) => fixture.fs.readFileSync(path));
}

function canaryCredentials(): string {
  return [
    "version: 2",
    "records:",
    "  deepseek:",
    "    secret: " + CANARY + "-record-must-never-be-read",
    "refs:",
    '  DEEPSEEK_API_KEY: "' + CANARY + '"',
    "",
  ].join("\n");
}

/* ------------------------------------------------ plan: pure and honest */

describe("planInstance", () => {
  it("derives every path from one instance id and writes nothing", async () => {
    const fixture = createLaunchFixture({ profileFiles: { "settings.json": "{}" } });
    const plan = await planned(fixture);

    expect(fixture.fs.writes).toEqual([]);
    expect(fixture.process.spawns).toHaveLength(0);
    expect(requestsOf(fixture)).toHaveLength(0);

    const layout = instanceLayoutFor(fixture.paths.workRoot, plan.instanceId);
    expect(plan.layout).toEqual(layout);
    expect(plan.instanceId).toBe(instanceIdFor(fixture.paths.profileName, fixture.paths.workRoot, plan.startedAtMs));
    // Three different redirects, each a distinct directory under the instance.
    const { home, userprofile, workdir } = plan.layout;
    expect(new Set([home, userprofile, workdir]).size).toBe(3);
    for (const directory of [home, userprofile, workdir]) expect(directory.startsWith(plan.layout.dir)).toBe(true);
    expect(plan.layout.stdoutLog).toBe(joinFsPath(plan.layout.dir, "instance.stdout.log"));
    expect(plan.layout.stderrLog).toBe(joinFsPath(plan.layout.dir, "instance.stderr.log"));
    expect(plan.layout.planPath).toBe(joinFsPath(plan.layout.dir, "plan.json"));
    expect(plan.layout.instancePath).toBe(joinFsPath(plan.layout.dir, "instance.json"));

    expect(plan.copy.sourceProfileDir).toBe(fixture.paths.profileDir);
    expect(plan.copy.targetProfileDir).toBe(joinFsPath(plan.layout.home, "profiles", "web"));
    expect(plan.launch.argv[0]).toBe(LAUNCH_EXE);
    expect(plan.launch.env.HOME).toBe(plan.layout.userprofile);
    expect(plan.launch.env.DSH_HOME).toBe(plan.layout.home);
    expect(plan.launch.logFiles.stdout).toBe(plan.layout.stdoutLog);
  });

  it("gives the same inputs the same id and a different start time a different one", async () => {
    const fixture = createLaunchFixture();
    const first = await planned(fixture);
    const second = await planned(fixture);
    expect(second.instanceId).toBe(first.instanceId);

    const later = await planned(fixture, { startedAtMs: fixture.clock.nowMs() + 1 });
    expect(later.instanceId).not.toBe(first.instanceId);
  });

  it("projects the plan without a secret value and without touching disk", async () => {
    const fixture = createLaunchFixture({ model: MODEL, realCredentials: canaryCredentials() });
    const plan = await planned(fixture);
    const projection = projectInstancePlan(plan);

    expect(JSON.stringify(projection)).not.toContain(CANARY);
    expect(projection.secretEnvNames).toEqual(["DEEPSEEK_API_KEY"]);
    expect(projection.envNames).toContain("DEEPSEEK_API_KEY");
    expect(projection.model?.credentialSource).toBe("real-home-store");
    expect(projection.argv[0]).toBe(LAUNCH_EXE);
    expect(fixture.fs.writes).toEqual([]);
    expect(await fixture.fs.exists(plan.layout.dir)).toBe(false);
  });

  it("fails as a prerequisite when the profile directory is missing", async () => {
    const fixture = createLaunchFixture({ profilePresent: false });
    const result = await planInstance(optionsFor(fixture));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe("prerequisite");
    expect(result.error.message).toContain(fixture.paths.profileDir);
    expect(result.error.hint).toContain("DSH_HOME");
    expect(fixture.fs.writes).toEqual([]);
    expect(fixture.process.spawns).toHaveLength(0);
  });

  it("keeps --keep in the plan, the projection and the record", async () => {
    const fixture = createLaunchFixture();
    const plan = await planned(fixture, { keep: true });
    expect(plan.keep).toBe(true);
    expect(projectInstancePlan(plan).keep).toBe(true);

    const executed = await executeInstance({ ports: fixture.ports, plan, runtime: RUNTIME });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.value.record.keep).toBe(true);
  });
});

/* ------------------------------------------------------ execute: success */

describe("executeInstance", () => {
  it("spawns exactly the planned argv/env and writes the handle last", async () => {
    const fixture = createLaunchFixture({ profileFiles: { "settings.json": "{}" } });
    const plan = await planned(fixture);

    const executed = await executeInstance({ ports: fixture.ports, plan, runtime: RUNTIME });
    if (!executed.ok) throw new Error("the fixture launch failed: " + executed.error.message);
    const { record, readiness, copy } = executed.value;

    // The fake spawn is compared with the plan value: a plan and a run that
    // disagree would make --dry-run a lie.
    expect(fixture.process.spawns).toHaveLength(1);
    const spawn = fixture.process.spawns[0] as SpawnRequest;
    expect(spawn.argv).toEqual(plan.launch.argv);
    expect(spawn.env).toEqual(plan.launch.env);
    expect(spawn.cwd).toBe(plan.launch.cwd);
    expect(spawn.stdoutPath).toBe(plan.launch.logFiles.stdout);
    expect(spawn.stderrPath).toBe(plan.launch.logFiles.stderr);
    expect(spawn.detached).toBe(true);
    expect(spawn.windowsHide).toBe(true);

    // The profile was copied and measured before the spawn was attempted.
    expect(copy.sourceProfileDir).toBe(fixture.paths.profileDir);
    expect(copy.targetProfileDir).toBe(plan.copy.targetProfileDir);
    expect(copy.files).toBeGreaterThanOrEqual(2);
    expect(copy.bytes).toBeGreaterThan(0);

    // Two readiness calls: the connect handshake, then the inventory.
    const requests = requestsOf(fixture);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("http://127.0.0.1:53211/connect?token=" + FIXTURE_TOKEN);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[1]?.url).toBe("http://127.0.0.1:53211/api/pluginInventory/list");
    expect(requests[1]?.method).toBe("POST");

    expect(record.schemaVersion).toBe(1);
    expect(record.instanceId).toBe(plan.instanceId);
    expect(record.dir).toBe(plan.layout.dir);
    expect(record.pid).toBe(4242);
    expect(record.port).toBe(53211);
    expect(record.tokenUrl).toBe("http://127.0.0.1:53211/?token=" + FIXTURE_TOKEN);
    expect(record.originUrl).toBe("http://127.0.0.1:53211");
    expect(record.profile).toBe("web");
    expect(record.home).toBe(plan.layout.home);
    expect(record.userprofile).toBe(plan.layout.userprofile);
    expect(record.startCwd).toBe(plan.layout.workdir);
    expect(record.stdoutPath).toBe(plan.layout.stdoutLog);
    expect(record.stderrPath).toBe(plan.layout.stderrLog);
    expect(record.pluginLogDir).toBeNull();
    expect(record.exe).toBe(LAUNCH_EXE);
    expect(record.cliJs).toBe(RUNTIME.cliJs);
    expect(record.model).toBeNull();
    expect(record.readiness).toEqual(readiness);
    expect(record.planPath).toBe(plan.layout.planPath);
    expect(record.keep).toBe(false);

    expect(readiness.stdoutLine).toBe(true);
    expect(readiness.connectStatus).toBe(302);
    expect(readiness.inventory).toEqual({ entryCount: 3, enabledCount: 2, activeCount: 2, offenders: [] });
    expect(readiness.checkedAt.length).toBeGreaterThan(0);

    // plan.json and instance.json exist and carry the same plan value.
    expect(await fixture.fs.exists(plan.layout.instancePath)).toBe(true);
    expect(await fixture.fs.exists(plan.layout.planPath)).toBe(true);
    const planJson = fixture.fs.readJsonSync(plan.layout.planPath) as Record<string, unknown>;
    expect(planJson["instanceId"]).toBe(plan.instanceId);
    expect(planJson["argv"]).toEqual(plan.launch.argv);
    const planCopy = planJson["profileCopy"] as Record<string, unknown>;
    expect(planCopy["files"]).toBe(copy.files);
    const instanceJson = fixture.fs.readJsonSync(plan.layout.instancePath) as Record<string, unknown>;
    expect(instanceJson["pid"]).toBe(4242);
    expect(instanceJson["readiness"]).toEqual(readiness);
  });

  it("keeps the plugin log directory when the profile declares a cache dir", async () => {
    const fixture = createLaunchFixture({ pluginCacheDir: ".dsh-plugin-cache" });
    const plan = await planned(fixture);
    expect(plan.launch.logFiles.pluginLogDir).toBe(joinFsPath(plan.layout.workdir, ".dsh-plugin-cache", "logs"));

    const executed = await executeInstance({ ports: fixture.ports, plan, runtime: RUNTIME });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.value.record.pluginLogDir).toBe(plan.launch.logFiles.pluginLogDir);
  });
});

/* --------------------------------------------------- execute: failures */

describe("executeInstance failures", () => {
  it("reports the captured stderr when the host exits before printing its URL", async () => {
    let seed: (request: SpawnRequest) => void = () => {};
    const dying = new ScriptedProcess({ pid: 777, alive: () => false, onSpawn: (request) => seed(request) });
    const fixture = createLaunchFixture({ process: dying });
    seed = (request) => fixture.fs.seedFile(request.stderrPath, "Error: profile web is missing\n");
    const plan = await planned(fixture);

    const executed = await executeInstance({ ports: fixture.ports, plan, runtime: RUNTIME });
    expect(executed.ok).toBe(false);
    if (executed.ok) return;
    expect(executed.error.stage).toBe("not-ready");
    expect(executed.error.message).toContain("exited before printing its access URL");
    expect(executed.error.hint).toContain("Error: profile web is missing");
    // The process port says it is already gone; nothing survived the failure and
    // no handle was written.
    expect(fixture.process.isAlive(777)).toBe(false);
    expect(await fixture.fs.exists(plan.layout.instancePath)).toBe(false);
    expect(await fixture.fs.exists(plan.layout.planPath)).toBe(false);
  });

  it("kills a live host when the readiness line never appears", async () => {
    const silent = new ScriptedProcess({
      pid: 555,
      onSpawn: (request) => silentFixture?.fs.seedFile(request.stdoutPath, "[boot] still loading\n"),
    });
    const silentFixture = createLaunchFixture({ process: silent });
    const plan = await planned(silentFixture);

    const executed = await executeInstance({ ports: silentFixture.ports, plan, runtime: RUNTIME, readyTimeoutMs: 1_000 });
    expect(executed.ok).toBe(false);
    if (executed.ok) return;
    expect(executed.error.stage).toBe("not-ready");
    expect(executed.error.code).toBe("timeout");
    expect(executed.error.hint).toContain("still loading");
    // The host was still alive, so the failure path must reap the tree.
    expect(silent.kills.map((kill) => kill.pid)).toEqual([555]);
    expect(silent.isAlive(555)).toBe(false);
    expect(await silentFixture.fs.exists(plan.layout.instancePath)).toBe(false);
  });

  it("rejects a half-loaded inventory, names the offender and stops the instance", async () => {
    const http = new ScriptedHttp((request) => {
      if (request.url.includes("/connect?")) return { ok: true, value: connectResponse() };
      return {
        ok: true,
        value: rpcEnvelope(
          inventoryOf([
            { entryId: "extension/core", enabled: true, fiberPhase: "active" },
            { entryId: "extension/loading", enabled: true, fiberPhase: "pending" },
            { entryId: "extension/disabled", enabled: false, fiberPhase: null },
          ]),
        ),
      };
    });
    const fixture = createLaunchFixture({ http });
    const plan = await planned(fixture);

    const executed = await executeInstance({ ports: fixture.ports, plan, runtime: RUNTIME });
    expect(executed.ok).toBe(false);
    if (executed.ok) return;
    expect(executed.error.stage).toBe("not-ready");
    expect(executed.error.message).toContain("plugin inventory is not ready");
    expect(executed.error.hint).toContain("extension/loading fiberPhase=pending");
    expect(executed.error.details).toMatchObject({ enabledCount: 2, activeCount: 1 });
    expect(fixture.process.kills.map((kill) => kill.pid)).toEqual([4242]);
    expect(fixture.process.isAlive(4242)).toBe(false);
    expect(await fixture.fs.exists(plan.layout.instancePath)).toBe(false);
  });

  it("reports an unreachable host as not-ready and stops what it started", async () => {
    const http = new ScriptedHttp(() => ({
      ok: false,
      error: { code: "io", message: "connect ECONNREFUSED 127.0.0.1:53211", hint: "the host is not listening" },
    }));
    const fixture = createLaunchFixture({ http });
    const plan = await planned(fixture);

    const executed = await executeInstance({ ports: fixture.ports, plan, runtime: RUNTIME });
    expect(executed.ok).toBe(false);
    if (executed.ok) return;
    expect(executed.error.stage).toBe("not-ready");
    expect(executed.error.message).toContain("ECONNREFUSED");
    expect(fixture.process.kills.map((kill) => kill.pid)).toEqual([4242]);
    expect(await fixture.fs.exists(plan.layout.instancePath)).toBe(false);
  });
});

/* --------------------------------------------------------------- model */

describe("planInstance model resolution", () => {
  it("records no model when the profile declares none", async () => {
    const fixture = createLaunchFixture();
    const plan = await planned(fixture);
    expect(plan.model).toBeNull();
    expect(plan.modelPlan).toBeNull();
    expect(plan.launch.secretEnvNames).toEqual([]);
    expect(plan.launch.env.DEEPSEEK_API_KEY).toBeUndefined();
  });

  it("resolves the real home store into the child env only", async () => {
    const fixture = createLaunchFixture({ model: MODEL, realCredentials: canaryCredentials() });
    const plan = await planned(fixture);

    expect(plan.model).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      credentialSource: "real-home-store",
      credentialAvailable: true,
      profileConfigured: true,
    });
    expect(plan.launch.env.DEEPSEEK_API_KEY).toBe(CANARY);
    expect(plan.launch.secretEnvNames).toEqual(["DEEPSEEK_API_KEY"]);
    expect(plan.modelNote).toBeNull();

    const executed = await executeInstance({ ports: fixture.ports, plan, runtime: RUNTIME });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;

    // The value is allowed in the child env...
    expect(fixture.process.spawns[0]?.env.DEEPSEEK_API_KEY).toBe(CANARY);
    // ...and nowhere a file or a stream could keep it.
    const texts = [JSON.stringify(executed.value.plan), ...instanceFileTexts(fixture, plan)];
    for (const text of texts) expect(text).not.toContain(CANARY);
    const instanceJson = fixture.fs.readFileSync(plan.layout.instancePath);
    expect(instanceJson).toContain("real-home-store");
    expect(instanceJson).toContain("DEEPSEEK_API_KEY");
    expect(instanceJson).not.toContain(CANARY);
  });

  it("falls back to the process environment", async () => {
    const fixture = createLaunchFixture({ model: MODEL, envValues: { DEEPSEEK_API_KEY: CANARY } });
    const plan = await planned(fixture);
    expect(plan.model?.credentialSource).toBe("process-env");
    expect(plan.launch.env.DEEPSEEK_API_KEY).toBe(CANARY);
    expect(plan.launch.secretEnvNames).toEqual(["DEEPSEEK_API_KEY"]);
    expect(JSON.stringify(projectInstancePlan(plan))).not.toContain(CANARY);
  });

  it("warns but still launches when no credential source has the key", async () => {
    const fixture = createLaunchFixture({ model: MODEL });
    const plan = await planned(fixture);

    expect(plan.modelPlan).toBeNull();
    expect(plan.model).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      credentialSource: "missing",
      credentialAvailable: false,
      profileConfigured: true,
    });
    expect(plan.modelNote).toContain("DEEPSEEK_API_KEY is missing");
    expect(plan.modelNote).toContain("the instance can start, but model calls may fail");
    expect(plan.launch.env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(plan.launch.secretEnvNames).toEqual([]);

    const executed = await executeInstance({ ports: fixture.ports, plan, runtime: RUNTIME });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.value.record.model?.credentialSource).toBe("missing");
    expect(executed.value.record.model?.credentialAvailable).toBe(false);
    expect(JSON.stringify(projectInstancePlan(plan))).not.toContain("sk-");
  });
});

/* ------------------------------------------------------------ helpers */

describe("readiness helpers", () => {
  it("states the criterion in one sentence and names offenders readably", () => {
    expect(READINESS_CRITERION).toContain("token URL");
    expect(READINESS_CRITERION).toContain("fiberPhase active");
    expect(
      describeOffenders([
        { entryId: "extension/loading", fiberPhase: "pending" },
        { entryId: "", fiberPhase: null },
      ]),
    ).toBe("extension/loading fiberPhase=pending, (unnamed entry) fiberPhase=null");
  });

  it("truncates a long offender list", () => {
    const offenders = Array.from({ length: 8 }, (_, index) => ({
      entryId: "extension/e" + index,
      fiberPhase: "pending",
    }));
    expect(describeOffenders(offenders).split(", ")).toHaveLength(5);
  });
});
