/**
 * Ticket 03 — the contact data chain.
 *
 *   contact/groups.json + crops.json + plugins.json + src/card-* + src/qr-*
 *     -> data/manifest.json + data/img/* + src/core/baseline.ts
 *
 * and `contact:update` (weekly WeChat refresh) on top of it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "../src/core/index";
import type { Group } from "../src/core/types";
import {
  BUNDLED_PLATFORMS,
  QR_BASE64_BUDGET,
  QR_SIZE,
  buildBaseline,
  buildManifest,
  generateData,
  publishedName,
  validateCropsSource,
  validateGroupsSource,
  validatePluginsSource,
} from "../scripts/build-data";
import {
  STALE_DAYS,
  VALID_DAYS,
  lineDiff,
  updateContact,
} from "../scripts/contact-update";
import { decodeImage, encodeTruecolorPng } from "../scripts/png";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..");

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function realGroups(): any {
  return readJson(join(REPO_ROOT, "contact", "groups.json"));
}

function realPlugins(): any {
  return readJson(join(REPO_ROOT, "contact", "plugins.json"));
}

/**
 * 900x1600 card screenshot with a synthetic QR symbol (three finder patterns
 * plus a checkerboard data area) inside the crop box, so the geometry gate in
 * contact:update and build-data can be exercised without real screenshots.
 */
export function makeQrCard(
  options: { blank?: boolean; box?: { x: number; y: number; size: number }; modules?: number; offset?: number } = {},
): Buffer {
  const width = 900;
  const height = 1600;
  const data = new Uint8Array(width * height * 4).fill(255);
  if (!options.blank) {
    const box = options.box ?? { x: 141, y: 582, size: 620 };
    const modules = options.modules ?? 25;
    const moduleSize = Math.floor(box.size / (modules + 8));
    const margin = Math.round((box.size - modules * moduleSize) / 2) + (options.offset ?? 0);
    const isFinder = (mx: number, my: number): boolean => {
      const corners = [
        [0, 0],
        [modules - 7, 0],
        [0, modules - 7],
      ];
      for (const [cx, cy] of corners) {
        const dx = mx - cx!;
        const dy = my - cy!;
        if (dx < 0 || dy < 0 || dx > 6 || dy > 6) continue;
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        return ring !== 2; // 1-module dark border, 1-module light ring, 3x3 dark core
      }
      return false;
    };
    for (let my = 0; my < modules; my += 1) {
      for (let mx = 0; mx < modules; mx += 1) {
        const dark = isFinder(mx, my) || ((mx + my) % 2 === 1);
        if (!dark) continue;
        for (let py = 0; py < moduleSize; py += 1) {
          for (let px = 0; px < moduleSize; px += 1) {
            const x = box.x + margin + mx * moduleSize + px;
            const y = box.y + margin + my * moduleSize + py;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const offset = (y * width + x) * 4;
            data[offset] = 0;
            data[offset + 1] = 0;
            data[offset + 2] = 0;
            data[offset + 3] = 255;
          }
        }
      }
    }
  }
  return encodeTruecolorPng({ width, height, data });
}

describe("contact source validation", () => {
  it("rejects empty groups, bad dates, missing fields and duplicate ids", () => {
    const empty = realGroups();
    empty.groups = [];
    expect(() => validateGroupsSource(empty)).toThrow(/groups must not be empty/);

    const badDate = realGroups();
    badDate.groups[0].validUntil = "2026-13-01";
    expect(() => validateGroupsSource(badDate)).toThrow(/validUntil must be a valid YYYY-MM-DD date/);

    const missing = realGroups();
    delete missing.groups[0].alt;
    expect(() => validateGroupsSource(missing)).toThrow(/groups\[0\]\.alt must be an object with zh and en/);

    const duplicate = realGroups();
    duplicate.groups[1].id = duplicate.groups[0].id;
    expect(() => validateGroupsSource(duplicate)).toThrow(/duplicate group id "feishu"/);

    const badFallback = realGroups();
    badFallback.fallbackUrl = "not-a-url";
    expect(() => validateGroupsSource(badFallback)).toThrow(/fallbackUrl must be an absolute http\(s\) URL/);

    const badSchema = realGroups();
    badSchema.schema = 2;
    expect(() => validateGroupsSource(badSchema)).toThrow(/schema must be 1/);
  });

  it("rejects invalid plugin sources", () => {
    const empty = realPlugins();
    empty.plugins = [];
    expect(() => validatePluginsSource(empty)).toThrow(/plugins must not be empty/);

    const badDate = realPlugins();
    badDate.plugins[0].verifiedAt = "30/10/2026";
    expect(() => validatePluginsSource(badDate)).toThrow(/verifiedAt must be a valid YYYY-MM-DD date/);

    const duplicate = realPlugins();
    duplicate.plugins[1].id = duplicate.plugins[0].id;
    expect(() => validatePluginsSource(duplicate)).toThrow(/duplicate plugin id/);

    const badUrl = realPlugins();
    badUrl.plugins[0].url = "ftp://example.com";
    expect(() => validatePluginsSource(badUrl)).toThrow(/url must be an absolute http\(s\) URL/);
  });

  it("rejects crop boxes that leave the canvas", () => {
    const crops = readJson(join(REPO_ROOT, "contact", "crops.json"));
    crops.crops.qq = { x: 800, y: 100, size: 400 };
    expect(() => validateCropsSource(crops)).toThrow(/leaves the 900x1600 canvas/);
  });
});

describe("buildManifest", () => {
  it("sorts groups by order, points every QR at the published PNG and validates", () => {
    const source = validateGroupsSource(realGroups());
    const plugins = validatePluginsSource(realPlugins()).plugins;
    const manifest = buildManifest({ version: "1.2.3", source, plugins });

    expect(manifest.version).toBe("1.2.3");
    expect(manifest.updatedAt).toBe("2026-10-23T00:00:00+08:00");
    expect(manifest.groups.map((group) => group.id)).toEqual(["feishu", "qq", "wechat"]);
    for (const group of manifest.groups) {
      expect(group.qr.kind).toBe("remote");
      if (group.qr.kind === "remote") expect(group.qr.path).toMatch(/\.png$/);
      expect(group.card).toMatch(/\.png$/);
    }
    expect(() => parseManifest(manifest)).not.toThrow();
    expect(publishedName("card-qq.jpg")).toBe("card-qq.png");
    expect(publishedName("qr-wechat-2026-10-23.png")).toBe("qr-wechat-2026-10-23.png");
  });

  it("inlines only the permanent codes into the baseline", () => {
    const source = validateGroupsSource(realGroups());
    const plugins = validatePluginsSource(realPlugins()).plugins;
    const manifest = buildManifest({ version: "0.0.1", source, plugins });
    const png = encodeTruecolorPng({ width: 2, height: 2, data: new Uint8Array(16).fill(255) });
    const qrPng = new Map<string, Buffer>([["feishu", png], ["qq", png]]);
    const baseline = buildBaseline(manifest, qrPng);

    expect(Object.keys(baseline.qr).sort()).toEqual(["qr-feishu", "qr-qq"]);
    for (const uri of Object.values(baseline.qr)) {
      expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    }
    const wechat = baseline.manifest.groups.find((group: Group) => group.id === "wechat")!;
    expect(wechat.qr).toEqual({ kind: "remote", path: "qr-wechat-2026-10-23.png" });
    expect(BUNDLED_PLATFORMS.has("wechat")).toBe(false);

    expect(() => buildBaseline(manifest, new Map())).toThrow(/missing generated QR for group "feishu"/);
  });
});

describe("generateData", () => {
  it("writes a valid manifest, palette PNGs and the baseline under the QR budget", () => {
    const outDir = makeTempDir("dsh-base-data-");
    const baselineFile = join(outDir, "baseline.ts");
    const result = generateData({ rootDir: REPO_ROOT, dataDir: outDir, baselineFile });

    const manifest = parseManifest(readJson(join(outDir, "manifest.json")));
    expect(manifest.groups).toHaveLength(3);
    expect(manifest.plugins.length).toBeGreaterThanOrEqual(5);
    expect(manifest.version).toBe("0.0.1");

    for (const group of manifest.groups) {
      expect(existsSync(join(outDir, "img", group.card))).toBe(true);
      if (group.qr.kind === "remote") expect(existsSync(join(outDir, "img", group.qr.path))).toBe(true);
    }

    expect(result.qrBase64Bytes).toBeLessThanOrEqual(QR_BASE64_BUDGET);
    for (const [key, uri] of Object.entries(result.baseline.qr)) {
      const png = decodeImage(Buffer.from(uri.slice("data:image/png;base64,".length), "base64"));
      expect(png.width).toBe(QR_SIZE);
      expect(png.height).toBe(QR_SIZE);
      expect(key).toMatch(/^qr-(feishu|qq)$/);
    }

    const baselineText = readFileSync(baselineFile, "utf8");
    expect(baselineText.startsWith("// GENERATED FILE — do not edit by hand.")).toBe(true);
    expect(baselineText).toContain("export const BASELINE: BaselineContent =");
  });

  it("is deterministic: same input, same bytes, and --check reports no drift", () => {
    const outDir = makeTempDir("dsh-base-data-");
    const baselineFile = join(outDir, "baseline.ts");
    const first = generateData({ rootDir: REPO_ROOT, dataDir: outDir, baselineFile });
    const firstBaseline = readFileSync(baselineFile);
    const firstManifest = readFileSync(join(outDir, "manifest.json"));
    const firstQr = readFileSync(join(outDir, "img", "qr-feishu.png"));

    const second = generateData({ rootDir: REPO_ROOT, dataDir: outDir, baselineFile });
    expect(readFileSync(baselineFile).equals(firstBaseline)).toBe(true);
    expect(readFileSync(join(outDir, "manifest.json")).equals(firstManifest)).toBe(true);
    expect(readFileSync(join(outDir, "img", "qr-feishu.png")).equals(firstQr)).toBe(true);
    expect(second.qrBase64Bytes).toBe(first.qrBase64Bytes);

    const check = generateData({ rootDir: REPO_ROOT, dataDir: outDir, baselineFile, check: true });
    expect(check.drift).toEqual([]);
    expect(check.files.length).toBe(first.files.length);
  });

  it("reports stale files in check mode and refuses blank crops", () => {
    const outDir = makeTempDir("dsh-base-data-");
    const baselineFile = join(outDir, "baseline.ts");
    generateData({ rootDir: REPO_ROOT, dataDir: outDir, baselineFile });
    writeFileSync(join(outDir, "manifest.json"), "{}");
    const check = generateData({ rootDir: REPO_ROOT, dataDir: outDir, baselineFile, check: true });
    expect(check.drift.some((entry) => entry.endsWith("manifest.json"))).toBe(true);
    expect(readFileSync(join(outDir, "manifest.json"), "utf8")).toBe("{}");

    const blankRoot = makeTempDir("dsh-base-blank-");
    const contact = join(blankRoot, "contact");
    mkdirSync(join(contact, "src"), { recursive: true });
    writeFileSync(join(contact, "groups.json"), JSON.stringify(realGroups()));
    writeFileSync(join(contact, "crops.json"), JSON.stringify(readJson(join(REPO_ROOT, "contact", "crops.json"))));
    writeFileSync(join(contact, "plugins.json"), JSON.stringify(realPlugins()));
    writeFileSync(join(contact, "src", "card-feishu.png"), makeQrCard({ blank: true }));
    writeFileSync(join(contact, "src", "card-qq.jpg"), makeQrCard());
    writeFileSync(join(contact, "src", "card-wechat-2026-10-23.png"), makeQrCard());
    writeFileSync(join(blankRoot, "package.json"), JSON.stringify({ name: "blank", version: "0.0.0" }));
    expect(() =>
      generateData({ rootDir: blankRoot, dataDir: join(blankRoot, "data"), baselineFile: join(blankRoot, "baseline.ts"), packageJsonPath: join(blankRoot, "package.json") }),
    ).toThrow(/crop box for "feishu" looks blank/);
  });
});

describe("lineDiff", () => {
  it("prints only changed lines", () => {
    expect(lineDiff(["a", "b", "c"], ["a", "x", "c"])).toBe("- b\n+ x");
    expect(lineDiff([], ["+ new"])).toBe("+ + new");
    expect(lineDiff(["same"], ["same"])).toBe("");
  });
});

describe("contact:update", () => {
  function makeRepo(): { rootDir: string; imagePath: string } {
    const rootDir = makeTempDir("dsh-base-update-");
    const contact = join(rootDir, "contact");
    mkdirSync(join(contact, "src"), { recursive: true });
    mkdirSync(join(rootDir, "packages", "base"), { recursive: true });

    const groups = realGroups();
    writeFileSync(join(contact, "groups.json"), JSON.stringify(groups, null, 2) + "\n");
    writeFileSync(join(contact, "crops.json"), JSON.stringify(readJson(join(REPO_ROOT, "contact", "crops.json")), null, 2) + "\n");
    writeFileSync(join(contact, "plugins.json"), JSON.stringify(realPlugins(), null, 2) + "\n");
    writeFileSync(join(rootDir, "packages", "base", "package.json"), JSON.stringify({ name: "tmp", version: "0.0.0" }) + "\n");

    for (const group of groups.groups) {
      writeFileSync(join(contact, "src", group.card), makeQrCard());
      writeFileSync(join(contact, "src", group.qr), makeQrCard());
    }
    // Stale + still-fresh dated images for the weekly group.
    writeFileSync(join(contact, "src", "card-wechat-2026-08-01.png"), makeQrCard());
    writeFileSync(join(contact, "src", "qr-wechat-2026-08-01.png"), makeQrCard());
    writeFileSync(join(contact, "src", "card-wechat-2026-09-20.png"), makeQrCard());
    writeFileSync(join(contact, "src", "qr-wechat-2026-09-20.png"), makeQrCard());

    const imagePath = join(rootDir, "new-screenshot.png");
    writeFileSync(imagePath, makeQrCard());
    return { rootDir, imagePath };
  }

  it("writes dated files, bumps the manifest, drops stale images and prints a diff", () => {
    const { rootDir, imagePath } = makeRepo();
    const lines: string[] = [];
    const result = updateContact({
      rootDir,
      imagePath,
      group: "wechat",
      date: "2026-10-24",
      confirmed: true,
      noBuild: true,
      stdout: (line) => lines.push(line),
    });

    expect(result.status).toBe("updated");
    expect(result.exitCode).toBe(0);
    expect(result.validUntil).toBe("2026-10-31");
    expect(result.filesWritten).toContain("contact/src/card-wechat-2026-10-24.png");
    expect(result.filesWritten).toContain("contact/src/qr-wechat-2026-10-24.png");
    expect(result.filesWritten).toContain("contact/groups.json");
    expect(existsSync(join(rootDir, "contact", "src", "card-wechat-2026-10-24.png"))).toBe(true);

    const groups = readJson(join(rootDir, "contact", "groups.json"));
    const wechat = groups.groups.find((group: any) => group.id === "wechat");
    expect(wechat.card).toBe("card-wechat-2026-10-24.png");
    expect(wechat.qr).toBe("qr-wechat-2026-10-24.png");
    expect(wechat.validUntil).toBe("2026-10-31");
    expect(groups.updatedAt).toBe("2026-10-24");
    expect(groups.revision).toBe(2);
    expect(() => validateGroupsSource(groups)).not.toThrow();

    // Older than 8 weeks (2026-08-29) is removed; 2026-09-20 stays.
    expect(result.filesRemoved).toContain("contact/src/card-wechat-2026-08-01.png");
    expect(result.filesRemoved).toContain("contact/src/qr-wechat-2026-08-01.png");
    expect(existsSync(join(rootDir, "contact", "src", "card-wechat-2026-08-01.png"))).toBe(false);
    expect(existsSync(join(rootDir, "contact", "src", "card-wechat-2026-09-20.png"))).toBe(true);

    // The diff names the old and the new date.
    expect(result.diff).toContain("- ");
    expect(result.diff).toContain("+ ");
    expect(result.diff).toContain("2026-10-24");
    expect(lines.join("\n")).toContain("contact/groups.json:");
    expect(STALE_DAYS).toBe(56);
    expect(VALID_DAYS).toBe(7);
  });

  it("exits 3 until a human confirms, and supports dry-run", () => {
    const { rootDir, imagePath } = makeRepo();
    const pending = updateContact({ rootDir, imagePath, date: "2026-10-24", noBuild: true, stdout: () => {} });
    expect(pending.status).toBe("needs-confirmation");
    expect(pending.exitCode).toBe(3);

    const fresh = makeRepo();
    const before = readFileSync(join(fresh.rootDir, "contact", "groups.json"), "utf8");
    const dry = updateContact({ rootDir: fresh.rootDir, imagePath: fresh.imagePath, date: "2026-10-24", dryRun: true, noBuild: true, stdout: () => {} });
    expect(dry.status).toBe("dry-run");
    expect(dry.exitCode).toBe(0);
    expect(readFileSync(join(fresh.rootDir, "contact", "groups.json"), "utf8")).toBe(before);
    expect(existsSync(join(fresh.rootDir, "contact", "src", "card-wechat-2026-10-24.png"))).toBe(false);
  });

  it("rejects invalid images, blank crops and unknown groups", () => {
    const { rootDir, imagePath } = makeRepo();

    const garbage = join(rootDir, "garbage.png");
    writeFileSync(garbage, "not an image");
    expect(() => updateContact({ rootDir, imagePath: garbage, noBuild: true, stdout: () => {} })).toThrow(/unsupported image format/);

    const tiny = join(rootDir, "tiny.png");
    writeFileSync(tiny, encodeTruecolorPng({ width: 100, height: 100, data: new Uint8Array(100 * 100 * 4).fill(255) }));
    expect(() => updateContact({ rootDir, imagePath: tiny, noBuild: true, stdout: () => {} })).toThrow(/expected at least 320x320/);

    const blank = join(rootDir, "blank.png");
    writeFileSync(blank, makeQrCard({ blank: true }));
    expect(() => updateContact({ rootDir, imagePath: blank, noBuild: true, stdout: () => {} })).toThrow(/looks blank/);

    expect(() => updateContact({ rootDir, imagePath, group: "nope", noBuild: true, stdout: () => {} })).toThrow(/unknown group "nope"/);

    expect(() => updateContact({ rootDir, imagePath, date: "2026-02-30", noBuild: true, stdout: () => {} })).toThrow(
      /invalid --date "2026-02-30"/,
    );
  });
});