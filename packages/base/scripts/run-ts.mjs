// Dev-only runner: bundle a scripts/*.ts entry with esbuild (pngjs/jpeg-js stay
// external so they resolve from node_modules) and call its exported runCli().
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error("usage: node scripts/run-ts.mjs <script-name> [args...]");
  process.exit(2);
}
const entryFile = resolve(scriptDir, entry.endsWith(".ts") ? entry : `${entry}.ts`);
const outfile = resolve(scriptDir, "..", ".tmp", "scripts", `${entry.replace(/\.ts$/, "")}.mjs`);
mkdirSync(dirname(outfile), { recursive: true });
await build({
  entryPoints: [entryFile],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  external: ["pngjs", "jpeg-js", "esbuild"],
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outfile).href);
if (typeof mod.runCli !== "function") {
  console.error(`run-ts: ${entry} does not export runCli()`);
  process.exit(2);
}
process.exitCode = await mod.runCli(args);
