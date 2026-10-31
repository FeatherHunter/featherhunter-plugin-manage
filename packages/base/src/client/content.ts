import { isRecord, parseManifest } from "../core/index";
import type { Group, Manifest } from "../core/types";

/**
 * Remote manifest transport (ticket 05).
 *
 * The contact modal must always paint the bundled baseline first and only then
 * swap in the published manifest. Everything in this module is therefore
 * best-effort: any failure (timeout, HTTP error, invalid JSON, invalid data,
 * oversized image) silently degrades to the baseline, never to an error state.
 */

/** Published package name; the CDN URLs below are derived from it. */
export const PACKAGE_NAME = "dsh-featherhunter-plugin-base";

/** One manifest request may take at most 1.5s; there are no retries inside a load. */
export const MANIFEST_TIMEOUT_MS = 1500;

/**
 * QR images get a much longer window than the manifest. A cold TLS handshake
 * to a CDN measured 2.0s on the maintainer network, and a missing code is
 * user-visible while a slow manifest only delays the background refresh.
 */
export const CONTENT_IMAGE_TIMEOUT_MS = 6000;

/** A successful manifest is reused for 30 minutes. */
export const MANIFEST_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * A failed manifest fetch is only remembered for a minute, so reopening the
 * dialog retries instead of losing the remote cards for half an hour.
 */
export const MANIFEST_FAILURE_TTL_MS = 60 * 1000;

/** Hard cap for a single QR image, enforced before it is shown. */
export const MAX_IMAGE_BYTES = 512 * 1024;

/**
 * Hard cap for the manifest document itself. The size check runs before
 * JSON.parse so a hostile or broken CDN response cannot freeze the page; a
 * manifest that large is treated like any other transport failure (fall
 * through to the next channel, then to the bundled baseline).
 */
export const MAX_MANIFEST_BYTES = 512 * 1024;

/** UTF-8 byte length; TextEncoder is present in every browser and jsdom. */
const UTF8_ENCODER = new TextEncoder();

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

/** The only hosts the client is allowed to talk to (images and manifest). */
export const ALLOWED_CDN_HOSTS: readonly string[] = [
  "unpkg.com",
  "registry.npmmirror.com",
  "cdn.jsdelivr.net",
];

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const IMAGE_PATH_PATTERN = /^[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g)$/i;
const MAX_ID_LENGTH = 64;
const MAX_TEXT_LENGTH = 200;
const MAX_NOTE_LENGTH = 300;
const MAX_PATH_LENGTH = 128;

/** Minimal structural view of a fetch Response; easy to fake in tests. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; cache?: string; credentials?: string },
) => Promise<FetchResponseLike>;

/** A loaded and validated manifest plus the QR images prefetched for it. */
export interface LoadedContent {
  manifest: Manifest;
  /** Channel name that produced the manifest ("unpkg" / "npmmirror" / ...). */
  source: string;
  /** Timestamp (loader clock) at which the manifest was accepted. */
  fetchedAt: number;
  /** Prefetched QR images keyed by "<version>/<path>", values are data URIs. */
  images: Map<string, string>;
}

/** Context handed to a channel loader. */
export interface ChannelContext {
  packageName: string;
  fetchText: (url: string) => Promise<string>;
  fetchJson: (url: string) => Promise<unknown>;
}

/** One CDN channel; the channels are tried in array order. */
export interface ManifestChannel {
  name: string;
  load: (context: ChannelContext) => Promise<{ raw: unknown; url: string }>;
}

export interface ContentLoaderOptions {
  /** Explicit manifest URL; when set, the default CDN channels are not used. */
  manifestUrl?: string;
  packageName?: string;
  fetchImpl?: FetchLike;
  /** Window for one manifest request (default 1.5s). */
  timeoutMs?: number;
  /** Window for one QR image request (default 6s). */
  imageTimeoutMs?: number;
  /** How long a completely failed load is remembered (default 60s). */
  failureTtlMs?: number;
  maxImageBytes?: number;
  /** Clock override (testing seam). */
  now?: () => number;
  /** Channel override (testing seam). */
  channels?: ManifestChannel[];
}

function fail(message: string): never {
  throw new Error("manifest: " + message);
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0) fail(field + " must be a non-empty string");
  if ((value as string).length > maxLength) fail(field + " is longer than " + maxLength + " characters");
  return value as string;
}

function requireI18nText(value: unknown, field: string): void {
  if (!isRecord(value)) fail(field + " must be an object with zh/en");
  requireString(value["zh"], field + ".zh", MAX_TEXT_LENGTH);
  requireString(value["en"], field + ".en", MAX_TEXT_LENGTH);
}

/** Parse a URL; returns null instead of throwing. */
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** True for https URLs only. */
export function isHttpsUrl(value: string): boolean {
  const url = parseUrl(value);
  return url !== null && url.protocol === "https:";
}

/** True when the URL is https and its host is on the CDN allowlist. */
export function isAllowedCdnUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:") return false;
  return ALLOWED_CDN_HOSTS.includes(url.hostname);
}

/** Exact-version QR image URLs, primary jsDelivr then the npmmirror mirror. */
export function imageUrls(
  version: string,
  path: string,
  packageName: string = PACKAGE_NAME,
): string[] {
  if (!SEMVER_PATTERN.test(version)) return [];
  if (!IMAGE_PATH_PATTERN.test(path) || path.length > MAX_PATH_LENGTH) return [];
  return [
    "https://cdn.jsdelivr.net/npm/" + packageName + "@" + version + "/data/img/" + path,
    "https://registry.npmmirror.com/" + packageName + "/" + version + "/files/data/img/" + path,
  ];
}

/** The three published channels, in fallback order. */
export function defaultChannels(packageName: string = PACKAGE_NAME): ManifestChannel[] {
  const unpkgUrl = "https://unpkg.com/" + packageName + "@latest/data/manifest.json";
  const npmmirrorLatest = "https://registry.npmmirror.com/" + packageName + "/latest";
  const jsdelivrUrl = "https://cdn.jsdelivr.net/npm/" + packageName + "@latest/data/manifest.json";
  return [
    {
      name: "unpkg",
      load: async (context) => ({ raw: JSON.parse(await context.fetchText(unpkgUrl)), url: unpkgUrl }),
    },
    {
      // Two steps on purpose: the dist-tag document names the exact version,
      // and only the versioned file listing is immutable enough to trust.
      name: "npmmirror",
      load: async (context) => {
        const latest = await context.fetchJson(npmmirrorLatest);
        const version = isRecord(latest) ? latest["version"] : undefined;
        if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
          fail("npmmirror latest is missing a usable version");
        }
        const url =
          "https://registry.npmmirror.com/" +
          packageName +
          "/" +
          version +
          "/files/data/manifest.json";
        return { raw: JSON.parse(await context.fetchText(url)), url };
      },
    },
    {
      name: "jsdelivr",
      load: async (context) => ({
        raw: JSON.parse(await context.fetchText(jsdelivrUrl)),
        url: jsdelivrUrl,
      }),
    },
  ];
}

/**
 * Validate a remote manifest beyond what parseManifest checks: length limits
 * for user-visible text, a sane version, safe image paths and https links.
 * Throws an Error whose message starts with "manifest: ".
 */
export function validateRemoteManifest(raw: unknown): Manifest {
  const manifest = parseManifest(raw);
  if (!SEMVER_PATTERN.test(manifest.version)) fail("version must be a semantic version");
  if (!isHttpsUrl(manifest.fallbackUrl)) fail("fallbackUrl must be https");

  const seen = new Set<string>();
  for (const group of manifest.groups) {
    if (group.id.length > MAX_ID_LENGTH) fail("group id is too long");
    if (seen.has(group.id)) fail("duplicate group id " + group.id);
    seen.add(group.id);
    requireString(group.platform, "group.platform", MAX_ID_LENGTH);
    requireI18nText(group.readmeTitle, "group.readmeTitle");
    requireI18nText(group.alt, "group.alt");
    requireI18nText(group.title, "group.title");
    if (group.subtitle) requireI18nText(group.subtitle, "group.subtitle");
    if (group.note) {
      if (!isRecord(group.note)) fail("group.note must be an object with zh/en");
      requireString(group.note.zh, "group.note.zh", MAX_NOTE_LENGTH);
      requireString(group.note.en, "group.note.en", MAX_NOTE_LENGTH);
    }
    requireString(group.card, "group.card", MAX_PATH_LENGTH);
    if (!IMAGE_PATH_PATTERN.test(group.card)) fail("group.card must be a png/jpg file name");
    if (group.qr.kind === "remote") {
      if (!IMAGE_PATH_PATTERN.test(group.qr.path)) fail("group.qr.path must be a png/jpg file name");
      if (group.qr.path.length > MAX_PATH_LENGTH) fail("group.qr.path is too long");
    } else {
      requireString(group.qr.key, "group.qr.key", MAX_ID_LENGTH);
    }
  }
  return manifest;
}

function toDataUrl(bytes: Uint8Array, contentType: string | null): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  const type = contentType && contentType.startsWith("image/") ? contentType : "image/png";
  return "data:" + type + ";base64," + btoa(binary);
}

/** Module-level 30 minute cache, shared by every createBaseUI instance. */
let sessionCache: { at: number; content: LoadedContent | null } | null = null;
let inFlight: Promise<LoadedContent | null> | null = null;

/** Drop the module cache; tests use this, production never needs it. */
export function resetContentCache(): void {
  sessionCache = null;
  inFlight = null;
}

export class ContentLoader {
  readonly packageName: string;
  readonly timeoutMs: number;
  readonly imageTimeoutMs: number;
  readonly failureTtlMs: number;
  readonly maxImageBytes: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly channels: ManifestChannel[];

  constructor(options: ContentLoaderOptions = {}) {
    this.packageName = options.packageName ?? PACKAGE_NAME;
    if (!PACKAGE_NAME_PATTERN.test(this.packageName)) {
      throw new Error("invalid package name: " + this.packageName);
    }
    this.timeoutMs = options.timeoutMs ?? MANIFEST_TIMEOUT_MS;
    this.imageTimeoutMs = options.imageTimeoutMs ?? CONTENT_IMAGE_TIMEOUT_MS;
    this.failureTtlMs = options.failureTtlMs ?? MANIFEST_FAILURE_TTL_MS;
    this.maxImageBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES;
    this.now = options.now ?? (() => Date.now());
    const injected = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (typeof injected !== "function") throw new Error("fetch is not available in this environment");
    this.fetchImpl = injected;
    if (options.manifestUrl !== undefined) {
      if (!isHttpsUrl(options.manifestUrl)) throw new Error("manifestUrl must be https");
      const url = options.manifestUrl;
      this.channels = [
        { name: "custom", load: async (context) => ({ raw: JSON.parse(await context.fetchText(url)), url }) },
      ];
    } else if (options.channels) {
      this.channels = options.channels.slice();
    } else {
      this.channels = defaultChannels(this.packageName);
    }
  }

  /** Success lives 30 minutes; a hard failure only 60 seconds. */
  private ttlFor(content: LoadedContent | null): number {
    return content === null ? this.failureTtlMs : MANIFEST_CACHE_TTL_MS;
  }

  /** Cached result while it is still inside its own window. */
  getCached(): LoadedContent | null {
    if (!sessionCache) return null;
    if (this.now() - sessionCache.at >= this.ttlFor(sessionCache.content)) return null;
    return sessionCache.content;
  }

  /**
   * Fetch and validate the manifest once per window; concurrent callers share
   * one request. Resolves to null when every channel failed, and that empty
   * result is only kept for a minute so the next open can retry.
   */
  load(): Promise<LoadedContent | null> {
    if (sessionCache !== null && this.now() - sessionCache.at < this.ttlFor(sessionCache.content)) {
      return Promise.resolve(sessionCache.content);
    }
    if (inFlight) return inFlight;
    const startedAt = this.now();
    const promise = this.fetchContent(startedAt)
      .then((content) => {
        sessionCache = { at: this.now(), content };
        return content;
      })
      .finally(() => {
        inFlight = null;
      });
    inFlight = promise;
    return promise;
  }

  /** Prefetch every remote QR image of a manifest (best effort). */
  async ensureImages(content: LoadedContent): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const group of content.manifest.groups) {
      if (group.qr.kind !== "remote") continue;
      const key = content.manifest.version + "/" + group.qr.path;
      if (content.images.has(key)) continue;
      pending.push(this.loadImage(content, group.qr.path, key));
    }
    await Promise.all(pending);
  }

  /** Data URI for a remote QR path, or null when it is not prefetched. */
  imageFor(content: LoadedContent | null, path: string): string | null {
    if (!content) return null;
    return content.images.get(content.manifest.version + "/" + path) ?? null;
  }

  /** Warm the cache: manifest plus images. Never rejects. */
  async preload(): Promise<void> {
    try {
      const content = await this.load();
      if (content) await this.ensureImages(content);
    } catch {
      // preload is a hint; the modal degrades on its own.
    }
  }

  private async loadImage(content: LoadedContent, path: string, key: string): Promise<void> {
    for (const url of imageUrls(content.manifest.version, path, this.packageName)) {
      if (!isAllowedCdnUrl(url)) continue;
      try {
        const data = await this.fetchImage(url);
        if (data) {
          content.images.set(key, data);
          return;
        }
      } catch {
        // try the mirror
      }
    }
  }

  private async fetchImage(url: string): Promise<string | null> {
    const response = await this.request(url, this.imageTimeoutMs);
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxImageBytes) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > this.maxImageBytes) return null;
    return toDataUrl(new Uint8Array(buffer), response.headers.get("content-type"));
  }

  private async fetchContent(fetchedAt: number): Promise<LoadedContent | null> {
    const context: ChannelContext = {
      packageName: this.packageName,
      fetchText: (url) => this.fetchText(url),
      fetchJson: async (url) => JSON.parse(await this.fetchText(url)),
    };
    for (const channel of this.channels) {
      try {
        const result = await channel.load(context);
        const manifest = validateRemoteManifest(result.raw);
        return { manifest, source: channel.name, fetchedAt, images: new Map() };
      } catch {
        // silently fall through to the next channel / baseline
      }
    }
    return null;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.request(url);
    if (!response.ok) throw new Error("HTTP " + response.status);
    // Cheap pre-check: refuse an oversized body before reading it.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_MANIFEST_BYTES) {
      throw new Error("manifest text exceeds " + MAX_MANIFEST_BYTES + " bytes");
    }
    const text = await response.text();
    // The header may lie or be missing: check the real UTF-8 payload too.
    if (utf8ByteLength(text) > MAX_MANIFEST_BYTES) {
      throw new Error("manifest text exceeds " + MAX_MANIFEST_BYTES + " bytes");
    }
    return text;
  }

  /** One request with its own abort window; the timer is always cleared. */
  private async request(url: string, timeoutMs: number = this.timeoutMs): Promise<FetchResponseLike> {
    if (!isAllowedCdnUrl(url)) throw new Error("blocked url: " + url);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(new Error("timeout after " + timeoutMs + "ms"));
      }, timeoutMs);
    });
    try {
      const request = this.fetchImpl(url, {
        signal: controller ? controller.signal : undefined,
        cache: "no-store",
        credentials: "omit",
      });
      // The losing side of the race must not surface as an unhandled rejection.
      request.catch(() => {});
      return await Promise.race([request, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** Build a loader bound to the published package (or a custom manifest URL). */
export function createContentLoader(options: ContentLoaderOptions = {}): ContentLoader {
  return new ContentLoader(options);
}
