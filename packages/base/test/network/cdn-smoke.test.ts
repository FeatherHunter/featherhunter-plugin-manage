/**
 * Manual network smoke test for ticket 02: verifies that a published version of
 * this package is actually reachable through the three CDN channels we rely on
 * (unpkg -> npmmirror -> jsDelivr) and that jsDelivr serves images with a long
 * cache lifetime.
 *
 * It is skipped by default so the regular test suite never depends on the
 * network. Run it after a real publish:
 *
 *   npm run test:network
 *   DSH_BASE_CDN_SMOKE=1 npx vitest run test/network/cdn-smoke.test.ts
 *
 * Optional env vars:
 *   DSH_BASE_CDN_SMOKE_TIMEOUT_MS  total polling deadline per channel (default 300000)
 *   DSH_BASE_CDN_SMOKE_POLL_MS     polling interval (default 5000)
 *   DSH_BASE_CDN_SMOKE_REPORT      path to write a JSON timing report (default: none)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseManifest } from "../../src/core/index";
import type { Manifest } from "../../src/core/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "../..");

const RUN = process.env.DSH_BASE_CDN_SMOKE === "1";
const DEADLINE_MS = Number(process.env.DSH_BASE_CDN_SMOKE_TIMEOUT_MS ?? 300_000);
const POLL_MS = Number(process.env.DSH_BASE_CDN_SMOKE_POLL_MS ?? 5_000);
const FETCH_TIMEOUT_MS = 15_000;

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
  name: string;
  version: string;
};
const PKG = pkg.name;
const VERSION = pkg.version;

interface ChannelResult {
  channel: string;
  url: string;
  elapsedMs: number;
  status: number;
  manifest: Manifest;
}

const timings: ChannelResult[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, {
    redirect: "follow",
    headers: { accept: "application/json,text/plain,*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function pollManifest(channel: string, url: string): Promise<ChannelResult> {
  const startedAt = Date.now();
  let lastFailure = "(no attempt)";
  while (Date.now() - startedAt < DEADLINE_MS) {
    try {
      const response = await fetchWithTimeout(url);
      const body = await response.text();
      if (response.status === 200) {
        try {
          const manifest = parseManifest(JSON.parse(body));
          const result: ChannelResult = {
            channel,
            url,
            elapsedMs: Date.now() - startedAt,
            status: response.status,
            manifest,
          };
          timings.push(result);
          return result;
        } catch (error) {
          lastFailure = `HTTP 200 but manifest invalid: ${(error as Error).message}`;
        }
      } else {
        lastFailure = `HTTP ${response.status}: ${body.slice(0, 200)}`;
      }
    } catch (error) {
      lastFailure = (error as Error).message;
    }
    await sleep(POLL_MS);
  }
  throw new Error(
    `${channel} did not serve ${PKG}@${VERSION} within ${DEADLINE_MS}ms; last failure: ${lastFailure}`,
  );
}

function writeTimingReport(): void {
  const reportPath = process.env.DSH_BASE_CDN_SMOKE_REPORT;
  if (!reportPath) return;
  const report = {
    package: PKG,
    version: VERSION,
    finishedAt: new Date().toISOString(),
    channels: timings.map((item) => ({
      channel: item.channel,
      url: item.url,
      status: item.status,
      elapsedMs: item.elapsedMs,
      manifestVersion: item.manifest.version,
    })),
  };
  const absolute = resolve(PACKAGE_ROOT, reportPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`[cdn-smoke] timing report written to ${absolute}`);
}

describe.skipIf(!RUN)("published package network smoke (ticket 02)", () => {
  it("npm view reports the published version and files", () => {
    const run = (args: string[]): string =>
      execFileSync("npm", args, {
        cwd: PACKAGE_ROOT,
        encoding: "utf8",
        timeout: 90_000,
        shell: process.platform === "win32",
      });

    const metadata = JSON.parse(run(["view", `${PKG}@${VERSION}`, "--json"])) as {
      version?: string;
      files?: string[];
    };
    expect(metadata.version).toBe(VERSION);
    expect(Array.isArray(metadata.files)).toBe(true);
    expect(metadata.files).toContain("data");
    expect(metadata.files).toContain("dist");
  });

  it("unpkg serves the @latest manifest", async () => {
    const result = await pollManifest("unpkg", `https://unpkg.com/${PKG}@latest/data/manifest.json`);
    expect(result.manifest.version).toBe(VERSION);
    expect(result.manifest.groups.length).toBeGreaterThanOrEqual(3);
    expect(result.manifest.plugins.length).toBeGreaterThanOrEqual(5);
  });

  it("npmmirror serves the @latest manifest", async () => {
    const result = await pollManifest(
      "npmmirror",
      `https://registry.npmmirror.com/${PKG}/latest/files/data/manifest.json`,
    );
    expect(result.manifest.version).toBe(VERSION);
  });

  it("jsDelivr serves the @latest manifest", async () => {
    const result = await pollManifest(
      "jsDelivr",
      `https://cdn.jsdelivr.net/npm/${PKG}@latest/data/manifest.json`,
    );
    expect(result.manifest.version).toBe(VERSION);
  });

  it("jsDelivr serves exact-version images with a long cache lifetime", async () => {
    const manifestResponse = await fetchWithTimeout(
      `https://cdn.jsdelivr.net/npm/${PKG}@${VERSION}/data/manifest.json`,
    );
    expect(manifestResponse.status).toBe(200);
    const manifest = parseManifest(await manifestResponse.json());
    const group = manifest.groups[0];
    expect(group).toBeDefined();

    const imageUrl = `https://cdn.jsdelivr.net/npm/${PKG}@${VERSION}/data/img/${group.card}`;
    const imageResponse = await fetchWithTimeout(imageUrl);
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type") ?? "").toMatch(/^image\//);
    const cacheControl = imageResponse.headers.get("cache-control") ?? "";
    const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? 0);
    expect(cacheControl === "" ? -1 : maxAge).toBeGreaterThanOrEqual(86_400);
  });

  it("records channel timings", () => {
    writeTimingReport();
    expect(timings.length).toBeGreaterThanOrEqual(3);
    console.log("[cdn-smoke] first-success timings:");
    for (const item of timings) {
      console.log(`  ${item.channel.padEnd(10)} ${String(item.elapsedMs).padStart(6)}ms  ${item.url}`);
    }
  });
});
