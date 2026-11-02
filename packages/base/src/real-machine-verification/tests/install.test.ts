/**
 * `install` is tested through its command entry with a real tarball fixture and
 * a fake filesystem. The assertions are the external contract: the extracted
 * tree, the five post-install checks, the JSON report and the exit codes.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseArgs } from "../cli/args";
import { runInstallCommand, type InstallCommandDeps } from "../cli/commands/install";
import { ok } from "../contracts/result";
import type { BinaryWriter } from "../runtime/platform/binary-writer";
import { joinFsPath, samePath } from "../runtime/paths";
import { makeTgz } from "./support/fake-freeze";
import { captureIo } from "./support/fake-capture";
import {
  createLaunchFixture,
  fixtureLoader,
  type LaunchFixture,
} from "./support/fake-launch";
import { buildProfile, declarationFixture } from "./support/fake-machine";

interface CheckJson {
  readonly id: string;
  readonly status: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
}

interface InstallJson {
  readonly schemaVersion: number;
  readonly command: string;
  readonly ok: boolean;
  readonly method?: string;
  readonly expectedSource?: string;
  readonly packageVersion?: string;
  readonly checks?: readonly CheckJson[];
  readonly error?: { readonly code: string; readonly message: string; readonly hint?: string; readonly stage?: string };
}

const TGZ_PATH = "C:\\fake\\repo\\fixture-plugin-0.1.0.tgz";

function tgzFor(bannerVersion = "0.1.0"): Uint8Array {
  return makeTgz({
    "package/package.json": JSON.stringify({
      name: "fixture-plugin",
      version: "0.1.0",
      main: "lib/client.js",
    }),
    "package/lib/client.js": `/*! fixture-plugin v${bannerVersion} */\nexport const client = true;\n`,
  });
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function candidateFor(tgz: Uint8Array): Record<string, unknown> {
  const packageJson = JSON.stringify({
    name: "fixture-plugin",
    version: "0.1.0",
    main: "lib/client.js",
  });
  const client = "/*! fixture-plugin v0.1.0 */\nexport const client = true;\n";
  return {
    schemaVersion: 2,
    generatedAt: "2026-11-01T20:00:00.000Z",
    tool: "dsh-verify",
    version: "0.1.5",
    validity: "development",
    sourceStable: true,
    git: { commit: "a".repeat(40), branch: "main", dirty: false, dirtyFiles: [] },
    package: {
      tgzPath: TGZ_PATH,
      tgzBytes: tgz.byteLength,
      tgzSha256: sha256Hex(Buffer.from(tgz).toString("binary")),
      filename: "fixture-plugin-0.1.0.tgz",
      files: [
        { path: "lib/client.js", bytes: client.length, sha256: sha256Hex(client) },
        { path: "package.json", bytes: packageJson.length, sha256: sha256Hex(packageJson) },
      ],
      fileCount: 2,
      fileDigest: "b".repeat(64),
      manifestDigest: "c".repeat(64),
    },
  };
}

function fixture(): LaunchFixture {
  return createLaunchFixture({
    declaration: declarationFixture({
      profile: buildProfile({
        packageName: "fixture-plugin",
        defaultProfile: "web",
        clientEntry: "lib/client.js",
      }),
    }),
  });
}

function binaryWriter(fake: LaunchFixture): BinaryWriter {
  return {
    async write(path, bytes) {
      fake.fs.seedFile(path, bytes);
      return ok({ bytes: bytes.byteLength });
    },
  };
}

async function run(
  fake: LaunchFixture,
  argv: readonly string[],
  extra: Partial<InstallCommandDeps> = {},
): Promise<{ readonly code: number; readonly out: string; readonly err: string }> {
  const capture = captureIo();
  const deps: InstallCommandDeps = {
    ports: fake.ports,
    io: capture.io,
    runtime: fake.runtime,
    loadDeclaration: fixtureLoader(fake),
    binaryWriter: binaryWriter(fake),
    ...extra,
  };
  const code = await runInstallCommand(parseArgs(argv), deps);
  return { code, out: capture.stdout(), err: capture.stderr() };
}

describe("install command", () => {
  it("extracts the tarball and reports every post-install check", async () => {
    const fake = fixture();
    fake.fs.seedFile(TGZ_PATH, tgzFor());

    const result = await run(fake, [
      "install",
      "--tgz",
      TGZ_PATH,
      "--work-root",
      fake.paths.workRoot,
      "--json",
    ]);

    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out) as InstallJson;
    expect(payload.ok).toBe(true);
    expect(payload.method).toBe("extract");
    expect(payload.expectedSource).toBe("tgz");
    expect(payload.packageVersion).toBe("0.1.0");
    expect(payload.checks?.map((check) => check.id)).toEqual([
      "package-installed",
      "package-version",
      "package-client-entry",
      "package-version-constant",
      "package-files",
    ]);
    expect(payload.checks?.every((check) => check.status === "pass")).toBe(true);

    const target = joinFsPath(fake.paths.profileDir, "node_modules", "fixture-plugin");
    const client = await fake.fs.readText(joinFsPath(target, "lib", "client.js"));
    expect(client.ok && client.value).toContain("/*! fixture-plugin v0.1.0 */");
    const dependency = await fake.fs.readJson(joinFsPath(fake.paths.profileDir, "package.json"));
    expect(dependency.ok).toBe(true);
    if (dependency.ok) {
      const value = dependency.value as { readonly dependencies?: Record<string, string> };
      expect(value.dependencies?.["fixture-plugin"]).toMatch(/^file:/);
    }
  });

  it("fails with exit 1 and expected/actual/hint when the version constant disagrees", async () => {
    const fake = fixture();
    fake.fs.seedFile(TGZ_PATH, tgzFor("9.9.9"));

    const result = await run(fake, ["install", "--tgz", TGZ_PATH, "--json"]);

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.out) as InstallJson;
    expect(payload.ok).toBe(false);
    const constant = payload.checks?.find((check) => check.id === "package-version-constant");
    expect(constant?.status).toBe("fail");
    expect(constant?.expected).toContain("fixture-plugin");
    expect(constant?.actual).toContain("9.9.9");
    expect(constant?.hint).toBeTruthy();
  });

  it("refuses a cross-drive cli install with exit 2 and points at extract", async () => {
    const fake = fixture();
    const crossDrive = "D:\\candidate\\fixture-plugin-0.1.0.tgz";
    fake.fs.seedFile(crossDrive, tgzFor());

    const result = await run(fake, ["install", "--tgz", crossDrive, "--method", "cli", "--json"]);

    expect(result.code).toBe(2);
    const payload = JSON.parse(result.out) as InstallJson;
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("unsupported");
    expect(payload.error?.message).toContain("across drives");
    expect(payload.error?.hint).toContain("--method extract");
  });

  it("verifies against a candidate manifest and names it as the expected source", async () => {
    const fake = fixture();
    const tgz = tgzFor();
    fake.fs.seedFile(TGZ_PATH, tgz);
    const candidateDir = "C:\\fake\\repo\\candidate";
    fake.fs.seedJson(candidateDir + "\\candidate.json", candidateFor(tgz));

    const result = await run(fake, [
      "install",
      "--tgz",
      TGZ_PATH,
      "--candidate",
      candidateDir,
      "--json",
    ]);

    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out) as InstallJson;
    expect(payload.expectedSource).toBe("candidate");
    expect(payload.checks?.every((check) => check.status === "pass")).toBe(true);
  });

  it("rejects an unknown method as a usage error with exit 2", async () => {
    const fake = fixture();
    const result = await run(fake, ["install", "--tgz", TGZ_PATH, "--method", "copy", "--json"]);
    expect(result.code).toBe(2);
    const payload = JSON.parse(result.out) as InstallJson;
    expect(payload.error?.stage).toBe("usage");
    expect(payload.error?.message).toContain("--method");
  });
});

describe("install --dry-run", () => {
  it("plans the extract without writing the profile or the package tree", async () => {
    const fake = fixture();
    const tgz = tgzFor();
    fake.fs.seedFile(TGZ_PATH, tgz);

    const result = await run(fake, ["install", "--tgz", TGZ_PATH, "--dry-run", "--json"]);

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.trim().split("\n")).toHaveLength(1);
    const payload = JSON.parse(result.out) as InstallJson & {
      readonly dryRun?: boolean;
      readonly plan?: {
        readonly tgzPath: string;
        readonly tgzSha256: string;
        readonly method: string;
        readonly targetDir: string;
        readonly expectedSource: string;
        readonly expectedFileCount: number;
        readonly expectedFiles: readonly { readonly path: string }[];
        readonly willReplaceExisting: boolean;
        readonly npmArgv: readonly string[] | null;
        readonly dependencySpec: string;
      };
    };
    expect(payload.dryRun).toBe(true);
    expect(payload.plan?.tgzPath).toBe(TGZ_PATH);
    expect(payload.plan?.tgzSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.plan?.method).toBe("extract");
    expect(payload.plan?.targetDir).toBe(joinFsPath(fake.paths.profileDir, "node_modules", "fixture-plugin"));
    expect(payload.plan?.expectedSource).toBe("tgz");
    expect(payload.plan?.expectedFileCount).toBe(2);
    expect(payload.plan?.expectedFiles.map((file) => file.path)).toEqual(["lib/client.js", "package.json"]);
    expect(payload.plan?.willReplaceExisting).toBe(false);
    expect(payload.plan?.npmArgv).toBeNull();
    expect(payload.plan?.dependencySpec.startsWith("file:")).toBe(true);

    expect(fake.fs.writes).toEqual([]);
    expect(await fake.fs.exists(joinFsPath(fake.paths.profileDir, "node_modules"))).toBe(false);
  });
});

describe("install: environment prerequisites", () => {
  it("reports an unreadable tarball as [not-found] and exits 2", async () => {
    const fake = fixture();
    const missing = "C:\\fake\\repo\\missing-plugin-0.1.0.tgz";
    const result = await run(fake, ["install", "--tgz", missing]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("[not-found]");
    expect(result.err).toContain("could not read tarball");
    expect(result.err).not.toContain("fail install");
  });

  it("warns when DSH_HOME is explicitly pointed at the real user home", async () => {
    const fake = fixture();
    fake.fs.seedFile(TGZ_PATH, tgzFor());
    fake.env.set("DSH_HOME", joinFsPath(fake.env.homeDir(), ".dsh"));
    const result = await run(fake, ["install", "--tgz", TGZ_PATH, "--dry-run", "--json"]);

    expect(result.code).toBe(0);
    expect(result.err).toContain("real user home");
  });

  it("refuses a real install into the real user home without writing", async () => {
    const fake = fixture();
    fake.fs.seedFile(TGZ_PATH, tgzFor());
    fake.env.set("DSH_HOME", joinFsPath(fake.env.homeDir(), ".dsh"));
    const realProfileDir = joinFsPath(fake.env.homeDir(), ".dsh", "profiles", "web");
    const result = await run(fake, ["install", "--tgz", TGZ_PATH, "--json"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("[prerequisite]");
    expect(result.err).toContain("refusing to install into the real DSH home");
    const payload = JSON.parse(result.out) as InstallJson;
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("prerequisite");
    expect(payload.error?.stage).toBe("prerequisite");
    expect(payload.error?.hint).toContain("DSH_HOME");
    expect(await fake.fs.exists(joinFsPath(realProfileDir, "node_modules"))).toBe(false);
  });

  it("refuses a DSH_HOME nested inside the real user home (the 2026-11-02 bypass)", async () => {
    const fake = fixture();
    fake.fs.seedFile(TGZ_PATH, tgzFor());
    const nested = joinFsPath(fake.env.homeDir(), ".dsh", "batch-home");
    fake.env.set("DSH_HOME", nested);
    const result = await run(fake, ["install", "--tgz", TGZ_PATH, "--json"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("refusing to install into the real DSH home");
    expect(result.err).toContain(nested);
    const payload = JSON.parse(result.out) as InstallJson;
    expect(payload.error?.code).toBe("prerequisite");
    expect(await fake.fs.exists(joinFsPath(nested, "profiles", "web", "node_modules"))).toBe(false);
  });

  it("refuses a DSH_HOME that is a link into the real user home", async () => {
    const fake = fixture();
    fake.fs.seedFile(TGZ_PATH, tgzFor());
    const realHome = joinFsPath(fake.env.homeDir(), ".dsh");
    const junction = "C:\\fake\\junction-home";
    const underlying = fake.fs.realPath.bind(fake.fs);
    fake.fs.realPath = async (path: string) => (samePath(path, junction) ? ok(realHome) : underlying(path));
    fake.env.set("DSH_HOME", junction);
    const result = await run(fake, ["install", "--tgz", TGZ_PATH, "--json"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain(`refusing to install into the real DSH home ${realHome}`);
    expect(await fake.fs.exists(joinFsPath(realHome, "profiles", "web", "node_modules"))).toBe(false);
  });
});
