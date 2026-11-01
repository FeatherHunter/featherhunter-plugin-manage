/**
 * Build pipeline for the published entries of `dsh-featherhunter-plugin-base`.
 *
 * Two hard contracts are enforced here, because they are what makes the package
 * safe to inline into other repositories:
 *
 * - `client/index` must stay a single self-contained module (plugins inline it).
 * - every `platform: "node"` bundle may only import `node:` builtins, which is
 *   what keeps one plugin from dragging a dependency into another plugin's host.
 *
 * The JavaScript version of this file lived at `build.mjs`; it was rewritten as
 * TypeScript before being extended (the repository rule is "touch it as TS"), so
 * the entry table below is the only place that knows how many bundles exist.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { assertBundleContract, type BundleContract } from "./bundle-contract";

/** The package this pipeline builds; used to reject the wrong working directory. */
const PACKAGE_NAME = "dsh-featherhunter-plugin-base";
const DIST_DIR = "dist";

interface EntrySpec {
  /** Output path under `dist`, without the `.js` extension. */
  readonly id: string;
  /** Source entry point, relative to the package root. */
  readonly entry: string;
  readonly platform: "neutral" | "node";
  readonly contract: BundleContract;
  /** `package`: version banner the doctor command greps for. `shebang`: CLI. */
  readonly banner?: "package" | "shebang";
}

/**
 * Every published entry point. Adding a bundle means adding one row here plus
 * the matching `exports`/`bin` record in `package.json` — nothing else.
 */
const ENTRIES: readonly EntrySpec[] = [
  { id: "core/index", entry: "src/core/index.ts", platform: "neutral", contract: "self-contained" },
  {
    id: "client/index",
    entry: "src/client/index.ts",
    platform: "neutral",
    contract: "self-contained",
    banner: "package",
  },
  {
    id: "node/index",
    entry: "src/node/index.ts",
    platform: "node",
    contract: "node-builtins",
    banner: "package",
  },
  {
    id: "node/cli",
    entry: "src/node/cli.ts",
    platform: "node",
    contract: "node-builtins",
    banner: "shebang",
  },
  {
    id: "real-machine-verification/index",
    entry: "src/real-machine-verification/index.ts",
    platform: "node",
    contract: "node-builtins",
    banner: "package",
  },
  {
    id: "real-machine-verification/cli/main",
    entry: "src/real-machine-verification/cli/main.ts",
    platform: "node",
    contract: "node-builtins",
    banner: "shebang",
  },
];

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
}

/** Read and structurally check `package.json` at `root`. */
function readManifest(root: string): Required<Pick<PackageManifest, "name" | "version">> {
  const path = resolve(root, "package.json");
  if (!existsSync(path)) throw new Error(`${path} not found; run this from the base package root`);
  const manifest = JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`${path} has no "name"`);
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${path} has no "version"`);
  }
  if (manifest.name !== PACKAGE_NAME) {
    throw new Error(`${path} is ${manifest.name}, expected ${PACKAGE_NAME}`);
  }
  return { name: manifest.name, version: manifest.version };
}

/**
 * Locate the package root without depending on how this file was launched.
 *
 * `scripts/run-ts.mjs` bundles us into `<root>/.tmp/scripts/`, so `import.meta.url`
 * points there and the package root is two levels up; running the file directly
 * puts us in `<root>/scripts/`. The manifest check is the tie-breaker, and a
 * wrong working directory produces an actionable error instead of a half build.
 */
function resolvePackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env["DSH_BASE_ROOT"],
    process.cwd(),
    resolve(here, "..", ".."),
    resolve(here, ".."),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const manifestPath = resolve(candidate, "package.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
      if (manifest.name === PACKAGE_NAME) return resolve(candidate);
    } catch {
      // A malformed package.json elsewhere on the walk is not our problem.
    }
  }
  throw new Error(
    `cannot find the ${PACKAGE_NAME} package root; run "npm run build" inside packages/base`,
  );
}

/** esbuild options shared by every bundle (unchanged from the JavaScript version). */
function sharedOptions() {
  return {
    bundle: true,
    format: "esm",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
  } as const;
}

/** Fail the build when a finished bundle breaks its contract (rules live in ./bundle-contract). */
function assertEveryBundle(distRoot: string): void {
  for (const spec of ENTRIES) {
    const file = resolve(distRoot, `${spec.id}.js`);
    assertBundleContract(spec.id, readFileSync(file, "utf8"), spec.contract);
  }
}

/** Emit `.d.ts` next to every bundle (esbuild cannot do this; tsc can). */
function emitDeclarations(root: string): void {
  const tsc = resolve(root, "node_modules/typescript/bin/tsc");
  if (!existsSync(tsc)) throw new Error(`${tsc} not found; run "npm install" in packages/base first`);
  execFileSync(process.execPath, [tsc, "-p", resolve(root, "tsconfig.build.json")], {
    cwd: root,
    stdio: "inherit",
  });
}

/** Optional browser demo bundle (`--demo`). */
async function buildDemo(root: string): Promise<void> {
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

/** Build every entry. Throws on the first contract violation. */
export async function run(argv: readonly string[]): Promise<void> {
  const root = resolvePackageRoot();
  const manifest = readManifest(root);
  const distRoot = resolve(root, DIST_DIR);
  const withDemo = argv.includes("--demo");
  const packageBanner = { js: `/*! ${manifest.name} v${manifest.version} */` };

  rmSync(distRoot, { recursive: true, force: true });

  const shared = sharedOptions();
  for (const spec of ENTRIES) {
    const banner =
      spec.banner === "shebang" ? { js: "#!/usr/bin/env node" } : spec.banner === "package" ? packageBanner : undefined;
    await build({
      ...shared,
      platform: spec.platform,
      entryPoints: { [spec.id]: resolve(root, spec.entry) },
      outdir: distRoot,
      ...(banner === undefined ? {} : { banner }),
    });
  }

  emitDeclarations(root);
  assertEveryBundle(distRoot);

  if (withDemo) await buildDemo(root);

  const names = ENTRIES.map((spec) => spec.id);
  console.log(`build ok: ${names.join(", ")}${withDemo ? ", demo" : ""}`);
}

/** Entry point used by `node scripts/run-ts.mjs build`. */
export async function runCli(args: readonly string[]): Promise<number> {
  try {
    await run(args);
    return 0;
  } catch (error) {
    console.error(`build failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
