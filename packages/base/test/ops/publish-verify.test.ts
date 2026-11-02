/**
 * Offline behaviour of the post-publish tarball verification (ticket 05).
 *
 * base-release.mjs --skip-publish is the entry point the publish workflow calls.
 * These cases drive it across the process boundary against a synthetic git repo
 * and a local HTTP registry: no network, no npm login, no mocked internals.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  initGitRepo,
  makeTempDir,
  removeTempDir,
  runOps,
  writeFiles,
  type OpsRunResult,
} from "./support/ops-fixtures";

const PKG = "dsh-featherhunter-plugin-base";
const VERSION = "9.9.9";
const CAPABILITY = "capability real-machine-verification (schema 1)";
const MARKERS = ["prepareHome", "findWriteUnderRealHome", "candidate-identity", "runReleaseGate"] as const;
const TARBALL_ROUTE = "/" + PKG + "/-/" + PKG + "-" + VERSION + ".tgz";

interface VerifyReport {
  ok: boolean;
  mode: string;
  version: string;
  error?: string;
  dist?: { shasum: string | null; integrity: string | null; tarball: string | null };
  download?: { path: string; bytes: number; sha1: string; sha256: string; sha512: string };
  package?: { name: string; version: string };
  entry?: { bytes: number; sha256: string; markers: Record<string, boolean> };
  cli?: { exitCode: number; version: string | null; capability: string | null };
  docs?: Array<{ path: string; exists: boolean; bytes: number }>;
}

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) removeTempDir(dir);
});

function sha1(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function sha512Base64(buf: Buffer): string {
  return createHash("sha512").update(buf).digest("base64");
}

/** Source of the tarball dist entry: it must carry the four release markers. */
function distEntrySource(): string {
  return [
    "// synthetic dist entry for the publish-verification fixture",
    ...MARKERS.map((marker) => "export function " + marker.replace(/-/g, "_") + "() { return " + JSON.stringify(marker) + "; }"),
    "",
  ].join("\n");
}

const EXPECTED_MARKERS: Record<string, boolean> = Object.fromEntries(MARKERS.map((marker) => [marker, true]));

/** Source of the tarball CLI: --version prints the version line then the capability line. */
function cliSource(): string {
  return [
    "#!/usr/bin/env node",
    "if (process.argv.includes('--version')) {",
    "  console.log('" + VERSION + "');",
    "  console.log('" + CAPABILITY + "');",
    "}",
    "",
  ].join("\n");
}

/** Build a synthetic npm tarball with the system tar and return its bytes. */
function buildTarball(root: string): Buffer {
  const stage = join(root, "stage");
  writeFiles(join(stage, "package"), {
    "package.json": JSON.stringify(
      { name: PKG, version: VERSION, files: ["dist", "data", "README.md", "LICENSE"] },
      null,
      2,
    ),
    "dist/real-machine-verification/index.js": distEntrySource(),
    "dist/real-machine-verification/cli/main.js": cliSource(),
    "dist/real-machine-verification/README.md": "# " + PKG + "\n",
    "dist/real-machine-verification/AGENTS-USAGE.md": "# self-service usage\n",
  });
  const archive = join(root, PKG + "-" + VERSION + ".tgz");
  const tar = spawnSync("tar", ["-czf", archive, "-C", stage, "package"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error("tar failed (" + tar.status + "): " + (tar.stderr || tar.stdout));
  return readFileSync(archive);
}

/** A git repo whose committed packages/base/package.json is the base manifest. */
function makeRepoFixture(root: string): { repo: string; download: string } {
  const repo = join(root, "repo");
  const git = initGitRepo(repo);
  writeFiles(repo, {
    "packages/base/package.json": JSON.stringify({ name: PKG, version: VERSION }, null, 2),
  });
  const added = git(["add", "-A"]);
  expect(added.code, "git add failed: " + added.stderr).toBe(0);
  const committed = git(["commit", "-m", "fixture: base package"]);
  expect(committed.code, "git commit failed: " + committed.stderr).toBe(0);
  // The verification resolves the manifest at --commit, so HEAD must carry it.
  const shown = git(["show", "HEAD:packages/base/package.json"]);
  expect(shown.code, "HEAD:packages/base/package.json is unreadable: " + shown.stderr).toBe(0);
  expect(JSON.parse(shown.stdout).version).toBe(VERSION);
  return { repo, download: join(root, "download") };
}

interface RegistrySpec {
  tarball: Buffer;
  /** Advertised sha1; defaults to the real digest of the tarball. */
  shasum?: string;
  /** Advertised sha512 base64; defaults to the real digest of the tarball. */
  integrity?: string;
  /** When false every request answers 404 (the version is not on the registry). */
  published?: boolean;
}

interface FakeRegistry {
  url: string;
  /** Request paths seen by the server, in order. */
  requests: string[];
  close: () => Promise<void>;
}

function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
}

async function startRegistry(spec: RegistrySpec): Promise<FakeRegistry> {
  const requests: string[] = [];
  let baseUrl = "";
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const route = request.url || "";
    requests.push(route);
    const notFound = (): void => {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
    };
    if (spec.published === false) {
      notFound();
      return;
    }
    if (route === "/" + PKG + "/" + VERSION) {
      const manifest = {
        name: PKG,
        "dist-tags": { latest: VERSION },
        versions: { [VERSION]: { name: PKG, version: VERSION } },
        dist: {
          shasum: spec.shasum ?? sha1(spec.tarball),
          integrity: spec.integrity ?? "sha512-" + sha512Base64(spec.tarball),
          tarball: baseUrl + TARBALL_ROUTE,
        },
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(manifest));
      return;
    }
    if (route === TARBALL_ROUTE) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(spec.tarball);
      return;
    }
    notFound();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  return { url: baseUrl, requests, close: () => stopServer(server) };
}

interface VerifyOptions {
  repo: string;
  download: string;
  registry: string;
  version?: string;
  keepDownload?: boolean;
}

/** Run the shared verification entry point exactly as the publish workflow does. */
async function verify(options: VerifyOptions): Promise<OpsRunResult> {
  const args = [
    "--skip-publish",
    "--version", options.version ?? VERSION,
    "--commit", "HEAD",
    "--repo", options.repo,
    "--registry", options.registry,
    "--download", options.download,
    "--no-log",
    "--json",
  ];
  if (options.keepDownload) args.push("--keep-download");
  return await runOps("scripts/ops/base-release.mjs", args, { timeoutMs: 120_000 });
}

function parseReport(run: OpsRunResult): VerifyReport {
  return JSON.parse(run.stdout) as VerifyReport;
}

describe("base-release --skip-publish verifies a published tarball", () => {
  it("verifies a good tarball end to end against a local registry (exit 0)", async () => {
    const root = tempDir("fh-publish-ok-");
    const { repo, download } = makeRepoFixture(root);
    const tarball = buildTarball(root);
    const registry = await startRegistry({ tarball });
    try {
      const run = await verify({ repo, download, registry: registry.url, keepDownload: true });

      expect(run.code, "stderr: " + run.stderr).toBe(0);
      const report = parseReport(run);
      expect(report.ok).toBe(true);
      expect(report.mode).toBe("verify");
      expect(report.version).toBe(VERSION);
      expect(report.error).toBeUndefined();

      expect(report.dist, "registry dist block").toBeDefined();
      expect(report.dist!.shasum).toBe(sha1(tarball));
      expect(report.dist!.integrity).toBe("sha512-" + sha512Base64(tarball));
      expect(report.dist!.tarball).toBe(registry.url + TARBALL_ROUTE);

      expect(report.download, "download evidence").toBeDefined();
      expect(report.download!.bytes).toBe(tarball.length);
      expect(report.download!.sha1).toBe(sha1(tarball));
      expect(report.download!.sha256).toBe(sha256(tarball));
      expect(existsSync(report.download!.path), "downloaded tarball is kept: " + report.download!.path).toBe(true);

      expect(report.package).toEqual({ name: PKG, version: VERSION, files: ["dist", "data", "README.md", "LICENSE"] });
      expect(report.entry!.markers).toEqual(EXPECTED_MARKERS);
      expect(report.entry!.bytes).toBeGreaterThan(0);

      expect(report.cli).toEqual({ exitCode: 0, version: VERSION, capability: CAPABILITY });
      expect(report.docs!.map((doc) => doc.path)).toEqual(["README.md", "AGENTS-USAGE.md"]);
      expect(report.docs!.every((doc) => doc.exists)).toBe(true);

      expect(registry.requests).toContain("/" + PKG + "/" + VERSION);
      expect(registry.requests).toContain(TARBALL_ROUTE);
    } finally {
      await registry.close();
    }
  }, 60_000);

  it("fails with exit 1 and a mismatch message when the advertised shasum is wrong", async () => {
    const root = tempDir("fh-publish-sha-");
    const { repo, download } = makeRepoFixture(root);
    const tarball = buildTarball(root);
    const registry = await startRegistry({ tarball, shasum: "0".repeat(40) });
    try {
      const run = await verify({ repo, download, registry: registry.url });

      expect(run.code, "stdout: " + run.stdout + " stderr: " + run.stderr).toBe(1);
      expect(run.stderr).toContain("mismatch");
      const report = parseReport(run);
      expect(report.ok).toBe(false);
      expect(report.error).toContain("shasum mismatch");
      expect(report.dist!.shasum).toBe("0".repeat(40));
    } finally {
      await registry.close();
    }
  }, 60_000);

  it("refuses a version that is not published (exit 2)", async () => {
    const root = tempDir("fh-publish-404-");
    const { repo, download } = makeRepoFixture(root);
    const tarball = buildTarball(root);
    const registry = await startRegistry({ tarball, published: false });
    try {
      const run = await verify({ repo, download, registry: registry.url });

      expect(run.code, "stdout: " + run.stdout + " stderr: " + run.stderr).toBe(2);
      expect(run.stdout.trim(), "prerequisite errors must not emit a JSON report").toBe("");
      expect(run.stderr).toContain(PKG + "@" + VERSION + " is not on the registry");
      expect(registry.requests).toContain("/" + PKG + "/" + VERSION);
    } finally {
      await registry.close();
    }
  }, 60_000);

  it("refuses a --version that does not match the committed package.json (exit 2)", async () => {
    const root = tempDir("fh-publish-version-");
    const { repo, download } = makeRepoFixture(root);

    // The mismatch is detected before the registry is contacted, so no server is needed.
    const run = await verify({ repo, download, registry: "http://127.0.0.1:1", version: "9.9.8" });

    expect(run.code, "stdout: " + run.stdout + " stderr: " + run.stderr).toBe(2);
    expect(run.stdout.trim(), "prerequisite errors must not emit a JSON report").toBe("");
    expect(run.stderr).toContain("has package.json version " + VERSION + ", expected 9.9.8");
    expect(existsSync(join(download, PKG + "-" + VERSION + ".tgz")), "nothing may be downloaded").toBe(false);
  }, 60_000);
});
