import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../src/core/types";
import { main } from "../src/node/cli";
import { MAX_COPY_AGE_DAYS, formatDoctorReport, runDoctor } from "../src/node/doctor";
import { readPackagedManifest } from "../src/node/targets";
import type { DoctorCheck, DoctorResult } from "../src/node/types";
import { buildFakeRepos, fakeReadmePath, initFakeRepos, type FakeRepos } from "./targets-helpers";

/** Capture stdout/stderr while main() runs. */
async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  const code = await main(argv);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

function checkNamed(result: DoctorResult, name: string): DoctorCheck {
  const check = result.checks.find((candidate) => candidate.name === name);
  expect(check, name).toBeDefined();
  return check!;
}

function cloneManifest(manifest: Manifest): Manifest {
  return JSON.parse(JSON.stringify(manifest)) as Manifest;
}

/** A fetch stand-in that serves one JSON body. */
function jsonFetch(body: string): typeof fetch {
  return (async () => ({ ok: true, status: 200, text: async () => body }) as unknown as Response) as typeof fetch;
}

let current: FakeRepos | undefined;

afterEach(() => {
  current?.cleanup();
  current = undefined;
  vi.restoreAllMocks();
});

describe("doctor core checks", () => {
  it("passes every check for an in-sync workspace (offline)", async () => {
    current = buildFakeRepos();
    initFakeRepos(current);
    const result = await runDoctor({
      reposDirs: [current.dir],
      offline: true,
      now: new Date("2026-10-31T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    expect(checkNamed(result, "package-version").ok).toBe(true);
    expect(checkNamed(result, "data-freshness").detail).toMatch(/matches package/);
    expect(checkNamed(result, "copy-freshness").ok).toBe(true);
    expect(checkNamed(result, "remote-manifest").detail).toBe("skipped: offline");

    for (const repo of ["dsh-mattpocock-skills-deck", "dsh-opencode-palette", "dsh-im-companion", "dsh-prompt", "ilife"]) {
      expect(checkNamed(result, repo + "/readme-blocks").ok, repo).toBe(true);
      expect(checkNamed(result, repo + "/readme-images").detail, repo).toMatch(/image URL\(s\) at @0\.0\.1/);
      expect(checkNamed(result, repo + "/dependency-version").detail, repo).toBe("pinned at 0.0.1");
      expect(checkNamed(result, repo + "/cron-mounts").ok, repo).toBe(true);
    }
    expect(checkNamed(result, "dsh-mattpocock-skills-deck/inline-bundle-version").detail).toBe("inlined v0.0.1");
    expect(checkNamed(result, "ilife/inline-bundle-version").detail).toBe("not inlined");
    expect(checkNamed(result, "ilife/cron-mounts").detail).toMatch(/with schedule/);
    expect(checkNamed(result, "dsh-prompt/cron-mounts").detail).toMatch(/mounted in star-history\.yml/);
  });

  it("flags stale recommendation copy and an old manifest", async () => {
    const manifest = readPackagedManifest();
    const stale = cloneManifest(manifest);
    stale.plugins[0]!.verifiedAt = "2026-01-01";
    const staleResult = await runDoctor({
      offline: true,
      manifest: stale,
      packageVersion: manifest.version,
      now: new Date("2026-10-31T00:00:00Z"),
    });
    const staleCheck = checkNamed(staleResult, "copy-freshness");
    expect(staleCheck.ok).toBe(false);
    expect(staleCheck.detail).toMatch(new RegExp("> " + MAX_COPY_AGE_DAYS + " days"));

    const freshResult = await runDoctor({
      offline: true,
      manifest: stale,
      packageVersion: manifest.version,
      now: new Date("2026-02-01T00:00:00Z"),
    });
    expect(checkNamed(freshResult, "copy-freshness").ok).toBe(true);
  });

  it("flags a manifest/package version mismatch and an invalid version", async () => {
    const manifest = readPackagedManifest();
    const mismatch = await runDoctor({ offline: true, manifest, packageVersion: "9.9.9" });
    const freshness = checkNamed(mismatch, "data-freshness");
    expect(freshness.ok).toBe(false);
    expect(freshness.detail).toMatch(/expected v9\.9\.9/);

    const invalid = await runDoctor({ offline: true, manifest, packageVersion: "1.0" });
    expect(checkNamed(invalid, "package-version").ok).toBe(false);
  });

  it("probes the CDN channels in fallback order", async () => {
    const manifest = readPackagedManifest();
    const body = JSON.stringify(manifest);
    const unpkg = await runDoctor({ manifest, packageVersion: manifest.version, fetchImpl: jsonFetch(body) });
    const check = checkNamed(unpkg, "remote-manifest");
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/^unpkg\.com @latest v/);
    expect(check.detail).toMatch(/matches package/);

    const urls: string[] = [];
    const fallback = (async (url: string) => {
      urls.push(url);
      if (urls.length === 1) throw new Error("boom");
      return { ok: true, status: 200, text: async () => body } as unknown as Response;
    }) as typeof fetch;
    const second = await runDoctor({ manifest, packageVersion: manifest.version, fetchImpl: fallback });
    expect(checkNamed(second, "remote-manifest").detail).toMatch(/^cdn\.jsdelivr\.net @latest v/);
    expect(urls).toHaveLength(2);

    const failing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const down = await runDoctor({ manifest, packageVersion: manifest.version, fetchImpl: failing });
    const downCheck = checkNamed(down, "remote-manifest");
    expect(downCheck.ok).toBe(false);
    expect(downCheck.detail).toMatch(/no CDN channel reachable/);
  });

  it("formats one CI-friendly line per check", () => {
    const report = formatDoctorReport({
      ok: false,
      checks: [
        { name: "package-version", ok: true, detail: "0.0.1" },
        { name: "data-freshness", ok: false, detail: "out of date" },
      ],
    });
    expect(report).toBe("ok    package-version  0.0.1\nfail  data-freshness  out of date");
    for (const line of report.split("\n")) expect(line).toMatch(/^(ok    |fail  )/);
  });
});

describe("doctor repository checks", () => {
  it("flags drifted README blocks", async () => {
    const repos = buildFakeRepos();
    current = repos;
    initFakeRepos(repos);
    const readmePath = fakeReadmePath(repos, "dsh-im-companion", "docs/README.en.md");
    writeFileSync(readmePath, readFileSync(readmePath, "utf8").replace("<!-- CONTACT-START -->", "<!-- CONTACT-START -->\n\nstray\n"));
    const result = await runDoctor({ repoRoots: [join(repos.dir, "dsh-im-companion")], offline: true });
    const check = checkNamed(result, "dsh-im-companion/readme-blocks");
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/out of date/);
  });

  it("flags image URLs that point at an older version", async () => {
    const repos = buildFakeRepos();
    current = repos;
    initFakeRepos(repos);
    const readmePath = fakeReadmePath(repos, "dsh-prompt");
    writeFileSync(readmePath, readFileSync(readmePath, "utf8").replaceAll("@0.0.1/data/img/", "@0.0.0/data/img/"));
    const result = await runDoctor({ repoRoots: [join(repos.dir, "dsh-prompt")], offline: true });
    const check = checkNamed(result, "dsh-prompt/readme-images");
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/references @0\.0\.0 \(expected @0\.0\.1\)/);
  });

  it("flags a dependency range instead of an exact version", async () => {
    const repos = buildFakeRepos();
    current = repos;
    initFakeRepos(repos);
    const packagePath = join(repos.dir, "dsh-prompt", "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { dependencies: Record<string, string> };
    pkg.dependencies["dsh-featherhunter-plugin-base"] = "^0.0.1";
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
    const result = await runDoctor({ repoRoots: [join(repos.dir, "dsh-prompt")], offline: true });
    const check = checkNamed(result, "dsh-prompt/dependency-version");
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/declares \^0\.0\.1/);
  });

  it("flags a stale inlined client bundle", async () => {
    const repos = buildFakeRepos();
    current = repos;
    initFakeRepos(repos);
    const bundlePath = join(repos.dir, "dsh-mattpocock-skills-deck", "src", "base-client.ts");
    writeFileSync(bundlePath, "/*! dsh-featherhunter-plugin-base v0.0.0 */\nexport {};\n");
    const result = await runDoctor({ repoRoots: [join(repos.dir, "dsh-mattpocock-skills-deck")], offline: true });
    const check = checkNamed(result, "dsh-mattpocock-skills-deck/inline-bundle-version");
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/inlined v0\.0\.0/);
  });

  it("fails star-assets when a repository has not generated its charts yet (ilife)", async () => {
    const repos = buildFakeRepos();
    current = repos;
    initFakeRepos(repos);
    rmSync(join(repos.dir, "ilife", "docs", "star-history-dark.svg"));
    rmSync(join(repos.dir, "ilife", "docs", "star-history-light.svg"));

    const result = await runDoctor({ repoRoots: [join(repos.dir, "ilife")], offline: true });
    const check = checkNamed(result, "ilife/star-assets");
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/missing docs\/star-history-dark\.svg/);
    expect(check.detail).toMatch(/docs\/handover\/02/);
    expect(result.ok).toBe(false);
  });

  it("flags a missing workflow mount and an unscheduled ilife workflow", async () => {
    const repos = buildFakeRepos();
    current = repos;
    initFakeRepos(repos);
    rmSync(join(repos.dir, "dsh-prompt", ".github"), { recursive: true, force: true });
    const missing = await runDoctor({ repoRoots: [join(repos.dir, "dsh-prompt")], offline: true });
    const missingCheck = checkNamed(missing, "dsh-prompt/cron-mounts");
    expect(missingCheck.ok).toBe(false);
    expect(missingCheck.detail).toMatch(/no readme:sync step/);

    const workflowPath = join(repos.dir, "ilife", ".github", "workflows", "ci.yml");
    writeFileSync(
      workflowPath,
      "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  sync:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx dsh-featherhunter-plugin-base@0.0.1 readme:sync --all\n",
    );
    const unscheduled = await runDoctor({ repoRoots: [join(repos.dir, "ilife")], offline: true });
    const unscheduledCheck = checkNamed(unscheduled, "ilife/cron-mounts");
    expect(unscheduledCheck.ok).toBe(false);
    expect(unscheduledCheck.detail).toMatch(/no schedule: trigger/);
  });
});

describe("doctor CLI", () => {
  it("prints a machine-readable report with --json and exits 0 when healthy", async () => {
    current = buildFakeRepos();
    initFakeRepos(current);
    const result = await run(["doctor", join(current.dir, "dsh-prompt"), "--offline", "--json"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as DoctorResult;
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.map((check) => check.name)).toContain("dsh-prompt/readme-blocks");
  });

  it("checks every managed repository under --repos", async () => {
    current = buildFakeRepos();
    initFakeRepos(current);
    const result = await run(["doctor", "--repos", current.dir, "--offline", "--json"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as DoctorResult;
    for (const repo of ["dsh-mattpocock-skills-deck", "dsh-opencode-palette", "dsh-im-companion", "dsh-prompt", "ilife"]) {
      expect(parsed.checks.map((check) => check.name)).toContain(repo + "/readme-blocks");
    }
  });

  it("exits 1 and names the failing checks in text mode", async () => {
    current = buildFakeRepos();
    initFakeRepos(current);
    const packagePath = join(current.dir, "dsh-prompt", "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { dependencies: Record<string, string> };
    pkg.dependencies["dsh-featherhunter-plugin-base"] = "0.0.0";
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2));

    const result = await run(["doctor", join(current.dir, "dsh-prompt"), "--offline"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^fail  dsh-prompt\/dependency-version/m);
    expect(result.stderr).toMatch(/doctor found 1 failing check\(s\)/);
  });

  it("rejects an unknown repository directory and an empty invocation", async () => {
    current = buildFakeRepos();
    const unknown = await run(["doctor", join(current.dir, "not-a-repo"), "--offline"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toMatch(/not a managed repository directory/);

    const empty = await run(["doctor"]);
    expect(empty.code).toBe(2);
    expect(empty.stderr).toMatch(/no managed repository found here/);
  });
});