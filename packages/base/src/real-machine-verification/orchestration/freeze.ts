/**
 * `freeze`: turn one build into a candidate that can be checked later.
 *
 * The command's job is to answer "which source produced this tarball?" with
 * evidence, not with a promise. It therefore takes a git snapshot, builds,
 * packs, hashes the bytes it actually read, inspects the packaged client entry,
 * and takes a second git snapshot. If the source moved underneath the build the
 * candidate is refused: a manifest that cannot name its source is worse than no
 * manifest, because it looks authoritative.
 *
 * Every effect goes through `Ports`, so the whole flow is exercised in tests
 * with fake git, npm and filesystems.
 */
import type { CommitSha, Sha256Hex } from "../contracts/branding";
import { parseCommitSha } from "../contracts/branding";
import type {
  CandidateEntryCheck,
  CandidateEntryStatus,
  CandidateManifest,
  CandidatePackageFile,
} from "../contracts/candidate-rules";
import {
  CANDIDATE_SCHEMA_VERSION,
  packageManifestDigest,
  parseCandidateManifest,
} from "../contracts/candidate-rules";
import { digestOfFiles, sha256Bytes } from "../contracts/identity";
import type { Ports } from "../contracts/ports";
import { err, ok, type Failure, type FailureCode, type Result } from "../contracts/result";
import { readGitState, sameGitState, type GitState } from "../runtime/dsh/git-state";
import { parseNpmPackJson, unpackNpmTarball } from "../runtime/dsh/npm-pack";
import { joinFsPath, parentPath } from "../runtime/paths";
import type { DeclarationContext } from "./context";

/** Where a freeze stopped; the CLI uses it to label the failure stage. */
export type FreezeStage = "manifest" | "git" | "build" | "pack" | "entry" | "report";

export interface FreezeFailure extends Failure {
  readonly stage: FreezeStage;
  /** True when the candidate is unprovable rather than proven wrong (exit 2). */
  readonly blocked: boolean;
}

export interface PreviousCandidate {
  readonly dir: string;
  readonly manifestPath: string;
  readonly manifestSha256: Sha256Hex;
  readonly manifest: CandidateManifest;
}

export interface CandidateChangedFile {
  readonly path: string;
  readonly previousSha256: Sha256Hex;
  readonly sha256: Sha256Hex;
}

export interface CandidateChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly CandidateChangedFile[];
}

export interface FreezeOutcome {
  readonly candidate: CandidateManifest;
  readonly candidatePath: string;
  readonly candidateSha256: Sha256Hex;
  readonly previous: PreviousCandidate | null;
  /** Null when there is no earlier candidate for this commit. */
  readonly changes: CandidateChanges | null;
  readonly notes: readonly string[];
}

export interface FreezeOptions {
  readonly ports: Ports;
  readonly context: DeclarationContext;
  /** Absolute candidate output root. */
  readonly outDir: string;
  readonly allowDirty: boolean;
}

const TOOL_NAME = "dsh-verify";
const PACK_TIMEOUT_MS = 10 * 60_000;

function freezeFailure(
  stage: FreezeStage,
  code: FailureCode,
  message: string,
  options: { readonly hint?: string; readonly blocked?: boolean; readonly details?: Readonly<Record<string, unknown>> } = {},
): FreezeFailure {
  return {
    code,
    message,
    ...(options.hint === undefined ? {} : { hint: options.hint }),
    ...(options.details === undefined ? {} : { details: options.details }),
    stage,
    blocked: options.blocked === true,
  };
}

function wrapFailure<T>(
  result: Result<T>,
  stage: FreezeStage,
  prefix: string,
): Result<T, FreezeFailure> {
  if (result.ok) return ok(result.value);
  const { code, message, hint, details } = result.error;
  return err(
    freezeFailure(stage, code, `${prefix}: ${message}`, {
      ...(hint === undefined ? {} : { hint }),
      ...(details === undefined ? {} : { details }),
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tail(text: string, limit = 1500): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

function timestampForDirectory(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (match === null) return iso.replace(/[^0-9T]/g, "").slice(0, 15) || "unknown-time";
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}`;
}

/** `cmd /c` on Windows, `/bin/sh -c` elsewhere; the profile owns the command string. */
function shellArgv(ports: Ports, command: string): readonly string[] {
  if (ports.env.platform() === "win32") {
    return [ports.env.get("ComSpec") ?? "cmd.exe", "/d", "/s", "/c", command];
  }
  return ["/bin/sh", "-c", command];
}

function npmExecutable(ports: Ports): string {
  return ports.env.platform() === "win32" ? "npm.cmd" : "npm";
}

async function discard(fs: Ports["fs"], dir: string): Promise<void> {
  await fs.remove(dir, { recursive: true });
}

interface EntryClaims {
  readonly name: string | null;
  readonly version: string | null;
  readonly buildCommit: CommitSha | null;
}

/** Read the two facts a client bundle can be made to state about itself. */
export function readEntryClaims(text: string): EntryClaims {
  const banner = /\/\*!\s*([^\s*]+)\s+v([^\s*]+)\s*\*\//.exec(text);
  let name = banner?.[1] ?? null;
  let version = banner?.[2] ?? null;
  if (name === null) {
    name = /(?:PLUGIN_NAME|PACKAGE_NAME|pluginName|packageName)\s*[:=]\s*["']([^"']+)["']/.exec(text)?.[1] ?? null;
  }
  if (version === null) {
    version =
      /(?:PLUGIN_VERSION|PACKAGE_VERSION|pluginVersion|packageVersion|VERSION|version)\s*[:=]\s*["']([^"']+)["']/.exec(text)?.[1] ??
      null;
  }
  const rawCommit = /(?:DSW_BUILD_COMMIT|DSH_BUILD_COMMIT|BUILD_COMMIT|buildCommit)\s*[:=]\s*["']([0-9a-fA-F]{40})["']/.exec(text)?.[1];
  const parsed = rawCommit === undefined ? null : parseCommitSha(rawCommit.toLowerCase());
  return { name, version, buildCommit: parsed !== null && parsed.ok ? parsed.value : null };
}

function entryStatus(
  foundName: string | null,
  foundVersion: string | null,
  expectedName: string,
  expectedVersion: string,
): CandidateEntryStatus {
  if (foundName === null || foundVersion === null) return "blocked";
  return foundName === expectedName && foundVersion === expectedVersion ? "ok" : "mismatch";
}

async function findPreviousCandidate(
  fs: Ports["fs"],
  outDir: string,
  currentDir: string,
  commit: CommitSha,
): Promise<PreviousCandidate | null> {
  const listed = await fs.list(outDir);
  if (!listed.ok) return null;
  let best: { readonly candidate: PreviousCandidate; readonly ms: number } | null = null;
  for (const entry of listed.value) {
    if (entry.kind !== "directory") continue;
    const dir = joinFsPath(outDir, entry.name);
    if (dir === currentDir) continue;
    const manifestPath = joinFsPath(dir, "candidate.json");
    const text = await fs.readText(manifestPath);
    if (!text.ok) continue;
    let json: unknown;
    try {
      json = JSON.parse(text.value);
    } catch {
      continue;
    }
    const parsed = parseCandidateManifest(json);
    if (!parsed.ok) continue;
    if (parsed.value.git.commit !== commit) continue;
    const ms = Date.parse(parsed.value.generatedAt);
    const candidate: PreviousCandidate = {
      dir,
      manifestPath,
      manifestSha256: sha256Bytes(Buffer.from(text.value, "utf8")),
      manifest: parsed.value,
    };
    if (best === null || ms > best.ms || (ms === best.ms && manifestPath > best.candidate.manifestPath)) {
      best = { candidate, ms };
    }
  }
  return best === null ? null : best.candidate;
}

/** Compare two candidates by packaged path and content digest. */
export function diffCandidates(previous: CandidateManifest, current: CandidateManifest): CandidateChanges {
  const previousByPath = new Map(previous.package.files.map((file) => [file.path, file]));
  const currentByPath = new Map(current.package.files.map((file) => [file.path, file]));
  const added: string[] = [];
  const changed: CandidateChangedFile[] = [];
  for (const file of current.package.files) {
    const before = previousByPath.get(file.path);
    if (before === undefined) added.push(file.path);
    else if (before.sha256 !== file.sha256) {
      changed.push({ path: file.path, previousSha256: before.sha256, sha256: file.sha256 });
    }
  }
  const removed = previous.package.files.filter((file) => !currentByPath.has(file.path)).map((file) => file.path);
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort((a, b) => (a.path < b.path ? -1 : 1)) };
}

async function readRootPackage(fs: Ports["fs"], cwd: string): Promise<Result<{ name: string; version: string }, FreezeFailure>> {
  const path = joinFsPath(cwd, "package.json");
  const raw = await fs.readJson(path);
  if (!raw.ok) return wrapFailure(raw, "manifest", `could not read ${path}`);
  if (!isRecord(raw.value)) return err(freezeFailure("manifest", "invalid-input", `${path} must contain a JSON object`));
  if (typeof raw.value.name !== "string" || raw.value.name.length === 0) {
    return err(freezeFailure("manifest", "invalid-input", `${path} has no package name`, { hint: "add \"name\" to package.json" }));
  }
  if (typeof raw.value.version !== "string" || raw.value.version.length === 0) {
    return err(freezeFailure("manifest", "invalid-input", `${path} has no package version`, { hint: "add \"version\" to package.json" }));
  }
  return ok({ name: raw.value.name, version: raw.value.version });
}

/** Everything freeze decides before it runs a build or writes a byte. */
export interface FreezePlan {
  readonly outDir: string;
  readonly rootPackage: { readonly name: string; readonly version: string };
  readonly before: GitState;
  readonly generatedAt: string;
  readonly candidateName: string;
  readonly candidateDir: string;
  readonly previous: PreviousCandidate | null;
  readonly build: { readonly argv: readonly string[]; readonly cwd: string; readonly timeoutMs: number } | null;
  readonly pack: { readonly argv: readonly string[]; readonly cwd: string; readonly timeoutMs: number };
  readonly notes: readonly string[];
}

/**
 * Read the source facts and choose the output directory without writing.
 *
 * `--dry-run` prints this plan; a real freeze calls the same function and then
 * claims `candidateDir`, so the printed plan is the one that would execute.
 */
export async function planFreeze(options: FreezeOptions): Promise<Result<FreezePlan, FreezeFailure>> {
  const { ports, context, outDir, allowDirty } = options;
  const fs = ports.fs;

  const rootPackage = await readRootPackage(fs, context.cwd);
  if (!rootPackage.ok) return rootPackage;
  if (rootPackage.value.name !== context.profile.packageName) {
    return err(
      freezeFailure(
        "manifest",
        "identity-mismatch",
        `package.json names ${rootPackage.value.name}, but the profile verifies ${context.profile.packageName}`,
        { hint: "freeze from the package root the profile describes" },
      ),
    );
  }

  const beforeResult = await readGitState({ ports, cwd: context.cwd });
  if (!beforeResult.ok) return wrapFailure(beforeResult, "git", "could not read git state");
  const before: GitState = beforeResult.value;
  if (before.dirty && !allowDirty) {
    return err(
      freezeFailure(
        "git",
        "prerequisite",
        `working tree is dirty (${before.dirtyFiles.length} path(s)); refusing to freeze a release candidate`,
        {
          blocked: true,
          hint: "commit or stash the changes, or pass --allow-dirty to record a development candidate",
          details: { commit: before.commit, dirtyFiles: before.dirtyFiles.slice(0, 50) },
        },
      ),
    );
  }

  const generatedAt = ports.clock.iso();
  const candidateName = `${before.commit.slice(0, 12)}-${timestampForDirectory(generatedAt)}`;
  let candidateDir = "";
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const dir = joinFsPath(outDir, suffix === 1 ? candidateName : `${candidateName}-${suffix}`);
    if (await fs.exists(dir)) continue;
    candidateDir = dir;
    break;
  }
  if (candidateDir === "") {
    return err(
      freezeFailure("report", "conflict", `could not find a free candidate directory name for ${candidateName} under ${outDir}`, {
        hint: "remove stale candidates or freeze in a different second",
      }),
    );
  }

  const previous = await findPreviousCandidate(fs, outDir, candidateDir, before.commit);
  const notes: string[] = [];
  const build = context.profile.build;
  const buildPlan =
    build === undefined
      ? null
      : { argv: shellArgv(ports, build.command), cwd: context.cwd, timeoutMs: build.timeoutMs };
  if (buildPlan === null) {
    notes.push("profile declares no build command; the existing tree was packed without rebuilding");
  }
  const packPlan = {
    argv: [npmExecutable(ports), "pack", "--json", "--ignore-scripts", "--pack-destination", candidateDir] as readonly string[],
    cwd: context.cwd,
    timeoutMs: PACK_TIMEOUT_MS,
  };

  return ok({
    outDir,
    rootPackage: rootPackage.value,
    before,
    generatedAt,
    candidateName,
    candidateDir,
    previous,
    build: buildPlan,
    pack: packPlan,
    notes,
  });
}

/** Claim the planned directory; the only write before a build starts. */
async function claimCandidateDirectory(fs: Ports["fs"], plan: FreezePlan): Promise<Result<string, FreezeFailure>> {
  const madeOut = await fs.makeDir(plan.outDir);
  if (!madeOut.ok) return wrapFailure(madeOut, "report", `could not create candidate root ${plan.outDir}`);
  const made = await fs.makeDir(plan.candidateDir);
  if (!made.ok) return wrapFailure(made, "report", `could not create candidate directory ${plan.candidateDir}`);
  return ok(plan.candidateDir);
}

/** Build, pack and record one candidate. */
export async function freezeCandidate(options: FreezeOptions): Promise<Result<FreezeOutcome, FreezeFailure>> {
  const { ports, context } = options;
  const fs = ports.fs;

  const planned = await planFreeze(options);
  if (!planned.ok) return planned;
  const plan = planned.value;
  const { rootPackage, before, generatedAt } = plan;
  const claimed = await claimCandidateDirectory(fs, plan);
  if (!claimed.ok) return claimed;
  const candidateDir = claimed.value;

  const fail = async (
    stage: FreezeStage,
    code: FailureCode,
    message: string,
    options: { readonly hint?: string; readonly blocked?: boolean; readonly details?: Readonly<Record<string, unknown>> } = {},
  ): Promise<Result<FreezeOutcome, FreezeFailure>> => {
    await discard(fs, candidateDir);
    return err(freezeFailure(stage, code, message, options));
  };

  const previous = plan.previous;
  const notes = [...plan.notes];

  const build = context.profile.build;
  if (build === undefined) {
    // planFreeze already noted that the tree is packed without rebuilding.
  } else {
    const run = await ports.command.run({
      argv: plan.build?.argv ?? [],
      cwd: plan.build?.cwd ?? context.cwd,
      env: {
        ...ports.env.snapshot(),
        DSH_BUILD_COMMIT: before.commit,
        DSW_BUILD_COMMIT: before.commit,
      },
      timeoutMs: build.timeoutMs,
    });
    if (!run.ok) return wrapFailure(run, "build", "could not start the build command");
    if (run.value.timedOut) {
      return fail("build", "timeout", `build command timed out after ${build.timeoutMs}ms: ${build.command}`, {
        hint: "raise profile.build.timeoutMs or make the build finish sooner",
      });
    }
    if (run.value.exitCode !== 0) {
      return fail("build", "prerequisite", `build command failed with exit code ${String(run.value.exitCode)}: ${build.command}`, {
        hint: `build stderr: ${tail(run.value.stderr) || "(empty)"}`,
        details: { exitCode: run.value.exitCode, stdoutTail: tail(run.value.stdout), stderrTail: tail(run.value.stderr) },
      });
    }
  }

  const packed = await ports.command.run({
    argv: plan.pack.argv,
    cwd: plan.pack.cwd,
    timeoutMs: plan.pack.timeoutMs,
  });
  if (!packed.ok) return wrapFailure(packed, "pack", "could not start npm pack");
  if (packed.value.timedOut) {
    return fail("pack", "timeout", `npm pack timed out after ${PACK_TIMEOUT_MS}ms`, { hint: "check whether npm is waiting on a network prompt" });
  }
  if (packed.value.exitCode !== 0) {
    return fail("pack", "prerequisite", `npm pack failed with exit code ${String(packed.value.exitCode)}`, {
      hint: `npm stderr: ${tail(packed.value.stderr) || "(empty)"}`,
      details: { stdoutTail: tail(packed.value.stdout), stderrTail: tail(packed.value.stderr) },
    });
  }
  const packJson = parseNpmPackJson(packed.value.stdout);
  if (!packJson.ok) return fail("pack", "invalid-input", packJson.error.message, { hint: packJson.error.hint });
  if (packJson.value.length !== 1) {
    return fail(
      "pack",
      "conflict",
      `npm pack produced ${packJson.value.length} package(s); a candidate must be exactly one tarball`,
      { hint: "check the package's files/workspaces configuration so pack emits one package" },
    );
  }
  const packEntry = packJson.value[0];

  const listed = await fs.list(candidateDir);
  if (!listed.ok) return wrapFailure(listed, "pack", `could not list ${candidateDir}`);
  const tgzNames = listed.value
    .filter((entry) => entry.kind === "file" && entry.name.toLowerCase().endsWith(".tgz"))
    .map((entry) => entry.name);
  if (tgzNames.length !== 1) {
    return fail(
      "pack",
      "conflict",
      `npm pack left ${tgzNames.length} .tgz file(s) in ${candidateDir}; a candidate must be exactly one tarball`,
      { details: { files: tgzNames } },
    );
  }
  if (tgzNames[0] !== packEntry.filename) {
    return fail(
      "pack",
      "identity-mismatch",
      `npm pack reported ${JSON.stringify(packEntry.filename)} but wrote ${JSON.stringify(tgzNames[0])}`,
    );
  }

  const tgzPath = joinFsPath(candidateDir, tgzNames[0]);
  const tgzBytesResult = await fs.readBytes(tgzPath);
  if (!tgzBytesResult.ok) return wrapFailure(tgzBytesResult, "pack", `could not read ${tgzPath}`);
  const diskHash = await fs.hashFile(tgzPath);
  if (!diskHash.ok) return wrapFailure(diskHash, "pack", `could not hash ${tgzPath}`);
  const tgzSha256 = sha256Bytes(tgzBytesResult.value);
  if (diskHash.value !== tgzSha256) {
    return fail("pack", "io", "the tarball changed while it was being read; the candidate would not describe the file on disk", {
      hint: "freeze again on a quiet tree",
    });
  }
  const tgzBytes = tgzBytesResult.value;

  const unpacked = unpackNpmTarball(tgzBytes);
  if (!unpacked.ok) return fail("pack", "invalid-input", unpacked.error.message, { hint: unpacked.error.hint });
  const packedPackage = unpacked.value.packageJson;
  if (packedPackage.name !== plan.rootPackage.name) {
    return fail(
      "manifest",
      "identity-mismatch",
      `the packed package.json names ${JSON.stringify(packedPackage.name)}, but the source package is ${plan.rootPackage.name}`,
    );
  }
  if (packedPackage.version !== plan.rootPackage.version) {
    return fail(
      "manifest",
      "identity-mismatch",
      `the build changed the package version from ${plan.rootPackage.version} to ${JSON.stringify(packedPackage.version)}`,
      { hint: "bump the version in source before freezing; a candidate must name one version" },
    );
  }

  const files: CandidatePackageFile[] = unpacked.value.files.map((file) => ({
    path: file.path,
    bytes: file.bytes,
    sha256: sha256Bytes(file.content),
  }));
  const fileDigest = digestOfFiles(files.map((file) => ({ path: file.path, size: file.bytes, sha256: file.sha256 })));
  if (!fileDigest.ok) return fail("manifest", "internal", `could not digest the package file list: ${fileDigest.error.message}`);

  let entry: CandidateEntryCheck | undefined;
  let buildCommit: CommitSha | null = null;
  const clientEntry = context.profile.clientEntry;
  const entryFile = unpacked.value.files.find((file) => file.path === clientEntry);
  if (entryFile === undefined) {
    entry = {
      clientEntry,
      foundPackageName: null,
      foundVersion: null,
      status: "blocked",
      sha256: null,
    };
    notes.push(`client entry ${clientEntry} is not in the package; its plugin name and version could not be checked`);
  } else {
    const text = Buffer.from(entryFile.content).toString("utf8");
    const claims = readEntryClaims(text);
    const status = entryStatus(claims.name, claims.version, context.profile.packageName, plan.rootPackage.version);
    entry = {
      clientEntry,
      foundPackageName: claims.name,
      foundVersion: claims.version,
      status,
      sha256: sha256Bytes(entryFile.content),
    };
    buildCommit = claims.buildCommit;
    if (status === "mismatch") {
      return fail(
        "entry",
        "identity-mismatch",
        `packaged client entry states ${JSON.stringify(claims.name)} v${JSON.stringify(claims.version)}, expected ${context.profile.packageName} v${plan.rootPackage.version}`,
        {
          details: {
            clientEntry,
            expectedPackageName: context.profile.packageName,
            expectedVersion: plan.rootPackage.version,
            foundPackageName: claims.name,
            foundVersion: claims.version,
          },
        },
      );
    }
    if (status === "blocked") {
      notes.push(
        `client entry ${clientEntry} does not declare ${claims.name === null ? "a plugin name" : "a version"}; the entry check is blocked, not passed`,
      );
    }
    if (buildCommit === null) {
      notes.push(`client entry ${clientEntry} does not embed a build commit; package.buildCommit is null (unknown, not a pass)`);
    } else if (buildCommit !== before.commit) {
      return fail(
        "entry",
        "identity-mismatch",
        `client entry declares build commit ${buildCommit}, but the frozen source is ${before.commit}`,
        { hint: "rebuild from scratch; a cached bundle from another commit is not this candidate" },
      );
    }
  }

  const afterResult = await readGitState({ ports, cwd: context.cwd });
  if (!afterResult.ok) return wrapFailure(afterResult, "git", "could not re-read git state after packing");
  const after = afterResult.value;
  if (after.commit !== before.commit) {
    return fail(
      "git",
      "conflict",
      `HEAD changed during freeze (${before.commit} -> ${after.commit}); 候选说不清从哪份源码做出来的`,
      { hint: "freeze again from a checkout that does not move while building" },
    );
  }
  if (after.branch !== before.branch) notes.push(`branch changed during freeze: ${before.branch} -> ${after.branch}`);
  const sourceStable = sameGitState(before, after);
  if (!sourceStable) {
    notes.push("the dirty file set changed while the package was built; sourceStable is false");
  }

  const manifest: CandidateManifest = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    generatedAt,
    tool: TOOL_NAME,
    version: plan.rootPackage.version,
    validity: before.dirty ? "development" : "release",
    sourceStable,
    git: { commit: before.commit, branch: before.branch, dirty: before.dirty, dirtyFiles: before.dirtyFiles },
    package: {
      tgzPath,
      tgzBytes: tgzBytes.length,
      tgzSha256,
      filename: tgzNames[0],
      ...(packEntry.shasum === undefined ? {} : { npmShasum: packEntry.shasum }),
      ...(packEntry.integrity === undefined ? {} : { npmIntegrity: packEntry.integrity }),
      files,
      fileCount: files.length,
      fileDigest: fileDigest.value,
      manifestDigest: packageManifestDigest(packedPackage, before.commit),
      buildCommit,
    },
    ...(entry === undefined ? {} : { entry }),
    ...(notes.length === 0 ? {} : { notes }),
  };

  const check = parseCandidateManifest(manifest);
  if (!check.ok) {
    return fail("manifest", "internal", `freeze produced a manifest its own parser rejects: ${check.error.message}`);
  }

  const candidatePath = joinFsPath(candidateDir, "candidate.json");
  const written = await fs.writeJson(candidatePath, manifest);
  if (!written.ok) return wrapFailure(written, "report", `could not write ${candidatePath}`);
  const candidateBytes = await fs.readBytes(candidatePath);
  if (!candidateBytes.ok) return wrapFailure(candidateBytes, "report", `could not read back ${candidatePath}`);
  const candidateSha256 = sha256Bytes(candidateBytes.value);

  const changes = previous === null ? null : diffCandidates(previous.manifest, manifest);
  return ok({ candidate: manifest, candidatePath, candidateSha256, previous, changes, notes });
}