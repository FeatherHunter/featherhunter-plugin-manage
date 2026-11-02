/**
 * Fixtures for the batch tests: a scripted git machine, a frozen candidate and
 * seeded evidence manifests, all in memory.
 *
 * The world only answers what the batch code actually asks of git — HEAD, the
 * branch name, the dirty list and `rev-parse --verify <ref>^{commit}` — so a test
 * can move HEAD, advance the baseline or delete the ref by assigning one field.
 * Candidates are seeded as files (freeze has its own tests); evidence is seeded
 * as the manifest `evidence add` would leave behind.
 */
import type { CommandOutcome, CommandRequest, Ports } from "../../contracts/ports";
import { ok, type Result } from "../../contracts/result";
import { digestOfFiles, sha256Text } from "../../contracts/identity";
import { defineVerificationProfile } from "../../contracts/verification-profile";
import type { VerificationDeclaration } from "../../declaration/loader";
import { joinFsPath } from "../../runtime/paths";
import { FakeClock, FakeEnv, FakeFs } from "./fake-fs";
import { FakeCommand, FakeHttp, FakeProcess, FakeScreen, createFakeBrowser, makePorts } from "./fake-ports";

export const FIXTURE_HEAD = "0123456789abcdef0123456789abcdef01234567";
export const OTHER_HEAD = "89abcdef0123456789abcdef0123456789abcdef";
export const BASE_TIP = "abcdef0123456789abcdef0123456789abcdef01";
export const NEW_BASE_TIP = "2222222222222222222222222222222222222222";
/** The bytes the fixture candidate tarball contains. */
export const CANDIDATE_TGZ_CONTENT = "fixture candidate tarball\n";
/** The tarball digest the fixture candidate manifest declares (`package.tgzSha256`). */
export const CANDIDATE_TGZ_SHA256 = sha256Text(CANDIDATE_TGZ_CONTENT);

export const SHA_A = "a".repeat(64);
export const SHA_B = "b".repeat(64);
export const SHA_C = "c".repeat(64);
export const SHA_D = "d".repeat(64);

/** A package.json inside the candidate package, and the digest its file list produces. */
export function candidatePackageFile(version: string): { path: string; text: string; bytes: number; sha256: string } {
  const path = "package.json";
  const text = `{"name":"fixture-plugin","version":"${version}"}\n`;
  return { path, text, bytes: text.length, sha256: sha256Text(text) };
}

export function candidateFileDigest(version: string): string {
  const file = candidatePackageFile(version);
  const digested = digestOfFiles([{ path: file.path, size: file.bytes, sha256: file.sha256 }]);
  if (!digested.ok) throw new Error("fixture file list is invalid");
  return digested.value;
}

export interface FakeBatchOptions {
  readonly cwd?: string;
  readonly packageName?: string;
  readonly version?: string;
  readonly head?: string;
  readonly branch?: string;
  readonly dirtyFiles?: readonly string[];
  readonly baseRef?: string;
  /** `null` models a baseline ref that was deleted after the batch opened. */
  readonly baseTip?: string | null;
  readonly candidateCommit?: string;
  readonly candidateVersion?: string;
  readonly candidateValidity?: "release" | "development";
  readonly candidateGeneratedAt?: string;
  /** Make every git call fail, as if the work tree had disappeared. */
  readonly headFailure?: boolean;
}

export interface CandidateFixture {
  readonly dir: string;
  readonly path: string;
  readonly text: string;
  readonly sha256: string;
  /** `manifest.package.tgzSha256`; the value the identity line names. */
  readonly tgzSha256: string;
  readonly commit: string;
  readonly version: string;
}

export interface SeedCandidateOptions {
  readonly dirName?: string;
  /** Seed into `batches/<batchName>/pkg` instead of the default candidates root. */
  readonly batchName?: string;
  readonly commit?: string;
  readonly version?: string;
  readonly validity?: "release" | "development";
  readonly generatedAt?: string;
  /** Override the declared tarball digest (models a hand-edited manifest). */
  readonly tgzSha256?: string;
  /** Override the declared file digest (models a hand-edited manifest). */
  readonly fileDigest?: string;
  /** Skip writing the tarball file (models a candidate whose package went missing). */
  readonly tgzMissing?: boolean;
  /** Write these bytes into the tarball instead of the canonical content (models a replaced package). */
  readonly tgzContent?: string;
  /** Stamp `package.buildCommit` (models a package built from another commit). */
  readonly buildCommit?: string | null;
}

export interface SeedEvidenceOptions {
  /** `manifest.batch.name`; defaults to the directory's batch name. */
  readonly batchName?: string;
  /** The candidate object to stamp; omit to leave it out entirely. */
  readonly candidate?: Readonly<Record<string, unknown>>;
  readonly generatedAt?: string;
}

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

function candidateManifest(options: {
  commit: string;
  version: string;
  validity: "release" | "development";
  generatedAt: string;
  dir: string;
  tgzSha256: string;
  fileDigest: string;
  buildCommit?: string | null;
}): Record<string, unknown> {
  const file = candidatePackageFile(options.version);
  return {
    schemaVersion: 2,
    generatedAt: options.generatedAt,
    tool: "dsh-verify/0.0.0",
    version: options.version,
    validity: options.validity,
    sourceStable: options.validity === "release",
    git: {
      commit: options.commit,
      branch: "feat/fixture",
      dirty: options.validity === "development",
      dirtyFiles: options.validity === "development" ? ["src/index.ts"] : [],
    },
    package: {
      tgzPath: joinFsPath(options.dir, `fixture-plugin-${options.version}.tgz`),
      tgzBytes: CANDIDATE_TGZ_CONTENT.length,
      tgzSha256: options.tgzSha256,
      filename: `fixture-plugin-${options.version}.tgz`,
      files: [{ path: file.path, bytes: file.bytes, sha256: file.sha256 }],
      fileCount: 1,
      fileDigest: options.fileDigest,
      manifestDigest: SHA_D,
      ...(options.buildCommit === undefined ? {} : { buildCommit: options.buildCommit }),
    },
  };
}

export class FakeBatchWorld {
  readonly cwd: string;
  readonly packageName: string;
  readonly version: string;
  readonly fs: FakeFs;
  readonly env: FakeEnv;
  readonly clock: FakeClock;
  readonly command: FakeCommand;
  readonly ports: Ports;
  readonly declaration: VerificationDeclaration;

  head: string;
  branch: string;
  dirtyFiles: string[];
  baseRef: string;
  baseTip: string | null;
  /** What `git show <baseRef>:package.json` answers; `null` models an unreadable baseline version. */
  baseVersion: string | null;
  /** Whether the baseline tip is an ancestor of the candidate commit; `"unknown"` models a git that cannot answer. */
  baseContainsCommit: boolean | "unknown";
  /** When true every git invocation fails, so no HEAD can be read. */
  headFailure: boolean;

  /** The candidate `batch open` finds under the default work root. */
  readonly candidate: CandidateFixture;

  constructor(options: FakeBatchOptions = {}) {
    this.cwd = options.cwd ?? "C:\\fake\\repo";
    this.packageName = options.packageName ?? "fixture-plugin";
    this.version = options.version ?? "1.2.3";
    this.head = options.head ?? FIXTURE_HEAD;
    this.branch = options.branch ?? "feat/fixture";
    this.dirtyFiles = [...(options.dirtyFiles ?? [])];
    this.baseRef = options.baseRef ?? "main";
    this.baseTip = options.baseTip === undefined ? BASE_TIP : options.baseTip;
    this.baseVersion = this.version;
    this.baseContainsCommit = true;
    this.headFailure = options.headFailure ?? false;
    this.fs = new FakeFs(this.cwd);
    this.env = new FakeEnv({ cwd: this.cwd, values: { ComSpec: "C:\\Windows\\system32\\cmd.exe" } });
    this.clock = new FakeClock();
    this.command = new FakeCommand((request) => this.handle(request));

    this.fs.seedJson(joinFsPath(this.cwd, "package.json"), { name: this.packageName, version: this.version });
    this.fs.seedFile(joinFsPath(this.cwd, "verify", "profile.ts"), "// fixture declaration\n");

    const profile = defineVerificationProfile({
      id: "fixture",
      packageName: this.packageName,
      defaultProfile: "web",
      clientEntry: "dist/client/index.js",
      build: { command: "npm run build", timeoutMs: 60_000 },
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

    this.candidate = this.seedCandidate({
      dirName: "cand-1",
      ...(options.candidateCommit === undefined ? {} : { commit: options.candidateCommit }),
      ...(options.candidateVersion === undefined ? {} : { version: options.candidateVersion }),
      ...(options.candidateValidity === undefined ? {} : { validity: options.candidateValidity }),
      ...(options.candidateGeneratedAt === undefined ? {} : { generatedAt: options.candidateGeneratedAt }),
    });
  }

  get workRoot(): string {
    return joinFsPath(this.cwd, ".scratch", "verify");
  }

  batchesRoot(): string {
    return joinFsPath(this.workRoot, "batches");
  }

  batchDir(name: string): string {
    return joinFsPath(this.batchesRoot(), name);
  }

  batchFile(name: string): string {
    return joinFsPath(this.batchDir(name), "batch.json");
  }

  /**
   * Seed a candidate (default: under the work root's `candidates/`; pass
   * `batchName` to seed it inside a batch directory, which is where a sealed
   * candidate must live).
   */
  seedCandidate(options: SeedCandidateOptions = {}): CandidateFixture {
    const dir =
      options.batchName === undefined
        ? joinFsPath(this.workRoot, "candidates", options.dirName ?? "cand-1")
        : joinFsPath(this.batchDir(options.batchName), options.dirName ?? "pkg");
    const commit = options.commit ?? this.head;
    const version = options.version ?? this.version;
    const tgzSha256 = options.tgzSha256 ?? CANDIDATE_TGZ_SHA256;
    const fileDigest = options.fileDigest ?? candidateFileDigest(version);
    const manifest = candidateManifest({
      commit,
      version,
      validity: options.validity ?? "release",
      generatedAt: options.generatedAt ?? "2026-11-01T20:00:00.000Z",
      dir,
      tgzSha256,
      fileDigest,
      ...(options.buildCommit === undefined ? {} : { buildCommit: options.buildCommit }),
    });
    const path = joinFsPath(dir, "candidate.json");
    this.fs.seedJson(path, manifest);
    if (options.tgzMissing !== true) {
      this.fs.seedFile(joinFsPath(dir, `fixture-plugin-${version}.tgz`), options.tgzContent ?? CANDIDATE_TGZ_CONTENT);
    }
    const text = this.fs.readFileSync(path);
    return {
      dir,
      path,
      text,
      sha256: sha256Text(text),
      tgzSha256,
      commit,
      version,
    };
  }

  /** Seed an `evidence.json` inside a batch directory. */
  seedEvidence(batchName: string, relativeDir: string, options: SeedEvidenceOptions = {}): string {
    const dir = joinFsPath(this.batchDir(batchName), ...relativeDir.split("/"));
    const manifest: Record<string, unknown> = {
      schemaVersion: 1,
      generatedAt: options.generatedAt ?? this.clock.iso(),
      batch: {
        name: options.batchName ?? batchName,
        dir: this.batchDir(batchName),
        root: dir,
      },
      meta: {},
      summary: {},
      checks: [],
      items: [],
      ...(options.candidate === undefined ? {} : { candidate: options.candidate }),
    };
    const path = joinFsPath(dir, "evidence.json");
    this.fs.seedJson(path, manifest);
    return path;
  }

  advanceClock(ms: number): void {
    this.clock.advance(ms);
  }

  private handle(request: CommandRequest): Result<CommandOutcome> {
    const [executable, subcommand] = request.argv;
    if (executable === "git") {
      if (this.headFailure) {
        return commandOutcome(
          request,
          "",
          128,
          "fatal: not a git repository (or any of the parent directories): .git\n",
        );
      }
      if (subcommand === "rev-parse" && request.argv[2] === "HEAD") {
        return commandOutcome(request, `${this.head}\n`);
      }
      if (subcommand === "rev-parse" && request.argv[2] === "--abbrev-ref") {
        return commandOutcome(request, `${this.branch}\n`);
      }
      if (subcommand === "status") {
        return commandOutcome(request, this.dirtyFiles.map((path) => `?? ${path}\0`).join(""));
      }
      if (subcommand === "rev-parse" && request.argv[2] === "--verify") {
        const ref = request.argv[3] ?? "";
        if (this.baseTip !== null && ref === `${this.baseRef}^{commit}`) {
          return commandOutcome(request, `${this.baseTip}\n`);
        }
        return commandOutcome(request, "", 128, "fatal: Needed a single revision\n");
      }
      if (subcommand === "show" && (request.argv[2] ?? "").endsWith(":package.json")) {
        if (this.baseVersion === null) {
          return commandOutcome(request, "", 128, "fatal: path 'package.json' does not exist in the given tree\n");
        }
        return commandOutcome(
          request,
          `${JSON.stringify({ name: this.packageName, version: this.baseVersion })}\n`,
        );
      }
      if (subcommand === "merge-base" && request.argv[2] === "--is-ancestor") {
        if (this.baseContainsCommit === "unknown") {
          return commandOutcome(request, "", 128, "fatal: bad object\n");
        }
        return commandOutcome(request, "", this.baseContainsCommit ? 0 : 1);
      }
      return commandOutcome(request, "", 1, `unexpected git call: ${request.argv.join(" ")}`);
    }
    return commandOutcome(request, "", 1, `unexpected command: ${request.argv.join(" ")}`);
  }
}
