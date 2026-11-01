/**
 * Fixtures for the freeze tests: a scripted git/npm machine and a tiny tar writer.
 *
 * The tar writer exists so a test can state exactly what `npm pack` produced,
 * including a long path that only a PAX header can carry. The command handler
 * then behaves like the real tools for the four invocations freeze makes:
 * `git rev-parse HEAD`, `git rev-parse --abbrev-ref HEAD`, `git status`,
 * the profile build command, and `npm pack`.
 */
import { gzipSync } from "node:zlib";

import type { CommandOutcome, CommandRequest, Ports } from "../../contracts/ports";
import { ok, type Result } from "../../contracts/result";
import { sha256Bytes } from "../../contracts/identity";
import type { VerificationDeclaration } from "../../declaration/loader";
import { defineVerificationProfile } from "../../contracts/verification-profile";
import { joinFsPath } from "../../runtime/paths";
import { FakeClock, FakeEnv, FakeFs } from "./fake-fs";
import { FakeCommand, FakeProcess, FakeHttp, FakeScreen, createFakeBrowser, makePorts } from "./fake-ports";

/* --------------------------------------------------------------------- tar */

function writeAscii(block: Buffer, offset: number, length: number, text: string): void {
  block.write(text, offset, Math.min(length, Buffer.byteLength(text, "ascii")), "ascii");
}

function octalField(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function tarHeader(name: string, size: number, type: "0" | "x"): Buffer {
  const block = Buffer.alloc(512);
  writeAscii(block, 0, 100, name);
  writeAscii(block, 100, 8, "0000644\0");
  writeAscii(block, 108, 8, "0000000\0");
  writeAscii(block, 116, 8, "0000000\0");
  writeAscii(block, 124, 12, octalField(size, 12));
  writeAscii(block, 136, 12, octalField(0, 12));
  block.fill(0x20, 148, 156);
  writeAscii(block, 156, 1, type);
  writeAscii(block, 157, 100, "");
  writeAscii(block, 257, 6, "ustar\0");
  writeAscii(block, 263, 2, "00");
  writeAscii(block, 265, 32, "fixture");
  writeAscii(block, 297, 32, "fixture");
  let checksum = 0;
  for (const byte of block) checksum += byte;
  writeAscii(block, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

function paxRecord(key: string, value: string): Buffer {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body, "utf8") + 2;
  for (;;) {
    const candidate = Buffer.byteLength(`${length} ${body}`, "utf8");
    if (candidate === length) break;
    length = candidate;
  }
  return Buffer.from(`${length} ${body}`, "utf8");
}

function padToBlock(buffer: Buffer): Buffer {
  const remainder = buffer.length % 512;
  return remainder === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(512 - remainder)]);
}

/**
 * Write a `.tgz` whose entries have `package/` stripped by the reader. Paths
 * longer than 100 bytes get a PAX `path` record, like GNU tar would emit.
 */
export function makeTgz(files: Readonly<Record<string, string | Uint8Array>>): Uint8Array {
  const chunks: Buffer[] = [];
  for (const path of Object.keys(files).sort()) {
    const content = typeof files[path] === "string" ? Buffer.from(files[path], "utf8") : Buffer.from(files[path]);
    const longName = Buffer.byteLength(path, "utf8") > 100;
    if (longName) {
      const record = paxRecord("path", path);
      chunks.push(tarHeader("PaxHeader", record.length, "x"));
      chunks.push(padToBlock(record));
    }
    chunks.push(tarHeader(longName ? path.slice(-90) : path, content.length, "0"));
    chunks.push(padToBlock(content));
  }
  chunks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(chunks)));
}

/* ------------------------------------------------------------------ world */

export interface FakeFreezeOptions {
  readonly cwd?: string;
  readonly head?: string;
  readonly branch?: string;
  readonly dirtyFiles?: readonly string[];
  readonly packageName?: string;
  readonly version?: string;
  readonly clientEntry?: string;
  readonly buildCommand?: string | null;
  readonly buildTimeoutMs?: number;
  readonly packFiles?: Readonly<Record<string, string | Uint8Array>>;
}

export const FIXTURE_HEAD = "0123456789abcdef0123456789abcdef01234567";

function commandOutcome(
  request: CommandRequest,
  stdout: string,
  exitCode = 0,
  stderr = "",
): Result<CommandOutcome> {
  return ok({
    argv: request.argv,
    cwd: request.cwd ?? "",
    exitCode,
    signal: null,
    stdout,
    stderr,
    durationMs: 1,
    timedOut: false,
  });
}

export class FakeFreezeWorld {
  readonly cwd: string;
  readonly packageName: string;
  readonly version: string;
  readonly clientEntry: string;
  readonly fs: FakeFs;
  readonly env: FakeEnv;
  readonly clock: FakeClock;
  readonly command: FakeCommand;
  readonly ports: Ports;
  readonly declaration: VerificationDeclaration;

  head: string;
  branch: string;
  dirtyFiles: string[];
  packNames: string[];
  packFiles: Readonly<Record<string, string | Uint8Array>>;
  headSequence?: readonly string[];
  dirtySequence?: readonly (readonly string[])[];
  onBuild?: () => void;
  private headReads = 0;
  private statusReads = 0;

  constructor(options: FakeFreezeOptions = {}) {
    this.cwd = options.cwd ?? "C:\\fake\\repo";
    this.packageName = options.packageName ?? "fixture-plugin";
    this.version = options.version ?? "1.2.3";
    this.clientEntry = options.clientEntry ?? "dist/client/index.js";
    this.head = options.head ?? FIXTURE_HEAD;
    this.branch = options.branch ?? "feat/fixture";
    this.dirtyFiles = [...(options.dirtyFiles ?? [])];
    this.packNames = [`${this.packageName}-${this.version}.tgz`];
    this.fs = new FakeFs(this.cwd);
    this.env = new FakeEnv({ cwd: this.cwd, values: { ComSpec: "C:\\Windows\\system32\\cmd.exe" } });
    this.clock = new FakeClock();
    this.command = new FakeCommand((request) => this.handle(request));
    this.packFiles = options.packFiles ?? {
      "package.json": `${JSON.stringify({ name: this.packageName, version: this.version }, null, 2)}\n`,
      [this.clientEntry]: `/*! ${this.packageName} v${this.version} */\nmodule.exports = {};\n`,
    };

    this.fs.seedJson(joinFsPath(this.cwd, "package.json"), { name: this.packageName, version: this.version });
    this.fs.seedFile(joinFsPath(this.cwd, "verify", "profile.ts"), "// fixture declaration\n");

    const profile = defineVerificationProfile({
      id: "fixture",
      packageName: this.packageName,
      defaultProfile: "web",
      clientEntry: this.clientEntry,
      ...(options.buildCommand === null
        ? {}
        : { build: { command: options.buildCommand ?? "npm run build", timeoutMs: options.buildTimeoutMs ?? 60_000 } }),
    });
    this.declaration = {
      path: joinFsPath(this.cwd, "verify", "profile.ts"),
      kind: "ts",
      exportName: "default",
      profile,
      requiredNode: "22.6.0",
    };

    this.ports = makePorts({
      fs: this.fs,
      env: this.env,
      clock: this.clock,
      command: this.command,
      process: new FakeProcess(),
      http: new FakeHttp(),
      screen: new FakeScreen(),
      browser: createFakeBrowser(),
    });
  }

  private handle(request: CommandRequest): Result<CommandOutcome> {
    const [executable, subcommand] = request.argv;
    if (executable === "git") {
      if (subcommand === "rev-parse" && request.argv[2] === "HEAD") {
        const index = this.headReads;
        this.headReads += 1;
        const value = this.headSequence?.[Math.min(index, this.headSequence.length - 1)] ?? this.head;
        return commandOutcome(request, `${value}\n`);
      }
      if (subcommand === "rev-parse" && request.argv[2] === "--abbrev-ref") {
        return commandOutcome(request, `${this.branch}\n`);
      }
      if (subcommand === "status") {
        const index = this.statusReads;
        this.statusReads += 1;
        const files = this.dirtySequence?.[Math.min(index, this.dirtySequence.length - 1)] ?? this.dirtyFiles;
        return commandOutcome(request, files.map((path) => `?? ${path}\0`).join(""));
      }
      return commandOutcome(request, "", 1, `unexpected git call: ${request.argv.join(" ")}`);
    }

    if (/\.cmd$|^npm$/.test(executable) && subcommand === "pack") {
      const destIndex = request.argv.indexOf("--pack-destination");
      const destination = destIndex === -1 ? undefined : request.argv[destIndex + 1];
      if (destination === undefined) return commandOutcome(request, "", 1, "no --pack-destination");
      const entries = this.packNames.map((filename) => {
        const bytes = makeTgz(this.packFiles);
        this.fs.seedFile(joinFsPath(destination, filename), bytes);
        return {
          filename,
          name: this.packageName,
          version: this.version,
          size: bytes.length,
          shasum: sha256Bytes(bytes),
        };
      });
      return commandOutcome(request, `${JSON.stringify(entries)}\n`);
    }

    if (request.argv.some((argument) => argument.includes("npm run build"))) {
      this.onBuild?.();
      return commandOutcome(request, "built\n");
    }
    return commandOutcome(request, "", 1, `unexpected command: ${request.argv.join(" ")}`);
  }
}
