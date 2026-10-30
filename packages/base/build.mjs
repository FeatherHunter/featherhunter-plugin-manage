import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const withDemo = process.argv.includes("--demo");

rmSync(dist, { recursive: true, force: true });

/** Shared esbuild options for the three published entries. */
const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
};

await build({
  ...shared,
  platform: "neutral",
  entryPoints: { "core/index": resolve(root, "src/core/index.ts") },
  outdir: dist,
});

await build({
  ...shared,
  platform: "neutral",
  entryPoints: { "client/index": resolve(root, "src/client/index.ts") },
  outdir: dist,
});

await build({
  ...shared,
  platform: "node",
  entryPoints: { "node/index": resolve(root, "src/node/index.ts") },
  outdir: dist,
});

await build({
  ...shared,
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
  entryPoints: { "node/cli": resolve(root, "src/node/cli.ts") },
  outdir: dist,
});

// Declarations: tsc --emitDeclarationOnly keeps the public surface typed
// without asking esbuild to do something it cannot.
execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", resolve(root, "tsconfig.build.json")], {
  cwd: root,
  stdio: "inherit",
});

// Hard contract: the client entry is a single self-contained module.
const clientBundle = readFileSync(resolve(dist, "client/index.js"), "utf8");
const clientViolations = [
  ["static import", /(^|\n)\s*import\b/],
  ["require()", /\brequire\s*\(/],
  ["dynamic import()", /\bimport\s*\(/],
].filter(([, pattern]) => pattern.test(clientBundle));
if (clientViolations.length > 0) {
  throw new Error(
    `client bundle must stay self-contained; found ${clientViolations.map(([name]) => name).join(", ")}`,
  );
}

// Hard contract: the node entry may only import node: builtins.
const nodeBundle = readFileSync(resolve(dist, "node/index.js"), "utf8");
const imported = new Set();
for (const match of nodeBundle.matchAll(/\bfrom\s*["']([^"']+)["']/g)) imported.add(match[1]);
for (const match of nodeBundle.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) imported.add(match[1]);
for (const specifier of imported) {
  if (!specifier.startsWith("node:")) {
    throw new Error(`node bundle imports "${specifier}" — only node: builtins are allowed`);
  }
}

if (withDemo) {
  await build({
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    entryPoints: [resolve(root, "demo/main.tsx")],
    outfile: resolve(root, "demo/dist/demo.js"),
    logLevel: "warning",
  });
}

console.log("build ok:", ["core", "client", "node"].join(", ") + (withDemo ? ", demo" : ""));
