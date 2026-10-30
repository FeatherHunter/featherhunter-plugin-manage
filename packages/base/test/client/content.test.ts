// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentLoader,
  MANIFEST_CACHE_TTL_MS,
  MANIFEST_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  PACKAGE_NAME,
  createContentLoader,
  defaultChannels,
  imageUrls,
  isAllowedCdnUrl,
  isHttpsUrl,
  resetContentCache,
  validateRemoteManifest,
  type FetchLike,
  type FetchResponseLike,
} from "../../src/client/content";

const UNPKG_URL = "https://unpkg.com/" + PACKAGE_NAME + "@latest/data/manifest.json";
const NPMMIRROR_LATEST = "https://registry.npmmirror.com/" + PACKAGE_NAME + "/latest";
const NPMMIRROR_FILES =
  "https://registry.npmmirror.com/" + PACKAGE_NAME + "/0.0.1/files/data/manifest.json";
const JSDELIVR_URL = "https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@latest/data/manifest.json";

function group(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "wechat",
    platform: "wechat",
    order: 30,
    readmeTitle: { zh: "微信群", en: "WeChat group" },
    alt: { zh: "微信群二维码", en: "WeChat QR" },
    card: "card-wechat.png",
    qr: { kind: "remote", path: "qr-wechat.png" },
    title: { zh: "微信群", en: "WeChat group" },
    subtitle: { zh: "群号：123", en: "Group ID: 123" },
    note: { zh: "该二维码 7 天内有效", en: "Valid for 7 days" },
    validUntil: "2026-11-07",
    ...overrides,
  };
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    version: "0.0.1",
    revision: 2,
    updatedAt: "2026-10-23T00:00:00+08:00",
    fallbackUrl: "https://github.com/FeatherHunter/featherhunter-plugin-manage",
    groups: [group()],
    plugins: [
      {
        id: "deck",
        order: 10,
        verifiedAt: "2026-10-30",
        name: "deck",
        repo: "FeatherHunter/dsh-mattpocock-skills-deck",
        desc: { zh: "deck 插件", en: "deck plugin" },
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): FetchResponseLike {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

function imageResponse(bytes: number, contentType = "image/png", status = 200): FetchResponseLike {
  const buffer = new Uint8Array(bytes);
  buffer.fill(1);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const key = name.toLowerCase();
        if (key === "content-type") return contentType;
        if (key === "content-length") return String(bytes);
        return null;
      },
    },
    text: async () => "",
    arrayBuffer: async () => buffer.buffer,
  };
}

/** A fetch stub driven by a URL -> response map, recording call order. */
function scriptedFetch(
  handler: (url: string) => FetchResponseLike | Promise<FetchResponseLike> | null,
): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const response = handler(url);
    if (response === null) throw new Error("network error for " + url);
    return await response;
  };
  return { fetch, calls };
}

function hang(): Promise<never> {
  return new Promise<never>(() => {});
}

beforeEach(() => {
  resetContentCache();
});

describe("channel layout", () => {
  it("lists the three channels in the documented fallback order", () => {
    const channels = defaultChannels();
    expect(channels.map((channel) => channel.name)).toEqual(["unpkg", "npmmirror", "jsdelivr"]);
    // Every default channel targets the published package.
    expect(UNPKG_URL).toContain(PACKAGE_NAME);
    expect(NPMMIRROR_LATEST).toContain(PACKAGE_NAME);
    expect(JSDELIVR_URL).toContain(PACKAGE_NAME);
  });

  it("builds exact-version image URLs on the two allowed CDN hosts", () => {
    expect(imageUrls("0.0.1", "qr-wechat.png")).toEqual([
      "https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@0.0.1/data/img/qr-wechat.png",
      "https://registry.npmmirror.com/" + PACKAGE_NAME + "/0.0.1/files/data/img/qr-wechat.png",
    ]);
    // Path / version injection is rejected instead of escaped.
    expect(imageUrls("0.0.1", "../etc/passwd")).toEqual([]);
    expect(imageUrls("0.0.1", "qr-wechat.svg")).toEqual([]);
    expect(imageUrls("latest", "qr-wechat.png")).toEqual([]);
  });
});

describe("url safety", () => {
  it("only accepts https URLs on the CDN allowlist", () => {
    expect(isHttpsUrl("https://unpkg.com/x")).toBe(true);
    expect(isHttpsUrl("http://unpkg.com/x")).toBe(false);
    expect(isAllowedCdnUrl("https://unpkg.com/x")).toBe(true);
    expect(isAllowedCdnUrl("https://cdn.jsdelivr.net/x")).toBe(true);
    expect(isAllowedCdnUrl("https://registry.npmmirror.com/x")).toBe(true);
    expect(isAllowedCdnUrl("https://evil.example.com/x")).toBe(false);
    expect(isAllowedCdnUrl("https://cdn.jsdelivr.net.evil.com/x")).toBe(false);
  });

  it("refuses a non-https manifestUrl at construction time", () => {
    expect(() => createContentLoader({ manifestUrl: "http://unpkg.com/x.json" })).toThrow(/https/);
  });
});

describe("manifest validation", () => {
  it("accepts a well-formed manifest", () => {
    const parsed = validateRemoteManifest(manifest());
    expect(parsed.version).toBe("0.0.1");
    expect(parsed.groups[0].qr).toEqual({ kind: "remote", path: "qr-wechat.png" });
  });

  it.each([
    ["a non-semver version", { version: "latest" }],
    ["an http fallbackUrl", { fallbackUrl: "http://example.com" }],
    ["empty groups", { groups: [] }],
    ["a schema bump", { schema: 2 }],
  ])("rejects %s", (_label, override) => {
    expect(() => validateRemoteManifest(manifest(override))).toThrow(/^manifest: /);
  });

  it("rejects over-long text, unsafe image paths and non-image cards", () => {
    expect(() =>
      validateRemoteManifest(manifest({ groups: [group({ title: { zh: "x".repeat(201), en: "x" } })] })),
    ).toThrow(/title.zh/);
    expect(() =>
      validateRemoteManifest(
        manifest({ groups: [group({ qr: { kind: "remote", path: "../qr.png" } })] }),
      ),
    ).toThrow(/qr.path/);
    expect(() =>
      validateRemoteManifest(manifest({ groups: [group({ card: "card-wechat.html" })] })),
    ).toThrow(/card/);
    expect(() =>
      validateRemoteManifest(manifest({ groups: [group({ subtitle: { zh: 1, en: "x" } })] })),
    ).toThrow(/subtitle/);
  });
});

describe("ContentLoader fallback chain", () => {
  it("uses unpkg first and stops there", async () => {
    const { fetch, calls } = scriptedFetch((url) =>
      url === UNPKG_URL ? jsonResponse(manifest()) : null,
    );
    const loader = createContentLoader({ fetchImpl: fetch });
    const content = await loader.load();
    expect(content?.source).toBe("unpkg");
    expect(calls).toEqual([UNPKG_URL]);
  });

  it("falls back to npmmirror through its two-step lookup", async () => {
    const { fetch, calls } = scriptedFetch((url) => {
      if (url === UNPKG_URL) return jsonResponse({ error: "down" }, 500);
      if (url === NPMMIRROR_LATEST) return jsonResponse({ version: "0.0.1" });
      if (url === NPMMIRROR_FILES) return jsonResponse(manifest());
      return null;
    });
    const loader = createContentLoader({ fetchImpl: fetch });
    const content = await loader.load();
    expect(content?.source).toBe("npmmirror");
    expect(calls).toEqual([UNPKG_URL, NPMMIRROR_LATEST, NPMMIRROR_FILES]);
  });

  it("falls back to jsDelivr when unpkg and npmmirror fail", async () => {
    const { fetch, calls } = scriptedFetch((url) => {
      if (url === JSDELIVR_URL) return jsonResponse(manifest());
      if (url === NPMMIRROR_LATEST) return jsonResponse({ version: "0.0.1" });
      return null;
    });
    const loader = createContentLoader({ fetchImpl: fetch });
    const content = await loader.load();
    expect(content?.source).toBe("jsdelivr");
    expect(calls).toEqual([UNPKG_URL, NPMMIRROR_LATEST, NPMMIRROR_FILES, JSDELIVR_URL]);
  });

  it("degrades to null when every channel fails, without throwing", async () => {
    const { fetch } = scriptedFetch(() => null);
    const loader = createContentLoader({ fetchImpl: fetch });
    await expect(loader.load()).resolves.toBeNull();
  });

  it("rejects invalid JSON and invalid manifests, then keeps falling back", async () => {
    const { fetch, calls } = scriptedFetch((url) => {
      if (url === UNPKG_URL) return { ...jsonResponse({}), text: async () => "not json" };
      if (url === NPMMIRROR_LATEST) return jsonResponse({ version: "0.0.1" });
      if (url === NPMMIRROR_FILES) return jsonResponse(manifest({ groups: [] }));
      if (url === JSDELIVR_URL) return jsonResponse(manifest());
      return null;
    });
    const loader = createContentLoader({ fetchImpl: fetch });
    const content = await loader.load();
    expect(content?.source).toBe("jsdelivr");
    expect(calls).toContain(JSDELIVR_URL);
  });

  it("times out a hanging channel and moves on (1.5s window, no retries)", async () => {
    const { fetch, calls } = scriptedFetch((url) => {
      if (url === JSDELIVR_URL) return jsonResponse(manifest());
      return hang();
    });
    const loader = createContentLoader({ fetchImpl: fetch, timeoutMs: 20 });
    const started = Date.now();
    const content = await loader.load();
    expect(content?.source).toBe("jsdelivr");
    expect(Date.now() - started).toBeLessThan(1000);
    // One attempt per channel: unpkg, npmmirror latest, jsdelivr.
    expect(calls).toEqual([UNPKG_URL, NPMMIRROR_LATEST, JSDELIVR_URL]);
  });
});

describe("ContentLoader cache", () => {
  it("reuses one result for 30 minutes, then refetches", async () => {
    let clock = 1_000_000;
    const { fetch, calls } = scriptedFetch(() => jsonResponse(manifest()));
    const loader = createContentLoader({ fetchImpl: fetch, now: () => clock });

    await loader.load();
    expect(calls).toHaveLength(1);

    clock += MANIFEST_CACHE_TTL_MS - 1;
    await loader.load();
    expect(calls).toHaveLength(1);

    clock += 1;
    await loader.load();
    expect(calls).toHaveLength(2);
  });

  it("deduplicates concurrent loads into a single request", async () => {
    const { fetch, calls } = scriptedFetch(() => jsonResponse(manifest()));
    const loader = createContentLoader({ fetchImpl: fetch });
    const [first, second] = await Promise.all([loader.load(), loader.load()]);
    expect(first).toBe(second);
    expect(calls).toHaveLength(1);
  });

  it("caches failures too, so a flaky network is not hammered", async () => {
    const { fetch, calls } = scriptedFetch(() => null);
    const loader = createContentLoader({ fetchImpl: fetch });
    expect(await loader.load()).toBeNull();
    const attempts = calls.length;
    expect(await loader.load()).toBeNull();
    expect(calls).toHaveLength(attempts);
  });

  it("exposes the 1.5s default timeout", () => {
    expect(MANIFEST_TIMEOUT_MS).toBe(1500);
  });
});

describe("image prefetch and size cap", () => {
  const imageUrlsFor = (version = "0.0.1") => imageUrls(version, "qr-wechat.png");

  it("prefetches the jsDelivr image and turns it into a data URI", async () => {
    const [primary] = imageUrlsFor();
    const { fetch, calls } = scriptedFetch((url) => {
      if (url === UNPKG_URL) return jsonResponse(manifest());
      if (url === primary) return imageResponse(64);
      return null;
    });
    const loader = createContentLoader({ fetchImpl: fetch });
    const content = await loader.load();
    expect(content).not.toBeNull();
    await loader.ensureImages(content!);
    const dataUri = loader.imageFor(content, "qr-wechat.png");
    expect(dataUri?.startsWith("data:image/png;base64,")).toBe(true);
    expect(calls).toContain(primary);
  });

  it("uses the npmmirror mirror when jsDelivr fails", async () => {
    const [primary, mirror] = imageUrlsFor();
    const { fetch, calls } = scriptedFetch((url) => {
      if (url === UNPKG_URL) return jsonResponse(manifest());
      if (url === mirror) return imageResponse(64);
      return null;
    });
    const loader = createContentLoader({ fetchImpl: fetch });
    const content = await loader.load();
    await loader.ensureImages(content!);
    expect(loader.imageFor(content, "qr-wechat.png")).toBeTruthy();
    expect(calls).toEqual(expect.arrayContaining([primary, mirror]));
  });

  it("refuses an image above 512KB and degrades to no image", async () => {
    const [primary, mirror] = imageUrlsFor();
    const { fetch } = scriptedFetch((url) => {
      if (url === UNPKG_URL) return jsonResponse(manifest());
      if (url === primary || url === mirror) return imageResponse(MAX_IMAGE_BYTES + 1);
      return null;
    });
    const loader = createContentLoader({ fetchImpl: fetch });
    const content = await loader.load();
    await loader.ensureImages(content!);
    expect(loader.imageFor(content, "qr-wechat.png")).toBeNull();
  });

  it("caps bytes even when content-length lies", async () => {
    const [primary] = imageUrlsFor();
    const { fetch } = scriptedFetch((url) => {
      if (url === UNPKG_URL) return jsonResponse(manifest());
      if (url === primary) {
        const response = imageResponse(MAX_IMAGE_BYTES + 1);
        return { ...response, headers: { get: () => null } };
      }
      return null;
    });
    const loader = createContentLoader({ fetchImpl: fetch });
    const content = await loader.load();
    await loader.ensureImages(content!);
    expect(loader.imageFor(content, "qr-wechat.png")).toBeNull();
  });

  it("preload() never rejects and warms the cache", async () => {
    const { fetch, calls } = scriptedFetch((url) => {
      if (url === UNPKG_URL) return jsonResponse(manifest());
      return imageResponse(64);
    });
    const loader = createContentLoader({ fetchImpl: fetch });
    await expect(loader.preload()).resolves.toBeUndefined();
    expect(loader.getCached()).not.toBeNull();
    expect(calls.length).toBeGreaterThan(1);
  });
});

describe("timer hygiene", () => {
  it("leaves no timers behind after a successful load", async () => {
    vi.useFakeTimers();
    try {
      const { fetch } = scriptedFetch(() => jsonResponse(manifest()));
      const loader = createContentLoader({ fetchImpl: fetch });
      const content = await loader.load();
      expect(content).not.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ContentLoader construction", () => {
  it("accepts an explicit https manifest URL as the only channel", async () => {
    const url = "https://cdn.jsdelivr.net/npm/" + PACKAGE_NAME + "@0.0.1/data/manifest.json";
    const { fetch, calls } = scriptedFetch(() => jsonResponse(manifest()));
    const loader = createContentLoader({ fetchImpl: fetch, manifestUrl: url });
    const content = await loader.load();
    expect(content?.source).toBe("custom");
    expect(calls).toEqual([url]);
  });

  it("requires a fetch implementation", () => {
    const original = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      expect(() => createContentLoader({})).toThrow(/fetch/);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it("is constructible directly", () => {
    const loader = new ContentLoader({ fetchImpl: async () => jsonResponse(manifest()) });
    expect(loader).toBeInstanceOf(ContentLoader);
  });
});