/**
 * In-memory filesystem, clock and environment for the tests.
 *
 * The self-check suite must not touch the machine it runs on: no real DSH home,
 * no real writes, no dependence on where the tests are checked out. These fakes
 * keep the exact `FsPort` contract (Result instead of throw, parent-directory
 * rules, overwrite semantics) so the same code paths run here as on a real host.
 */
import type { Sha256Hex } from "../../contracts/branding";
import { sha256Bytes } from "../../contracts/identity";
import type {
  ClockPort,
  CopyOutcome,
  DirEntry,
  EnvPort,
  FileStat,
  FsPort,
  PlatformName,
} from "../../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../../contracts/result";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Normalize a path the way the fake filesystem keys it: `/`-separated, drive lowercase. */
export function fakePath(input: string): string {
  const segments = input.replace(/\\/g, "/").split("/");
  const output: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (output.length > 1) output.pop();
      continue;
    }
    output.push(segment);
  }
  if (output.length === 0) return "/";
  const [head, ...rest] = output;
  const normalized = /^[A-Za-z]:$/.test(head) ? head.toLowerCase() : head;
  return [normalized, ...rest].join("/");
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/");
}

function parentOf(path: string): string | null {
  const normalized = fakePath(path).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return null;
  if (index === 0) return "/";
  if (/^[a-z]:$/.test(normalized.slice(0, index))) return normalized.slice(0, index);
  return normalized.slice(0, index);
}

function missing(path: string, action = "open"): Failure {
  return failure("not-found", `ENOENT: no such file or directory, ${action} '${path}'`);
}

/** An in-memory `FsPort` with real parent-directory and overwrite rules. */
export class FakeFs implements FsPort {
  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>();
  private readonly cwd: string;

  constructor(cwd = "C:\\fake\\repo") {
    this.cwd = fakePath(cwd);
    this.directories.add(this.cwd);
  }

  resolve(path: string): string {
    return isAbsolutePath(path) ? fakePath(path) : fakePath(`${this.cwd}/${path}`);
  }

  /* Test conveniences, deliberately synchronous. */

  seedDir(path: string): void {
    let current = this.resolve(path);
    const pending: string[] = [];
    while (current !== "/") {
      pending.push(current);
      const parent = parentOf(current);
      if (parent === null) break;
      current = parent;
    }
    for (const entry of pending) this.directories.add(entry);
  }

  seedFile(path: string, content: string | Uint8Array): void {
    const resolved = this.resolve(path);
    const parent = parentOf(resolved);
    if (parent !== null) this.seedDir(parent);
    this.files.set(resolved, typeof content === "string" ? textEncoder.encode(content) : new Uint8Array(content));
  }

  seedJson(path: string, value: unknown): void {
    this.seedFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  readFileSync(path: string): string {
    const bytes = this.files.get(this.resolve(path));
    if (bytes === undefined) throw new Error(`no fake file at ${path}`);
    return textDecoder.decode(bytes);
  }

  readJsonSync(path: string): unknown {
    return JSON.parse(this.readFileSync(path));
  }

  /** Normalized paths of the immediate children of a directory, sorted. */
  children(path: string): string[] {
    const resolved = this.resolve(path);
    return this.listSync(resolved).map((entry) => `${resolved}/${entry.name}`);
  }

  private listSync(resolved: string): DirEntry[] {
    const prefix = resolved === "/" ? "/" : `${resolved}/`;
    const entries = new Map<string, "file" | "directory">();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      if (rest.includes("/")) continue;
      entries.set(rest, "file");
    }
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === resolved) continue;
      const rest = directory.slice(prefix.length);
      if (rest.includes("/")) continue;
      entries.set(rest, "directory");
    }
    return [...entries.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, kind]) => ({ name, kind }));
  }

  private requireParent(path: string): Result<void> {
    const parent = parentOf(path);
    if (parent === null || !this.directories.has(parent)) return err(missing(parent ?? path, "open"));
    return ok(undefined);
  }

  async readText(path: string): Promise<Result<string>> {
    const resolved = this.resolve(path);
    const bytes = this.files.get(resolved);
    if (bytes === undefined) return err(missing(resolved, "open"));
    return ok(textDecoder.decode(bytes));
  }

  async writeText(path: string, text: string): Promise<Result<void>> {
    const resolved = this.resolve(path);
    const parent = this.requireParent(resolved);
    if (!parent.ok) return parent;
    this.files.set(resolved, textEncoder.encode(text));
    return ok(undefined);
  }

  async readJson(path: string): Promise<Result<unknown>> {
    const text = await this.readText(path);
    if (!text.ok) return text;
    try {
      return ok(JSON.parse(text.value) as unknown);
    } catch (error) {
      return err(failure("invalid-input", `invalid JSON in ${this.resolve(path)}: ${String(error)}`));
    }
  }

  async writeJson(path: string, value: unknown): Promise<Result<void>> {
    return this.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async readBytes(path: string): Promise<Result<Uint8Array>> {
    const resolved = this.resolve(path);
    const bytes = this.files.get(resolved);
    if (bytes === undefined) return err(missing(resolved, "open"));
    return ok(new Uint8Array(bytes));
  }

  async hashFile(path: string): Promise<Result<Sha256Hex>> {
    const bytes = await this.readBytes(path);
    if (!bytes.ok) return bytes;
    return ok(sha256Bytes(bytes.value));
  }

  async exists(path: string): Promise<boolean> {
    const resolved = this.resolve(path);
    return this.files.has(resolved) || this.directories.has(resolved);
  }

  async stat(path: string): Promise<Result<FileStat>> {
    const resolved = this.resolve(path);
    const file = this.files.get(resolved);
    if (file !== undefined) return ok({ kind: "file", size: file.byteLength, mtimeMs: 0 });
    if (this.directories.has(resolved)) return ok({ kind: "directory", size: 0, mtimeMs: 0 });
    return err(missing(resolved, "stat"));
  }

  async list(path: string): Promise<Result<readonly DirEntry[]>> {
    const resolved = this.resolve(path);
    if (!this.directories.has(resolved)) return err(missing(resolved, "scandir"));
    return ok(this.listSync(resolved));
  }

  async makeDir(path: string): Promise<Result<void>> {
    let current = this.resolve(path);
    const pending: string[] = [];
    while (current !== "/") {
      pending.push(current);
      const parent = parentOf(current);
      if (parent === null) break;
      current = parent;
    }
    for (const entry of pending.reverse()) this.directories.add(entry);
    return ok(undefined);
  }

  async remove(path: string, options: { readonly recursive?: boolean } = {}): Promise<Result<void>> {
    const resolved = this.resolve(path);
    const prefix = `${resolved}/`;
    const files = [...this.files.keys()].filter((file) => file === resolved || file.startsWith(prefix));
    const directories = [...this.directories].filter((dir) => dir === resolved || dir.startsWith(prefix));
    if (files.length === 0 && directories.length === 0) return err(missing(resolved, "unlink"));
    if (options.recursive !== true) {
      const extraFiles = files.filter((file) => file !== resolved);
      if (extraFiles.length > 0 || directories.some((dir) => dir !== resolved)) {
        return err(failure("conflict", `ENOTEMPTY: directory not empty, rmdir '${resolved}'`));
      }
    }
    for (const file of files) this.files.delete(file);
    for (const directory of directories) this.directories.delete(directory);
    return ok(undefined);
  }

  async copy(from: string, to: string, options: { readonly recursive?: boolean } = {}): Promise<Result<CopyOutcome>> {
    const source = this.resolve(from);
    const target = this.resolve(to);
    const sourceFile = this.files.get(source);
    if (sourceFile !== undefined) {
      const parent = this.requireParent(target);
      if (!parent.ok) return parent;
      this.files.set(target, new Uint8Array(sourceFile));
      return ok({ files: 1, bytes: sourceFile.byteLength });
    }
    const prefix = `${source}/`;
    const matching = [...this.files.entries()].filter(([file]) => file.startsWith(prefix));
    if (matching.length === 0) return err(missing(source, "copyfile"));
    if (options.recursive !== true) {
      return err(failure("conflict", `EISDIR: illegal operation on a directory, copy '${source}'`));
    }
    let files = 0;
    let bytes = 0;
    for (const [file, content] of matching) {
      const destination = `${target}/${file.slice(prefix.length)}`;
      const parent = this.requireParent(destination);
      if (!parent.ok) return parent;
      this.files.set(destination, new Uint8Array(content));
      files += 1;
      bytes += content.byteLength;
    }
    return ok({ files, bytes });
  }

  async move(from: string, to: string): Promise<Result<void>> {
    const copied = await this.copy(from, to, { recursive: true });
    if (!copied.ok) return copied;
    return this.remove(from, { recursive: true });
  }

  async realPath(path: string): Promise<Result<string>> {
    const resolved = this.resolve(path);
    if (!this.files.has(resolved) && !this.directories.has(resolved)) return err(missing(resolved, "realpath"));
    return ok(resolved);
  }
}

/* --------------------------------------------------------------------- clock */

export function formatLocal(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const year = shifted.getUTCFullYear();
  const month = pad(shifted.getUTCMonth() + 1);
  const day = pad(shifted.getUTCDate());
  const hours = pad(shifted.getUTCHours());
  const minutes = pad(shifted.getUTCMinutes());
  const seconds = pad(shifted.getUTCSeconds());
  const millis = String(shifted.getUTCMilliseconds()).padStart(3, "0");
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** A clock that only moves when a test says so. */
export class FakeClock implements ClockPort {
  private readonly baseMs: number;
  private offsetMs = 0;
  private readonly offsetMinutes = 480;

  constructor(baseIso = "2026-11-01T21:00:00.000+08:00") {
    this.baseMs = Date.parse(baseIso);
  }

  nowMs(): number {
    return this.baseMs + this.offsetMs;
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }

  iso(ms?: number): string {
    return formatLocal(ms ?? this.nowMs(), this.offsetMinutes);
  }

  async sleep(ms: number): Promise<void> {
    this.offsetMs += ms;
  }
}

/* ----------------------------------------------------------------------- env */

export interface FakeEnvOptions {
  readonly values?: Readonly<Record<string, string>>;
  readonly home?: string;
  readonly tmp?: string;
  readonly platform?: PlatformName;
  readonly execPath?: string;
  readonly cwd?: string;
}

/** An `EnvPort` backed by a map; nothing leaks from the real process. */
export class FakeEnv implements EnvPort {
  private readonly values: Record<string, string>;
  private readonly home: string;
  private readonly tmp: string;
  private readonly platformName: PlatformName;
  private readonly nodePath: string;
  private readonly workingDirectory: string;

  constructor(options: FakeEnvOptions = {}) {
    this.values = { ...(options.values ?? {}) };
    this.home = options.home ?? "C:\\Users\\fixture";
    this.tmp = options.tmp ?? "C:\\Temp";
    this.platformName = options.platform ?? "win32";
    this.nodePath = options.execPath ?? "C:\\Program Files\\nodejs\\node.exe";
    this.workingDirectory = options.cwd ?? "C:\\fake\\repo";
  }

  set(name: string, value: string | undefined): void {
    if (value === undefined) delete this.values[name];
    else this.values[name] = value;
  }

  get(name: string): string | undefined {
    return this.values[name];
  }

  snapshot(): Readonly<Record<string, string>> {
    return { ...this.values };
  }

  homeDir(): string {
    return this.home;
  }

  tmpDir(): string {
    return this.tmp;
  }

  platform(): PlatformName {
    return this.platformName;
  }

  execPath(): string {
    return this.nodePath;
  }

  cwd(): string {
    return this.workingDirectory;
  }
}
