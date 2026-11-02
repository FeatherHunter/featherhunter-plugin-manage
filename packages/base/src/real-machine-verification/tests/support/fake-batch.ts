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
import { sha256Text } from "../../contracts/identity";
import { defineVerificationProfile } from "../../contracts/verification-profile";
import type { VerificationDeclaration } from "../../declaration/loader";
import { joinFsPath } from "../../runtime/paths";
import { FakeClock, FakeEnv, FakeFs } from "./fake-fs";
import { FakeCommand, FakeHttp, FakeProcess, FakeScreen, createFakeBrowser, makePorts } from "./fake-ports";

export const FIXTURE_HEAD = "0123456789abcdef0123456789abcdef01234567";
export const OTHER_HEAD = "89abcdef0123456789abcdef0123456789abcdef";
export const BASE_TIP = "abcdef0123456789abcdef0123456789abcdef01";
export const NEW_BASE_TIP = "2222222222222222222222222222222222222222";
/** The tarball digest the fixture candidate manifest declares (`package.tgzSha256`). */
export const CANDIDATE_TGZ_SHA256 = "a".repeat(64);

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

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
  readonly commit?: string;
  readonly version?: string;
  readonly validity?: "release" | "development";
  readonly generatedAt?: string;
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

function candidateManifest(
  options: { commit: string; version: string; validity: "release" | "development"; generatedAt: string; dir: string },
): Record<string, unknown> {
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
      tgzBytes: 256,
      tgzSha256: CANDIDATE_TGZ_SHA256,
      filename: `fixture-plugin-${options.version}.tgz`,
      files: [{ path: "package.json", bytes: 48, sha256: SHA_B }],
      fileCount: 1,
      fileDigest: SHA_C,
      manifestDigest: SHA_D,
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

  /** Seed another candidate under the default work root; returns its identity. */
  seedCandidate(options: SeedCandidateOptions = {}): CandidateFixture {
    const dirName = options.dirName ?? "cand-1";
    const dir = joinFsPath(this.workRoot, "candidates", dirName);
    const commit = options.commit ?? this.head;
    const version = options.version ?? this.version;
    const manifest = candidateManifest({
      commit,
      version,
      validity: options.validity ?? "release",
      generatedAt: options.generatedAt ?? "2026-11-01T20:00:00.000Z",
      dir,
    });
    const path = joinFsPath(dir, "candidate.json");
    this.fs.seedJson(path, manifest);
    const text = this.fs.readFileSync(path);
    return {
      dir,
      path,
      text,
      sha256: sha256Text(text),
      tgzSha256: CANDIDATE_TGZ_SHA256,
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
      return commandOutcome(request, "", 1, `unexpected git call: ${request.argv.join(" ")}`);
    }
    return commandOutcome(request, "", 1, `unexpected command: ${request.argv.join(" ")}`);
  }
}
