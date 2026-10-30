import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
  README_TARGETS,
  RELEASE_PATHS,
  bumpVersion,
  countReadmeReferences,
  countVersionReferences,
  readPackageVersion,
  resolveTargetVersion,
  runRelease,
  type CommandResult,
  type ReleaseDeps,
} from "../scripts/release";

const tempDirs: string[] = [];

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Create <root>/packages/base/package.json and return the package directory. */
function makePackage(root: string, version = "0.0.1"): string {
  const pkgDir = join(root, "packages", "base");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: PACKAGE_NAME, version }, null, 2) + "\n",
    "utf8",
  );
  return pkgDir;
}

/** Create the eleven README files with image URLs for the given versions. */
function makeReposFixture(parent: string, versions: string[] = ["0.0.1"]): void {
  for (const target of README_TARGETS) {
    const path = join(parent, target.repo, target.readme);
    mkdirSync(dirname(path), { recursive: true });
    const urls = versions
      .map((version) => "https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@" + version + "/data/img/card-feishu.png")
      .join("\n");
    writeFileSync(path, "# readme\n\n" + urls + "\n", "utf8");
  }
}

interface RunnerOptions {
  failCommand?: (command: string, args: string[]) => boolean;
  registry?: () => string;
  packFilename?: string;
}

interface Runner {
  run: (command: string, args: string[], options?: { cwd?: string }) => Promise<CommandResult>;
  calls: Array<{ command: string; args: string[]; cwd?: string }>;
}

function makeRunner(options: RunnerOptions = {}): Runner {
  const calls: Runner["calls"] = [];
  const run = async (command: string, args: string[], runOptions?: { cwd?: string }): Promise<CommandResult> => {
    calls.push({ command, args, cwd: runOptions?.cwd });
    if (options.failCommand?.(command, args) === true) {
      return { code: 1, stdout: "", stderr: "boom" };
    }
    if (command === "git") return { code: 0, stdout: "", stderr: "" };
    if (command === "npm" && args[0] === "view") {
      return { code: 0, stdout: (options.registry?.() ?? "") + "\n", stderr: "" };
    }
    if (command === "npm" && args[0] === "pack") {
      const filename = options.packFilename ?? PACKAGE_NAME + "-0.0.2.tgz";
      return {
        code: 0,
        stdout: JSON.stringify([{ filename, files: ["package.json", "dist/client/index.js"] }]) + "\n",
        stderr: "",
      };
    }
    return { code: 0, stdout: "ok\n", stderr: "" };
  };
  return { run, calls };
}

/** Fetch stub: every channel reports the manifest version, or fails with a status. */
function manifestFetch(version = "0.0.2", status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ version }),
  })) as unknown as typeof fetch;
}

function makeDeps(overrides: Partial<ReleaseDeps> = {}): { deps: ReleaseDeps; clock: { value: number } } {
  const clock = { value: 0 };
  const deps: ReleaseDeps = {
    run: makeRunner().run,
    sleep: async (ms: number) => {
      clock.value += ms;
    },
    now: () => new Date(clock.value),
    stdout: () => {},
    stderr: () => {},
    fetchImpl: manifestFetch(),
    ...overrides,
  };
  return { deps, clock };
}

describe("release version helpers", () => {
  it("bumps patch, minor and major versions", () => {
    expect(bumpVersion("0.0.1", "patch")).toBe("0.0.2");
    expect(bumpVersion("0.0.1", "minor")).toBe("0.1.0");
    expect(bumpVersion("0.0.1", "major")).toBe("1.0.0");
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  it("refuses to bump a prerelease tag", () => {
    expect(() => bumpVersion("0.0.2-drill", "patch")).toThrow("cannot bump non-release version");
  });

  it("resolves an explicit version and rejects invalid or unchanged ones", () => {
    expect(resolveTargetVersion("0.0.1", { version: "0.1.0" })).toBe("0.1.0");
    expect(resolveTargetVersion("0.0.1", {})).toBe("0.0.2");
    expect(resolveTargetVersion("0.0.1", { bump: "minor" })).toBe("0.1.0");
    expect(() => resolveTargetVersion("0.0.1", { version: "1.0" })).toThrow("semantic version");
    expect(() => resolveTargetVersion("0.0.1", { version: "0.0.1" })).toThrow("must differ");
  });

  it("reads the package version from package.json", () => {
    const root = makeTemp("release-pkg-");
    const pkgDir = makePackage(root, "0.0.7");
    expect(readPackageVersion(pkgDir)).toBe("0.0.7");
  });

  it("counts only exact image URL references for a version", () => {
    const markdown = [
      "![a](https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@0.0.2/data/img/card-feishu.png)",
      "![b](https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@0.0.2/data/img/qr-feishu.png)",
      "![c](https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@0.0.10/data/img/card-qq.png)",
      "![d](https://unpkg.com/" + PACKAGE_NAME + "@latest/data/manifest.json)",
    ].join("\n");
    expect(countVersionReferences(markdown, "0.0.2")).toBe(2);
    expect(countVersionReferences(markdown, "0.0.3")).toBe(0);
  });

  it("summarises README references across the five repositories", () => {
    const parent = makeTemp("release-repos-");
    makeReposFixture(parent, ["0.0.2"]);
    const summary = countReadmeReferences(parent, "0.0.2");
    expect(summary).toEqual({ total: 11, present: 11, urls: 11 });
    expect(countReadmeReferences(parent, "9.9.9")).toEqual({ total: 11, present: 0, urls: 0 });
  });
});

describe("runRelease", () => {
  it("dry run validates data and prints the plan without changing anything", async () => {
    const root = makeTemp("release-dry-");
    makePackage(root);
    const runner = makeRunner();
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, dryRun: true, deps });

    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.version).toBe("0.0.2");
    expect(report.steps.find((step) => step.name === "version")?.detail).toContain("would run");
    const commands = runner.calls.map((call) => call.args.join(" "));
    expect(commands).toContain("run data:check");
    expect(commands).not.toContain("run build:data");
    expect(commands.some((command) => command.startsWith("version "))).toBe(false);
    expect(commands.some((command) => command.startsWith("publish "))).toBe(false);
    expect(commands.some((command) => command.startsWith("pack "))).toBe(false);
    expect(runner.calls.some((call) => call.command === "git" && call.args[0] === "checkout")).toBe(false);
  });

  it("releases, waits for registry and CDN, then syncs the READMEs", async () => {
    const root = makeTemp("release-ok-");
    const pkgDir = makePackage(root);
    const reposDir = makeTemp("release-repos-");
    makeReposFixture(reposDir, ["0.0.1", "0.0.2"]);
    let published = false;
    const runner = makeRunner({
      registry: () => {
        if (!published) return "";
        return "0.0.2";
      },
    });
    const baseRun = runner.run;
    const { deps } = makeDeps({
      run: async (command, args, options) => {
        if (command === "npm" && args[0] === "publish") published = true;
        return baseRun(command, args, options);
      },
    });

    const report = await runRelease({ rootDir: root, reposDir, deps });

    expect(report.ok).toBe(true);
    expect(report.rollback).toBe("not-needed");
    expect(report.version).toBe("0.0.2");
    expect(report.steps.map((step) => step.name)).toEqual([
      "preflight",
      "worktree",
      "contact",
      "data",
      "version",
      "typecheck",
      "test",
      "build",
      "pack",
      "publish",
      "registry",
      "jsdelivr",
      "unpkg",
      "npmmirror",
      "readme",
      "readme-check",
    ]);
    expect(report.timings.registry).toBeTypeOf("number");
    expect(report.steps.find((step) => step.name === "readme")?.detail).toContain("11/11");
    expect(report.steps.find((step) => step.name === "readme")?.detail).toContain("11 image URLs");

    const publish = runner.calls.find((call) => call.args[0] === "publish");
    expect(publish?.args).toEqual(["publish", join(pkgDir, PACKAGE_NAME + "-0.0.2.tgz"), "--tag", "latest"]);
    const versionCall = runner.calls.find((call) => call.args[0] === "version");
    expect(versionCall?.args).toEqual(["version", "0.0.2", "--no-git-tag-version"]);
    const check = runner.calls.filter((call) => call.args.includes("readme:sync") && call.args.includes("--check"));
    expect(check).toHaveLength(1);

    const reportPath = join(root, ".tmp", "release-0.0.2.json");
    const written = JSON.parse(readFileSync(reportPath, "utf8")) as { version: string; ok: boolean };
    expect(written.version).toBe("0.0.2");
    expect(written.ok).toBe(true);
  });

  it("runs contact:update first when --image is given", async () => {
    const root = makeTemp("release-image-");
    const pkgDir = makePackage(root);
    const image = join(root, "new-wechat.png");
    const runner = makeRunner({ registry: () => "0.0.2" });
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, imagePath: image, group: "wechat", deps, skipPublish: true });

    expect(report.ok).toBe(true);
    expect(report.steps.find((step) => step.name === "contact")?.detail).toContain("contact sources refreshed");
    const contact = runner.calls.find((call) => call.args[1] === "contact-update");
    expect(contact?.command).toBe(process.execPath);
    expect(contact?.args).toEqual([
      join(pkgDir, "scripts", "run-ts.mjs"),
      "contact-update",
      image,
      "--confirmed",
      "--no-build",
      "--group",
      "wechat",
    ]);
    const names = runner.calls.map((call) => call.args[1] ?? call.args[0]);
    expect(names.indexOf("contact-update")).toBeLessThan(names.indexOf("build:data"));
  });

  it("validates the new image without writing when --dry-run and --image are combined", async () => {
    const root = makeTemp("release-image-dry-");
    makePackage(root);
    const image = join(root, "new-wechat.png");
    const runner = makeRunner();
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, imagePath: image, dryRun: true, deps });

    expect(report.ok).toBe(true);
    const contact = runner.calls.find((call) => call.args[1] === "contact-update");
    expect(contact?.args).toContain("--dry-run");
    expect(report.steps.find((step) => step.name === "contact")?.detail).toContain("nothing written");
    expect(runner.calls.some((call) => call.command === "git" && call.args[0] === "clean")).toBe(false);
  });

  it("rolls back contact sources when contact:update fails", async () => {
    const root = makeTemp("release-image-fail-");
    makePackage(root);
    const image = join(root, "new-wechat.png");
    const runner = makeRunner({
      failCommand: (command, args) => command === process.execPath && args[1] === "contact-update",
    });
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, imagePath: image, deps });

    expect(report.ok).toBe(false);
    expect(report.rollback).toBe("rolled-back");
    expect(report.steps.find((step) => step.name === "contact")?.ok).toBe(false);
    expect(runner.calls.some((call) => call.args[0] === "publish")).toBe(false);
    expect(
      runner.calls.some((call) => call.command === "git" && call.args.join(" ") === "clean -fdq -- contact"),
    ).toBe(true);
  });

  it("refuses to start on a dirty working tree", async () => {
    const root = makeTemp("release-dirty-");
    makePackage(root);
    const runner = makeRunner();
    const { deps } = makeDeps({
      run: async (command, args, options) => {
        if (command === "git" && args[0] === "status") return { code: 0, stdout: " M contact/groups.json\n", stderr: "" };
        return runner.run(command, args, options);
      },
    });
    const report = await runRelease({ rootDir: root, deps });

    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.rollback).toBe("not-needed");
    expect(report.steps.find((step) => step.name === "worktree")?.ok).toBe(false);
    expect(runner.calls.some((call) => call.args[0] === "version")).toBe(false);
  });

  it("rolls the working tree back when a gate fails before publishing", async () => {
    const root = makeTemp("release-gate-");
    makePackage(root);
    const runner = makeRunner({
      failCommand: (command, args) => command === "npm" && args[0] === "run" && args[1] === "typecheck",
    });
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, deps });

    expect(report.ok).toBe(false);
    expect(report.rollback).toBe("rolled-back");
    expect(report.steps.find((step) => step.name === "typecheck")?.ok).toBe(false);
    expect(runner.calls.some((call) => call.args[0] === "publish")).toBe(false);
    const restored = runner.calls
      .filter((call) => call.command === "git" && call.args[0] === "checkout")
      .map((call) => call.args[2]);
    expect(restored).toEqual([...RELEASE_PATHS]);
  });

  it("rolls back when the publish fails and the registry never shows the version", async () => {
    const root = makeTemp("release-publish-fail-");
    makePackage(root);
    const runner = makeRunner({
      failCommand: (command, args) => command === "npm" && args[0] === "publish",
      registry: () => "",
    });
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, deps, registryTimeoutMs: 100, pollIntervalMs: 10 });

    expect(report.ok).toBe(false);
    expect(report.rollback).toBe("rolled-back");
    expect(report.steps.find((step) => step.name === "publish")?.ok).toBe(false);
    expect(runner.calls.some((call) => call.command === "git" && call.args[0] === "checkout")).toBe(true);
  });

  it("treats a failed npm publish as success when the registry already shows the version", async () => {
    const root = makeTemp("release-publish-flaky-");
    makePackage(root);
    const runner = makeRunner({
      failCommand: (command, args) => command === "npm" && args[0] === "publish",
      registry: () => "0.0.2",
    });
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, deps });

    expect(report.ok).toBe(true);
    expect(report.steps.find((step) => step.name === "publish")?.detail).toContain("visible in the registry");
  });

  it("fails with a manual rollback when the registry never lists the version", async () => {
    const root = makeTemp("release-registry-timeout-");
    makePackage(root);
    const runner = makeRunner({ registry: () => "" });
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, deps, registryTimeoutMs: 60, pollIntervalMs: 10 });

    expect(report.ok).toBe(false);
    expect(report.rollback).toBe("manual");
    expect(report.steps.find((step) => step.name === "registry")?.ok).toBe(false);
    expect(report.steps.some((step) => step.name === "readme")).toBe(false);
  });

  it("fails when the required jsDelivr channel never serves the new manifest", async () => {
    const root = makeTemp("release-channel-timeout-");
    makePackage(root);
    const runner = makeRunner({ registry: () => "0.0.2" });
    const failingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const { deps } = makeDeps({ run: runner.run, fetchImpl: failingFetch });
    const report = await runRelease({
      rootDir: root,
      deps,
      channelTimeoutMs: 50,
      pollIntervalMs: 10,
    });

    expect(report.ok).toBe(false);
    expect(report.rollback).toBe("manual");
    expect(report.steps.find((step) => step.name === "jsdelivr")?.ok).toBe(false);
    expect(report.steps.find((step) => step.name === "unpkg")?.ok).toBe(true);
    expect(report.steps.find((step) => step.name === "unpkg")?.detail).toContain("best effort");
  });

  it("reports a non-matching manifest as a channel status, not as success", async () => {
    const root = makeTemp("release-channel-version-");
    makePackage(root);
    const runner = makeRunner({ registry: () => "0.0.2" });
    const staleFetch = manifestFetch("0.0.1");
    const { deps } = makeDeps({ run: runner.run, fetchImpl: staleFetch });
    const report = await runRelease({ rootDir: root, deps, channelTimeoutMs: 40, pollIntervalMs: 10 });

    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.name === "jsdelivr")?.detail).toContain("version 0.0.1");
  });

  it("skip-publish packs and gates locally without touching npm", async () => {
    const root = makeTemp("release-skip-publish-");
    makePackage(root);
    const runner = makeRunner();
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, deps, skipPublish: true });

    expect(report.ok).toBe(true);
    expect(report.steps.find((step) => step.name === "publish")?.detail).toContain("skipped");
    expect(runner.calls.some((call) => call.args[0] === "publish")).toBe(false);
    expect(runner.calls.some((call) => call.args[0] === "view")).toBe(false);
  });

  it("skip-tests keeps typecheck and build but drops the test run", async () => {
    const root = makeTemp("release-skip-tests-");
    makePackage(root);
    const runner = makeRunner();
    const { deps } = makeDeps({ run: runner.run });
    const report = await runRelease({ rootDir: root, deps, skipPublish: true, skipTests: true });

    expect(report.ok).toBe(true);
    expect(report.steps.find((step) => step.name === "test")).toBeUndefined();
    expect(runner.calls.some((call) => call.args.join(" ") === "run test")).toBe(false);
    expect(runner.calls.some((call) => call.args.join(" ") === "run typecheck")).toBe(true);
  });
});