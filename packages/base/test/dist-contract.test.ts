import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distFile = (relativePath: string): string => resolve(pkgRoot, "dist", relativePath);

function readDist(relativePath: string): string {
  return readFileSync(distFile(relativePath), "utf8");
}

/** Every module specifier the bundle imports (static `from` or bare import). */
function importedSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
    if (match[1]) specs.add(match[1]);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    if (match[1]) specs.add(match[1]);
  }
  return [...specs];
}

describe("package entries", () => {
  it("exposes ./core, ./client and ./node", () => {
    const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8")) as {
      exports: Record<string, { types?: string; import?: string }>;
    };
    for (const entry of ["./core", "./client", "./node"] as const) {
      const mapping = pkg.exports[entry];
      expect(mapping, `${entry} missing from exports`).toBeTruthy();
      expect(existsSync(resolve(pkgRoot, mapping.import ?? ""))).toBe(true);
      expect(existsSync(resolve(pkgRoot, mapping.types ?? ""))).toBe(true);
    }
  });

  it("ships dist, data, README and LICENSE in the packlist", () => {
    const raw = execSync("npm pack --dry-run --json", {
      cwd: pkgRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
    const paths = new Set((parsed[0]?.files ?? []).map((file) => file.path));
    for (const required of [
      "dist/core/index.js",
      "dist/client/index.js",
      "dist/node/index.js",
      "dist/node/cli.js",
      "dist/core/index.d.ts",
      "data/manifest.json",
      "README.md",
      "LICENSE",
    ]) {
      expect(paths.has(required), `${required} missing from packlist`).toBe(true);
    }
  });
});

describe("client bundle contract", () => {
  it("contains no static import, require, dynamic import or top-level await", () => {
    const source = readDist("client/index.js");
    expect(source).not.toMatch(/(^|\n)\s*import\b/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/(^|\n)\s*await\b/);
    expect(importedSpecifiers(source)).toEqual([]);
  });

  it("imports as a single self-contained module", async () => {
    const mod = (await import(pathToFileURL(distFile("client/index.js")).href)) as {
      createBaseUI?: unknown;
    };
    expect(typeof mod.createBaseUI).toBe("function");
  });
});

describe("core and node entries", () => {
  it("imports the core entry", async () => {
    const mod = (await import(pathToFileURL(distFile("core/index.js")).href)) as {
      parseManifest?: unknown;
      BASELINE?: { manifest?: { groups?: unknown[] } };
    };
    expect(typeof mod.parseManifest).toBe("function");
    expect(mod.BASELINE?.manifest?.groups?.length).toBeGreaterThan(0);
  });

  it("node bundle only imports node: builtins", async () => {
    const source = readDist("node/index.js");
    const specs = importedSpecifiers(source);
    for (const spec of specs) expect(spec.startsWith("node:")).toBe(true);
    const mod = (await import(pathToFileURL(distFile("node/index.js")).href)) as {
      renderContactBlock?: unknown;
    };
    expect(typeof mod.renderContactBlock).toBe("function");
  });

  it("ships an executable CLI with a shebang", () => {
    const source = readDist("node/cli.js");
    expect(source.startsWith("#!/usr/bin/env node")).toBe(true);
    const help = execFileSync(process.execPath, [distFile("node/cli.js"), "--help"], {
      encoding: "utf8",
    });
    expect(help).toContain("readme:sync");
    expect(help).toContain("contact:update");
    expect(help).toContain("doctor");
  });
});

describe("published data", () => {
  it("ships a valid placeholder manifest", async () => {
    const raw = JSON.parse(readFileSync(resolve(pkgRoot, "data/manifest.json"), "utf8")) as unknown;
    const mod = (await import(pathToFileURL(distFile("core/index.js")).href)) as {
      parseManifest: (value: unknown) => { groups: unknown[]; plugins: unknown[] };
    };
    const manifest = mod.parseManifest(raw);
    expect(manifest.groups.length).toBeGreaterThanOrEqual(3);
    expect(manifest.plugins.length).toBeGreaterThanOrEqual(5);
  });
});
