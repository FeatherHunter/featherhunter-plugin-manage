/**
 * Ticket 03/12 follow-up — the QR geometry gate (F2).
 *
 * OpenCV/jsQR cannot decode the QQ (gradient dots) and WeChat (logo) styles, so
 * the publish gate is geometric: three finder patterns, no clipping, a >= 90%
 * re-detection coverage, a >= 4-module quiet zone and a >= 320px square output.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { detectQrGeometry, extractQrCode, QR_MIN_SIZE, QR_QUIET_ZONE_MODULES } from "../scripts/image";
import { decodeImage, encodeTruecolorPng } from "../scripts/png";
import { generateData } from "../scripts/build-data";
import { updateContact } from "../scripts/contact-update";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..");
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

/** Draw a QR-like symbol: three finder patterns plus a checkerboard data area. */
function makeQrImage(options: { size?: number; modules?: number; margin?: number; finders?: boolean } = {}): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const size = options.size ?? 620;
  const modules = options.modules ?? 25;
  const margin = options.margin ?? 40;
  const moduleSize = Math.max(1, Math.floor((size - margin * 2) / modules));
  const data = new Uint8Array(size * size * 4).fill(255);
  const finderState = (mx: number, my: number): boolean | null => {
    const corners = [
      [0, 0],
      [modules - 7, 0],
      [0, modules - 7],
    ];
    for (const [cx, cy] of corners) {
      const dx = mx - cx!;
      const dy = my - cy!;
      if (dx < 0 || dy < 0 || dx > 6 || dy > 6) continue;
      return Math.max(Math.abs(dx - 3), Math.abs(dy - 3)) !== 2;
    }
    return null;
  };
  for (let my = 0; my < modules; my += 1) {
    for (let mx = 0; mx < modules; mx += 1) {
      const finder = options.finders === false ? null : finderState(mx, my);
      const dark = finder === null ? (mx + my) % 2 === 1 : finder;
      if (!dark) continue;
      for (let py = 0; py < moduleSize; py += 1) {
        for (let px = 0; px < moduleSize; px += 1) {
          const x = margin + mx * moduleSize + px;
          const y = margin + my * moduleSize + py;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const offset = (y * size + x) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 255;
        }
      }
    }
  }
  return { width: size, height: size, data };
}

/** A card-sized image (the crop pipeline normalises onto 900x1600). */
function makeCard(options: { box?: { x: number; y: number; size: number }; blank?: boolean; finders?: boolean } = {}): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const width = 900;
  const height = 1600;
  const data = new Uint8Array(width * height * 4).fill(255);
  if (!options.blank) {
    const box = options.box ?? { x: 141, y: 582, size: 620 };
    const qr = makeQrImage({ size: box.size, margin: 30, finders: options.finders });
    for (let row = 0; row < box.size; row += 1) {
      const source = row * box.size * 4;
      const target = ((box.y + row) * width + box.x) * 4;
      data.set(qr.data.subarray(source, source + box.size * 4), target);
    }
  }
  return { width, height, data };
}

describe("detectQrGeometry", () => {
  it("finds the three finder patterns and derives a square bounding box", () => {
    const detection = detectQrGeometry(makeQrImage());
    expect(detection.reason).toBeNull();
    expect(detection.finders).toHaveLength(3);
    const geometry = detection.geometry!;
    expect(geometry.size).toBeGreaterThan(400);
    expect(Math.abs(geometry.right - geometry.left - (geometry.bottom - geometry.top))).toBeLessThan(geometry.moduleSize * 2);
    expect(geometry.moduleSize).toBeGreaterThan(10);
  });

  it("reports how many finder patterns are missing", () => {
    const detection = detectQrGeometry(makeQrImage({ finders: false }));
    expect(detection.geometry).toBeNull();
    expect(detection.reason).toMatch(/found \d of 3 finder patterns/);
  });

  it("rejects a blank image", () => {
    const blank = { width: 400, height: 400, data: new Uint8Array(400 * 400 * 4).fill(255) };
    const detection = detectQrGeometry(blank);
    expect(detection.geometry).toBeNull();
    expect(detection.reason).toMatch(/found 0 of 3 finder patterns/);
  });
});

describe("extractQrCode", () => {
  it("cuts, pads and resizes to a 320px square with a 4-module quiet zone", () => {
    const card = makeCard();
    const published = extractQrCode(card, { x: 141, y: 582, size: 620 });
    expect(published.width).toBe(QR_MIN_SIZE);
    expect(published.height).toBe(QR_MIN_SIZE);
    const detection = detectQrGeometry(published);
    expect(detection.geometry).not.toBeNull();
    const quiet = [
      detection.geometry!.left,
      detection.geometry!.top,
      published.width - detection.geometry!.right,
      published.height - detection.geometry!.bottom,
    ].map((value) => value / detection.geometry!.moduleSize);
    expect(Math.min(...quiet)).toBeGreaterThanOrEqual(QR_QUIET_ZONE_MODULES - 0.5);
  });

  it("rejects a crop box that clips the symbol", () => {
    const card = makeCard({ box: { x: 141, y: 582, size: 620 } });
    expect(() => extractQrCode(card, { x: 200, y: 640, size: 400 })).toThrow(/clipped|complete QR code/);
  });

  it("rejects a crop box without a symbol", () => {
    const card = makeCard({ blank: true });
    expect(() => extractQrCode(card, { x: 141, y: 582, size: 620 })).toThrow(/does not contain a complete QR code/);
  });
});

describe("contact:update geometry gate", () => {
  function makeRepo(): { rootDir: string; imagePath: string } {
    const rootDir = makeTempDir("dsh-base-qr-update-");
    const contact = join(rootDir, "contact");
    mkdirSync(join(contact, "src"), { recursive: true });
    mkdirSync(join(rootDir, "packages", "base"), { recursive: true });
    const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");
    writeFileSync(join(contact, "groups.json"), read("contact/groups.json"));
    writeFileSync(join(contact, "crops.json"), read("contact/crops.json"));
    writeFileSync(join(contact, "plugins.json"), read("contact/plugins.json"));
    writeFileSync(join(rootDir, "packages", "base", "package.json"), JSON.stringify({ name: "tmp", version: "0.0.0" }) + "\n");
    const groups = JSON.parse(read("contact/groups.json")) as { groups: { id: string; card: string; qr: string }[] };
    const crops = JSON.parse(read("contact/crops.json")) as { crops: Record<string, { x: number; y: number; size: number }> };
    for (const group of groups.groups) {
      const card = makeCard({ box: crops.crops[group.id] });
      writeFileSync(join(contact, "src", group.card), encodeTruecolorPng(card));
      writeFileSync(join(contact, "src", group.qr), encodeTruecolorPng(card));
    }
    const imagePath = join(rootDir, "new-screenshot.png");
    writeFileSync(imagePath, encodeTruecolorPng(makeCard({ box: crops.crops["wechat"] })));
    return { rootDir, imagePath };
  }

  it("accepts a complete screenshot and reports the published size", () => {
    const { rootDir, imagePath } = makeRepo();
    const lines: string[] = [];
    const result = updateContact({ rootDir, imagePath, date: "2026-11-06", confirmed: true, noBuild: true, stdout: (line) => lines.push(line) });
    expect(result.status).toBe("updated");
    expect(lines.join("\n")).toMatch(/QR geometry ok \(published 320x320px, 4-module quiet zone\)/);
  });

  it("rejects a screenshot whose crop box has no finder patterns", () => {
    const { rootDir } = makeRepo();
    const imagePath = join(rootDir, "no-finders.png");
    writeFileSync(imagePath, encodeTruecolorPng(makeCard({ box: { x: 141, y: 582, size: 620 }, finders: false })));
    expect(() => updateContact({ rootDir, imagePath, noBuild: true, stdout: () => {} })).toThrow(
      /crop box for "wechat": crop box .* does not contain a complete QR code/,
    );
  });
});

describe("build-data publishes padded QR images", () => {
  it("writes 320px QR PNGs with a 4-module quiet zone", () => {
    const rootDir = makeTempDir("dsh-base-qr-build-");
    const contact = join(rootDir, "contact");
    mkdirSync(join(contact, "src"), { recursive: true });
    const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");
    writeFileSync(join(contact, "groups.json"), read("contact/groups.json"));
    writeFileSync(join(contact, "crops.json"), read("contact/crops.json"));
    writeFileSync(join(contact, "plugins.json"), read("contact/plugins.json"));
    writeFileSync(join(rootDir, "package.json"), JSON.stringify({ name: "tmp", version: "0.0.1" }) + "\n");
    const groups = JSON.parse(read("contact/groups.json")) as { groups: { id: string; card: string; qr: string }[] };
    const crops = JSON.parse(read("contact/crops.json")) as { crops: Record<string, { x: number; y: number; size: number }> };
    for (const group of groups.groups) {
      const card = makeCard({ box: crops.crops[group.id] });
      writeFileSync(join(contact, "src", group.card), encodeTruecolorPng(card));
      writeFileSync(join(contact, "src", group.qr), encodeTruecolorPng(card));
    }
    const result = generateData({
      rootDir,
      dataDir: join(rootDir, "data"),
      baselineFile: join(rootDir, "baseline.ts"),
      packageJsonPath: join(rootDir, "package.json"),
    });
    for (const group of result.manifest.groups) {
      if (group.qr.kind !== "remote") continue;
      const published = decodeImage(readFileSync(join(rootDir, "data", "img", group.qr.path)));
      expect(published.width).toBe(QR_MIN_SIZE);
      const detection = detectQrGeometry(published);
      expect(detection.geometry).not.toBeNull();
      const quiet = Math.min(
        detection.geometry!.left,
        detection.geometry!.top,
        published.width - detection.geometry!.right,
        published.height - detection.geometry!.bottom,
      ) / detection.geometry!.moduleSize;
      expect(quiet).toBeGreaterThanOrEqual(QR_QUIET_ZONE_MODULES - 0.5);
    }
  });

  it("refuses a card whose crop box has no finder patterns", () => {
    const rootDir = makeTempDir("dsh-base-qr-build-bad-");
    const contact = join(rootDir, "contact");
    mkdirSync(join(contact, "src"), { recursive: true });
    const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");
    writeFileSync(join(contact, "groups.json"), read("contact/groups.json"));
    writeFileSync(join(contact, "crops.json"), read("contact/crops.json"));
    writeFileSync(join(contact, "plugins.json"), read("contact/plugins.json"));
    writeFileSync(join(rootDir, "package.json"), JSON.stringify({ name: "tmp", version: "0.0.1" }) + "\n");
    const groups = JSON.parse(read("contact/groups.json")) as { groups: { id: string; card: string; qr: string }[] };
    const crops = JSON.parse(read("contact/crops.json")) as { crops: Record<string, { x: number; y: number; size: number }> };
    for (const group of groups.groups) {
      const card = makeCard({ box: crops.crops[group.id], finders: false });
      writeFileSync(join(contact, "src", group.card), encodeTruecolorPng(card));
      writeFileSync(join(contact, "src", group.qr), encodeTruecolorPng(card));
    }
    expect(() =>
      generateData({
        rootDir,
        dataDir: join(rootDir, "data"),
        baselineFile: join(rootDir, "baseline.ts"),
        packageJsonPath: join(rootDir, "package.json"),
      }),
    ).toThrow(/crop box for "feishu": .*does not contain a complete QR code/);
  });
});