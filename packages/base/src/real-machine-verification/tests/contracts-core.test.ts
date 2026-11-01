import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { BatchName, CheckId, CommitSha, Sha256Hex } from "../contracts/branding";
import { decideExitCode, describeFailures, tallyChecks, type CheckResult, type CheckStatus } from "../contracts/check";
import {
  BASE_LINE_PREFIX,
  IDENTITY_LINE_PREFIX,
  canonicalJson,
  digestOfFiles,
  formatBaseLine,
  formatIdentityLine,
  parseBaseLine,
  parseIdentityLine,
  sha256Text,
} from "../contracts/identity";
import type { ModelSelection } from "../contracts/verification-profile";
import type { VerificationProfile } from "../contracts/verification-profile";
import {
  BASE_ENV_ALLOWLIST,
  buildLaunchEnv,
  isAbsolutePath,
  joinPath,
  originOf,
  parseReadyUrl,
  planLaunch,
  type LaunchRequest,
} from "../contracts/launch-plan";
import { createRunReport, finishRunReport, renderRunSummary, stateFromChecks } from "../contracts/run-state";
import { defineScenario, parseScenario } from "../contracts/scenario";

const COMMIT = "0123456789abcdef0123456789abcdef01234567" as CommitSha;
const SHA_A = "a".repeat(64) as Sha256Hex;
const SHA_B = "b".repeat(64) as Sha256Hex;
const BATCH = "20261101-a" as BatchName;

function makeCheck(id: string, status: CheckStatus, hard = true): CheckResult {
  return {
    id: id as CheckId,
    title: `claim ${id}`,
    hard,
    status,
    detail: `${id} is ${status}`,
    expected: "something",
    actual: status === "pass" ? "something" : "nothing",
    evidence: [],
    durationMs: 1,
  };
}

/* ------------------------------------------------------------------- identity */

describe("digestOfFiles", () => {
  it("matches the documented wire format byte for byte", () => {
    const files = [
      { path: "b.txt", size: 3, sha256: SHA_B },
      { path: "a.txt", size: 1, sha256: SHA_A },
    ];
    const expectedText = `${SHA_A}  a.txt\n${SHA_B}  b.txt`;
    const expected = createHash("sha256").update(expectedText, "utf8").digest("hex");
    const digest = digestOfFiles(files);
    expect(digest.ok).toBe(true);
    if (!digest.ok) return;
    expect(digest.value).toBe(expected);
  });

  it("does not depend on input order", () => {
    const forward = digestOfFiles([{ path: "a", sha256: SHA_A }, { path: "b", sha256: SHA_B }]);
    const reverse = digestOfFiles([{ path: "b", sha256: SHA_B }, { path: "a", sha256: SHA_A }]);
    expect(forward.ok && reverse.ok).toBe(true);
    if (!forward.ok || !reverse.ok) return;
    expect(forward.value).toBe(reverse.value);
  });

  it("rejects backslash paths instead of hashing a Windows-specific digest", () => {
    const digest = digestOfFiles([{ path: "lib\\client.js", sha256: SHA_A }]);
    expect(digest.ok).toBe(false);
    if (digest.ok) return;
    expect(digest.error.code).toBe("invalid-input");
    expect(digest.error.message).toContain('"/" separators');
  });

  it("rejects a malformed sha256", () => {
    const digest = digestOfFiles([{ path: "a", sha256: "not-a-digest" }]);
    expect(digest.ok).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: 2 } })).toBe('{"a":{"c":2,"d":[3,1]},"b":1}');
  });

  it("drops undefined members the way JSON.stringify does", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("identity and base lines", () => {
  it("round-trips an identity line", () => {
    const line = formatIdentityLine({ batchName: BATCH, commit: COMMIT, packageSha256: SHA_A });
    expect(line.ok).toBe(true);
    if (!line.ok) return;
    expect(line.value.startsWith(IDENTITY_LINE_PREFIX)).toBe(true);
    expect(parseIdentityLine(line.value)).toEqual({
      ok: true,
      value: { batchName: BATCH, commit: COMMIT, packageSha256: SHA_A },
    });
  });

  it("rejects a near-miss identity line instead of accepting most of it", () => {
    const result = parseIdentityLine("- 验证身份：批次 x；候选提交 abc；候选包 sha256 def");
    expect(result.ok).toBe(false);
  });

  it("round-trips a base line", () => {
    const line = formatBaseLine({ ref: "main", tip: COMMIT, expectedVersion: "1.9.0" });
    expect(line.ok).toBe(true);
    if (!line.ok) return;
    expect(line.value.startsWith(BASE_LINE_PREFIX)).toBe(true);
    expect(parseBaseLine(line.value)).toEqual({
      ok: true,
      value: { ref: "main", tip: COMMIT, expectedVersion: "1.9.0" },
    });
  });
});

describe("sha256Text", () => {
  it("hashes UTF-8, including Chinese text, deterministically", () => {
    const expected = createHash("sha256").update("验证身份", "utf8").digest("hex");
    expect(sha256Text("验证身份")).toBe(expected);
  });
});

/* ---------------------------------------------------------------------- checks */

describe("check aggregation", () => {
  it("counts hard failures separately from soft ones", () => {
    const tally = tallyChecks([
      makeCheck("a", "pass"),
      makeCheck("b", "fail", true),
      makeCheck("c", "fail", false),
      makeCheck("d", "blocked"),
      makeCheck("e", "skip"),
    ]);
    expect(tally).toEqual({ total: 5, passed: 1, failed: 2, skipped: 1, blocked: 1, hardFailed: 1 });
  });

  it("maps hard failure to 1, blocked to 2, and only a clean tally to 0", () => {
    expect(decideExitCode([makeCheck("a", "pass")])).toBe(0);
    expect(decideExitCode([makeCheck("a", "fail")])).toBe(1);
    expect(decideExitCode([makeCheck("a", "blocked")])).toBe(2);
    expect(decideExitCode([makeCheck("a", "blocked"), makeCheck("b", "fail")])).toBe(1);
  });

  it("names the failing checks, not just the count", () => {
    const line = describeFailures([makeCheck("package-installed", "fail")]);
    expect(line).toContain("package-installed");
    expect(describeFailures([makeCheck("a", "pass")])).toBeNull();
  });
});

/* -------------------------------------------------------------------- run state */

describe("run report", () => {
  it("derives state and exit code from checks rather than from the caller", () => {
    expect(stateFromChecks([makeCheck("a", "pass")])).toEqual({ state: "passed", exitCode: 0 });
    expect(stateFromChecks([makeCheck("a", "fail")])).toEqual({ state: "failed", exitCode: 1 });
    expect(stateFromChecks([makeCheck("a", "blocked")])).toEqual({ state: "blocked", exitCode: 2 });
  });

  it("finishes an open report and renders one line per check", () => {
    const open = createRunReport({ command: "self-check", profile: "web", startedAt: "2026-11-01T00:00:00+08:00" });
    const finished = finishRunReport(open, {
      checks: [makeCheck("package-installed", "pass"), makeCheck("skills-set", "fail")],
      steps: [],
      finishedAt: "2026-11-01T00:00:05+08:00",
      notes: ["model selection: minimax-cn"],
    });
    expect(finished.state).toBe("failed");
    expect(finished.exitCode).toBe(1);
    const text = renderRunSummary(finished);
    expect(text).toContain("self-check");
    expect(text).toContain("package-installed");
    expect(text).toContain("skills-set");
    expect(text).toContain("expected: something");
    expect(text).toContain("actual:   nothing");
    expect(text).toContain("model selection: minimax-cn");
  });

  it("keeps an aborted run at exit 1 even when every collected check passed", () => {
    const open = createRunReport({ command: "run", profile: "web", startedAt: "2026-11-01T00:00:00+08:00" });
    const finished = finishRunReport(open, {
      checks: [makeCheck("a", "pass")],
      steps: [],
      finishedAt: "2026-11-01T00:00:05+08:00",
      overrideState: "aborted",
    });
    expect(finished.state).toBe("aborted");
    expect(finished.exitCode).toBe(1);
  });
});

/* ------------------------------------------------------------------ launch plan */

const MODEL: ModelSelection = {
  provider: "minimax-cn",
  model: "Minimax-M3.1-Flash",
  apiKeyEnv: "MINIMAX_CN_API_KEY",
  contextWindow: 1_000_000,
  maxTokens: 120_000,
  input: ["text", "image"],
};

function launchRequest(overrides: Partial<LaunchRequest> = {}): LaunchRequest {
  return {
    profile: "web" as VerificationProfile["defaultProfile"],
    home: "C:\\work\\home",
    userprofile: "C:\\work\\userprofile",
    startCwd: "C:\\work\\run-a",
    pluginCacheDir: ".dsh-demo-cache",
    runtime: { exe: "C:\\DSH\\DSH.exe", cliJs: "C:\\DSH\\cli.js" },
    baseEnv: { PATH: "C:\\bin", SECRET_KEEP_ME_OUT: "leak", MINIMAX_CN_API_KEY: "host-key" },
    ...overrides,
  };
}

describe("planLaunch", () => {
  it("builds the documented argv and defaults the port to an ephemeral one", () => {
    const plan = planLaunch(launchRequest());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.argv).toEqual([
      "C:\\DSH\\DSH.exe",
      "--expose-internals",
      "C:\\DSH\\cli.js",
      "--profile",
      "web",
      "--port",
      "0",
      "--no-open",
    ]);
    expect(plan.value.port).toBe(0);
  });

  it("puts the executable itself at argv[0], because that is what the process port spawns", () => {
    const plan = planLaunch(launchRequest());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // A pre-fix plan started at `--expose-internals`, which the spawn port would
    // try to execute as a program name. Lock the position, not just membership.
    expect(plan.value.argv[0]).toBe("C:\\DSH\\DSH.exe");
    expect(plan.value.argv[1]).toBe("--expose-internals");
    expect(plan.value.argv).toContain("--no-open");
  });

  it("writes the instance logs where the caller points them, defaulting to the working directory", () => {
    const defaulted = planLaunch(launchRequest());
    const rooted = planLaunch(launchRequest({ logDir: "C:\\instances\\abc123" }));
    expect(defaulted.ok && rooted.ok).toBe(true);
    if (!defaulted.ok || !rooted.ok) return;
    expect(defaulted.value.logFiles.stdout).toBe(joinPath("C:\\work\\run-a", "instance.stdout.log"));
    expect(rooted.value.logFiles.stdout).toBe(joinPath("C:\\instances\\abc123", "instance.stdout.log"));
    expect(rooted.value.logFiles.stderr).toBe(joinPath("C:\\instances\\abc123", "instance.stderr.log"));
    expect(rooted.value.cwd).toBe("C:\\work\\run-a");
  });

  it("redirects all three isolation variables", () => {
    const env = buildLaunchEnv(launchRequest());
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.value.DSH_HOME).toBe("C:\\work\\home");
    expect(env.value.USERPROFILE).toBe("C:\\work\\userprofile");
    expect(env.value.HOME).toBe("C:\\work\\userprofile");
    expect(env.value.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("copies only allowlisted parent variables", () => {
    const env = buildLaunchEnv(launchRequest());
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.value.PATH).toBe("C:\\bin");
    expect(env.value.SECRET_KEEP_ME_OUT).toBeUndefined();
    expect(env.value.MINIMAX_CN_API_KEY).toBeUndefined();
    expect(BASE_ENV_ALLOWLIST).toContain("PATH");
  });

  it("injects the resolved model secret last, and lists it as a secret name", () => {
    const plan = planLaunch(
      launchRequest({ model: { ...MODEL, secretValue: "real-key", source: "real-home-store" } }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.env.MINIMAX_CN_API_KEY).toBe("real-key");
    expect(plan.value.secretEnvNames).toEqual(["MINIMAX_CN_API_KEY"]);
    expect(plan.value.notes.join(" ")).toContain("minimax-cn/Minimax-M3.1-Flash");
  });

  it("declares the plugin log directory only when the profile names a cache dir", () => {
    const withCache = planLaunch(launchRequest());
    const withoutCache = planLaunch(launchRequest({ pluginCacheDir: undefined }));
    expect(withCache.ok && withoutCache.ok).toBe(true);
    if (!withCache.ok || !withoutCache.ok) return;
    expect(withCache.value.logFiles.pluginLogDir).toBe(joinPath("C:\\work\\run-a", ".dsh-demo-cache", "logs"));
    expect(withoutCache.value.logFiles.pluginLogDir).toBeNull();
  });

  it("inherits a host variable only when the declaration allowlists it", () => {
    const baseEnv = { ...launchRequest().baseEnv, HOST_ONLY_CANARY: "canary-value" };
    const blocked = buildLaunchEnv(launchRequest({ baseEnv }));
    const allowed = buildLaunchEnv(
      launchRequest({ baseEnv, instanceEnvAllowlist: ["HOST_ONLY_CANARY"] }),
    );
    expect(blocked.ok && allowed.ok).toBe(true);
    if (!blocked.ok || !allowed.ok) return;
    // A stray parent variable stays out unless the declaration names it; being
    // allowlisted is not a licence to copy everything else.
    expect(blocked.value.HOST_ONLY_CANARY).toBeUndefined();
    expect(blocked.value.SECRET_KEEP_ME_OUT).toBeUndefined();
    expect(allowed.value.HOST_ONLY_CANARY).toBe("canary-value");
    expect(allowed.value.SECRET_KEEP_ME_OUT).toBeUndefined();
  });

  it("merges env-file secret names with the model key and reports the count", () => {
    const plan = planLaunch(
      launchRequest({
        model: { ...MODEL, secretValue: "real-key", source: "real-home-store" },
        envFile: {
          path: "C:\\work\\env.json",
          values: { EXTRA_TOKEN: "tok", PLAIN_VALUE: "plain" },
          names: ["EXTRA_TOKEN", "PLAIN_VALUE"],
          secretNames: ["EXTRA_TOKEN"],
        },
      }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.env.EXTRA_TOKEN).toBe("tok");
    expect(plan.value.env.PLAIN_VALUE).toBe("plain");
    expect(plan.value.secretEnvNames).toEqual(["EXTRA_TOKEN", "MINIMAX_CN_API_KEY"]);
    expect(plan.value.notes.join(" ")).toContain("injected 2 secret variable(s)");
  });

  it("rejects relative paths and impossible ports", () => {
    expect(planLaunch(launchRequest({ home: "relative/home" })).ok).toBe(false);
    expect(planLaunch(launchRequest({ port: 70000 })).ok).toBe(false);
  });
});

describe("readiness URL", () => {
  it("parses the one line the host prints", () => {
    const ready = parseReadyUrl("dsh web: http://127.0.0.1:54321/?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    expect(ready).not.toBeNull();
    if (ready === null) return;
    expect(ready.port).toBe(54321);
    expect(ready.token.length).toBe(43);
    expect(originOf(ready)).toBe("http://127.0.0.1:54321");
  });

  it("returns null for any other log line", () => {
    expect(parseReadyUrl("[bundled] provider registered")).toBeNull();
    expect(parseReadyUrl("http://127.0.0.1:0/?token=x")).toBeNull();
  });

  it("recognizes absolute paths on both platforms", () => {
    expect(isAbsolutePath("/tmp/x")).toBe(true);
    expect(isAbsolutePath("C:\\x")).toBe(true);
    expect(isAbsolutePath("tmp/x")).toBe(false);
  });
});

/* --------------------------------------------------------------------- scenario */

describe("scenario validation", () => {
  it("accepts a scenario whose steps are unique and whose custom step has a body", () => {
    const definition = defineScenario({
      id: "narrow-dock",
      title: "dock stays narrow below 360px",
      steps: [
        { id: "launch", title: "launch the instance", kind: "launch" },
        { id: "measure", title: "measure the dock", kind: "custom", run: () => [{ ok: true, detail: "312px" }] },
      ],
    });
    expect(definition.steps).toHaveLength(2);
  });

  it("rejects duplicate step ids", () => {
    const parsed = parseScenario({
      id: "dup",
      title: "duplicate",
      steps: [
        { id: "same", title: "one", kind: "check" },
        { id: "same", title: "two", kind: "check" },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain("duplicated");
  });

  it("rejects a body on a built-in step, because it would be silently ignored", () => {
    const parsed = parseScenario({
      id: "confused",
      title: "confused",
      steps: [{ id: "check", title: "check", kind: "check", run: () => [{ ok: true, detail: "ignored" }] }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain("provides run()");
    expect(parsed.error.message).toContain('"custom"');
  });
});
