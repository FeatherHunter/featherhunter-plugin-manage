#!/usr/bin/env node
/**
 * Runs the manual CDN smoke test (test/network/cdn-smoke.test.ts) with network
 * access enabled. Kept out of the default test suite on purpose: it requires a
 * real published version and a working network path to unpkg / npmmirror /
 * jsDelivr.
 *
 * Usage (from packages/base):
 *   npm run test:network
 *   npm run test:network -- --reporter=verbose
 *   DSH_BASE_CDN_SMOKE_TIMEOUT_MS=600000 npm run test:network
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitestBin = join(packageRoot, "node_modules", "vitest", "vitest.mjs");
const passthrough = process.argv.slice(2);
const args = passthrough.length > 0 ? passthrough : ["run", "test/network/cdn-smoke.test.ts"];

const result = spawnSync(process.execPath, [vitestBin, ...args], {
  cwd: packageRoot,
  stdio: "inherit",
  env: { ...process.env, DSH_BASE_CDN_SMOKE: "1" },
});

if (result.error) {
  console.error("[cdn-smoke] failed to start vitest:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
