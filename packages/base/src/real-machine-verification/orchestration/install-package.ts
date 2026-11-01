/**
 * Install one candidate tarball into an isolated profile.
 *
 * Two methods exist because the real machine forced them:
 *
 * - `extract` (default) unpacks the tarball byte-for-byte with the same reader
 *   `freeze` uses, so it works across drives and never invokes npm.
 * - `cli` runs `npm install <tgz>` inside the profile, which is what a user
 *   would do, but npm's Windows path handling makes a cross-drive install fail
 *   with a hard-link error. The command refuses that combination up front and
 *   points at `extract` instead of letting npm produce a half-installed tree.
 *
 * After either method the same checks run against the *installed* bytes: package
 * identity, version, client-entry sha256, the version constant inside the client
 * entry, and the whole file list (from `candidate.json` when present, otherwise
 * from the tarball itself). Nothing here trusts the install step's exit code.
 */
import type { ProfileName } from "../contracts/branding";
import type { CheckResult } from "../contracts/check";
import { checkId } from "./types";
import type { CandidateManifest } from "../contracts/candidate-rules";
import { parseCandidateManifest } from "../contracts/candidate-rules";
import { sha256Bytes } from "../contracts/identity";
import type { Ports } from "../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../contracts/result";
import type { UnpackedTarball } from "../runtime/dsh/npm-pack";
import { unpackNpmTarball } from "../runtime/dsh/npm-pack";
import { joinFsPath, parentPath } from "../runtime/paths";
import type { BinaryWriter } from "../runtime/platform/binary-writer";
import { readEntryClaims } from "./freeze";

export type InstallMethod = "extract" | "cli";
export const INSTALL_METHODS: readonly InstallMethod[] = ["extract", "cli"];
export const DEFAULT_INSTALL_METHOD: InstallMethod = "extract";
export const CANDIDATE_FILE = "candidate.json";

export type InstallStage = "input" | "unpack" | "install" | "profile" | "verify";
export type InstallFailure = Failure & { readonly stage: InstallStage };

export interface InstallPackageOptions {
  readonly ports: Ports;
  /** The only binary write path; see runtime/platform/binary-writer.ts. */
  readonly binaryWriter: BinaryWriter;
  /** Absolute path to the candidate tarball. */
  readonly tgzPath: string;
  readonly method: InstallMethod;
  readonly dshHome: string;
  readonly profileName: ProfileName;
  readonly profileDir: string;
  readonly packageName: string;
  readonly clientEntry: string;
  /** `--candidate`: a candidate directory (holding candidate.json) or the file itself. */
  readonly candidatePath?: string | null;
  /** Progress lines; the CLI sends these to stderr. */
  readonly note?: (message: string) => void;
  /** Override for the npm executable; tests inject a fake through CommandPort instead. */
  readonly npmCommand?: string;
}

export interface InstallOutcome {
  readonly method: InstallMethod;
  readonly targetDir: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly clientEntry: string;
  readonly expectedSource: "candidate" | "tgz";
  readonly candidatePath: string | null;
  readonly expectedFileCount: number;
  readonly installedFileCount: number;
  readonly checks: readonly CheckResult[];
  readonly notes: readonly string[];
}

export interface ExpectedFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface ActualFile {
  readonly bytes: number;
  readonly sha256: string;
}

function installFailure(stage: InstallStage, failureValue: Failure): InstallFailure {
  return { ...failureValue, stage };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function tail(text: string, limit = 1200): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function driveOf(path: string): string | null {
  const match = /^([A-Za-z]):[\\/]/.exec(path);
  return match === null ? null : (match[1] ?? "").toLowerCase();
}

function relativePath(root: string, absolute: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  const normalizedAbsolute = absolute.replace(/\\/g, "/");
  const prefix = normalizedRoot.replace(/\\/g, "/") + "/";
  return normalizedAbsolute.startsWith(prefix)
    ? normalizedAbsolute.slice(prefix.length)
    : normalizedAbsolute;
}

/** Recursively list regular files under `root`, as "/"-separated relative paths. */
async function listInstalledFiles(
  ports: Ports,
  root: string,
): Promise<Result<ReadonlyMap<string, string>>> {
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<Result<void>> => {
    const listed = await ports.fs.list(dir);
    if (!listed.ok) return listed;
    for (const entry of listed.value) {
      const absolute = joinFsPath(dir, entry.name);
      if (entry.kind === "directory") {
        const nested = await walk(absolute);
        if (!nested.ok) return nested;
      } else if (entry.kind === "file") {
        files.set(relativePath(root, absolute), absolute);
      }
    }
    return ok(undefined);
  };
  const walked = await walk(root);
  return walked.ok ? ok(files) : walked;
}

async function readCandidate(
  ports: Ports,
  rawPath: string,
): Promise<Result<{ manifest: CandidateManifest; path: string }>> {
  const stat = await ports.fs.stat(rawPath);
  if (!stat.ok) {
    return err(
      installFailure(
        "input",
        failure(
          "prerequisite",
          `candidate path ${rawPath} is not readable: ${stat.error.message}`,
          "pass the candidate directory produced by freeze (it holds candidate.json), or omit --candidate to verify against the tarball itself",
        ),
      ),
    );
  }
  const file = stat.value.kind === "directory" ? joinFsPath(rawPath, CANDIDATE_FILE) : rawPath;
  const raw = await ports.fs.readJson(file);
  if (!raw.ok) {
    return err(
      installFailure(
        "input",
        failure(
          "prerequisite",
          `could not read ${file}: ${raw.error.message}`,
          "pass the candidate directory produced by freeze (it holds candidate.json), or omit --candidate to verify against the tarball itself",
        ),
      ),
    );
  }
  const parsed = parseCandidateManifest(raw.value);
  if (!parsed.ok) {
    return err(
      installFailure(
        "input",
        failure(
          "invalid-input",
          `${file} is not a candidate manifest: ${parsed.error.message}`,
          "regenerate the candidate with dsh-verify freeze",
        ),
      ),
    );
  }
  return ok({ manifest: parsed.value, path: file });
}

function expectedFromTarball(unpacked: UnpackedTarball): ExpectedFile[] {
  return unpacked.files
    .map((file) => ({ path: file.path, bytes: file.bytes, sha256: sha256Bytes(file.content) }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function expectedFromCandidate(manifest: CandidateManifest): ExpectedFile[] {
  return manifest.package.files
    .map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function row(
  id: string,
  title: string,
  status: CheckResult["status"],
  detail: string,
  extra: { expected?: string; actual?: string; hint?: string } = {},
): CheckResult {
  return {
    id: checkId(id),
    title,
    hard: true,
    status,
    detail,
    ...(extra.expected === undefined ? {} : { expected: extra.expected }),
    ...(extra.actual === undefined ? {} : { actual: extra.actual }),
    ...(extra.hint === undefined ? {} : { hint: extra.hint }),
    evidence: [],
    durationMs: 0,
    source: "builtin",
  };
}

function installedFilesDetail(
  expected: readonly ExpectedFile[],
  actual: ReadonlyMap<string, ActualFile>,
): { ok: boolean; detail: string; actual: string } {
  const missing: string[] = [];
  const changed: string[] = [];
  const expectedPaths = new Set<string>();
  for (const file of expected) {
    expectedPaths.add(file.path);
    const found = actual.get(file.path);
    if (found === undefined) {
      missing.push(file.path);
    } else if (found.sha256 !== file.sha256 || found.bytes !== file.bytes) {
      changed.push(`${file.path} (expected ${file.bytes}B/${file.sha256.slice(0, 12)}, got ${found.bytes}B/${found.sha256.slice(0, 12)})`);
    }
  }
  const extra = [...actual.keys()].filter((path) => !expectedPaths.has(path)).sort();
  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing: ${missing.join(", ")}`);
  if (changed.length > 0) problems.push(`changed: ${changed.join(", ")}`);
  if (extra.length > 0) problems.push(`extra: ${extra.join(", ")}`);
  const actualText = `${actual.size} installed file(s)`;
  return {
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `${expected.length} file(s) match byte-for-byte`
        : problems.join("; "),
    actual: actualText,
  };
}

async function writeProfileDependency(
  ports: Ports,
  profileDir: string,
  profileName: ProfileName,
  packageName: string,
  tgzPath: string,
): Promise<Result<{ readonly created: boolean }>> {
  const manifestPath = joinFsPath(profileDir, "package.json");
  const existing = await ports.fs.readJson(manifestPath);
  let manifest: Record<string, unknown>;
  let created = false;
  if (existing.ok) {
    const record = asRecord(existing.value);
    if (record === null) {
      return err(
        installFailure(
          "profile",
          failure(
            "invalid-input",
            `${manifestPath} is not a JSON object`,
            "fix or remove the profile package.json, then rerun install",
          ),
        ),
      );
    }
    manifest = record;
  } else {
    manifest = { name: profileName, private: true };
    created = true;
  }
  const dependencies = asRecord(manifest.dependencies) ?? {};
  const spec = `file:${tgzPath.replace(/\\/g, "/")}`;
  manifest = { ...manifest, dependencies: { ...dependencies, [packageName]: spec } };
  const written = await ports.fs.writeJson(manifestPath, manifest);
  if (!written.ok) {
    return err(
      installFailure(
        "profile",
        failure("io", `could not write ${manifestPath}: ${written.error.message}`, "check the profile directory is writable"),
      ),
    );
  }
  return ok({ created });
}

/** Everything install decides before it writes: source bytes, target, expected files. */
export interface InstallPlan {
  readonly tgzPath: string;
  readonly tgzSha256: string;
  readonly method: InstallMethod;
  readonly profileDir: string;
  readonly targetDir: string;
  readonly nodeModulesDir: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly clientEntry: string;
  readonly expectedSource: "candidate" | "tgz";
  readonly candidatePath: string | null;
  readonly expectedFiles: readonly ExpectedFile[];
  readonly expectedFileCount: number;
  readonly willReplaceExisting: boolean;
  readonly profileManifestPath: string;
  readonly dependencySpec: string;
  readonly npmArgv: readonly string[] | null;
  readonly notes: readonly string[];
  readonly candidate: CandidateManifest | null;
  readonly unpacked: UnpackedTarball;
}

export type InstallPlanOptions = Omit<InstallPackageOptions, "binaryWriter" | "note">;

/**
 * Read the tarball (and candidate, when given) and decide where it would land.
 *
 * `--dry-run` prints this plan; `installPackage` starts from the same value, so
 * the printed target directory and file list are the ones a real run uses.
 */
export async function planInstall(options: InstallPlanOptions): Promise<Result<InstallPlan, InstallFailure>> {
  const { ports, tgzPath, method, profileDir, packageName, clientEntry } = options;
  const notes: string[] = [];

  const bytes = await ports.fs.readBytes(tgzPath);
  if (!bytes.ok) {
    return err(
      installFailure(
        "input",
        failure(
          "prerequisite",
          `could not read tarball ${tgzPath}: ${bytes.error.message}`,
          "pass the .tgz produced by npm pack or dsh-verify freeze",
        ),
      ),
    );
  }
  const unpacked = unpackNpmTarball(bytes.value);
  if (!unpacked.ok) {
    return err(installFailure("unpack", unpacked.error));
  }
  const packageJson = asRecord(unpacked.value.packageJson);
  const packageVersion = packageJson === null ? null : readString(packageJson, "version");
  const packedName = packageJson === null ? null : readString(packageJson, "name");
  if (packedName === null || packageVersion === null) {
    return err(
      installFailure(
        "unpack",
        failure(
          "invalid-input",
          `${tgzPath} has no readable package name/version`,
          "the tarball must contain package/package.json with name and version",
        ),
      ),
    );
  }
  if (packedName !== packageName) {
    return err(
      installFailure(
        "input",
        failure(
          "identity-mismatch",
          `tarball contains ${packedName}@${packageVersion}, but the profile expects ${packageName}`,
          "install the tarball this profile declares, or change the profile's packageName",
        ),
      ),
    );
  }

  let candidate: CandidateManifest | null = null;
  let candidateFile: string | null = null;
  if (options.candidatePath !== undefined && options.candidatePath !== null && options.candidatePath !== "") {
    const read = await readCandidate(ports, options.candidatePath);
    if (!read.ok) return err(installFailure("input", read.error));
    candidate = read.value.manifest;
    candidateFile = read.value.path;
    notes.push(`expected file list comes from ${candidateFile}`);
  } else {
    notes.push("expected file list comes from the tarball itself (no --candidate)");
  }

  const expectedFiles =
    candidate === null ? expectedFromTarball(unpacked.value) : expectedFromCandidate(candidate);
  const expectedSource: "candidate" | "tgz" = candidate === null ? "tgz" : "candidate";
  const targetDir = joinFsPath(profileDir, "node_modules", packageName);
  const platform = ports.env.platform();
  if (method === "cli") {
    const sourceDrive = driveOf(tgzPath);
    const targetDrive = driveOf(profileDir);
    if (platform === "win32" && sourceDrive !== null && targetDrive !== null && sourceDrive !== targetDrive) {
      return err(
        installFailure(
          "input",
          failure(
            "unsupported",
            `npm cannot install across drives (${sourceDrive}: -> ${targetDrive}:) without hard links`,
            "rerun with --method extract; it unpacks the same tarball and does not need a shared drive",
          ),
        ),
      );
    }
  }
  const npmArgv =
    method === "cli"
      ? [
          options.npmCommand ?? (platform === "win32" ? "npm.cmd" : "npm"),
          "install",
          tgzPath,
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ]
      : null;

  return ok({
    tgzPath,
    tgzSha256: sha256Bytes(bytes.value),
    method,
    profileDir,
    targetDir,
    nodeModulesDir: joinFsPath(profileDir, "node_modules"),
    packageName,
    packageVersion,
    clientEntry,
    expectedSource,
    candidatePath: candidateFile,
    expectedFiles,
    expectedFileCount: expectedFiles.length,
    willReplaceExisting: await ports.fs.exists(targetDir),
    profileManifestPath: joinFsPath(profileDir, "package.json"),
    dependencySpec: `file:${tgzPath.replace(/\\/g, "/")}`,
    npmArgv,
    notes,
    candidate,
    unpacked: unpacked.value,
  });
}

export async function installPackage(options: InstallPackageOptions): Promise<Result<InstallOutcome, InstallFailure>> {
  const { ports, method, profileDir, profileName, packageName, tgzPath } = options;
  const note = options.note ?? (() => undefined);

  note(`reading ${tgzPath}`);
  const planned = await planInstall({
    ports,
    tgzPath,
    method,
    dshHome: options.dshHome,
    profileName,
    profileDir,
    packageName,
    clientEntry: options.clientEntry,
    ...(options.candidatePath === undefined ? {} : { candidatePath: options.candidatePath }),
    ...(options.npmCommand === undefined ? {} : { npmCommand: options.npmCommand }),
  });
  if (!planned.ok) return err(planned.error);
  const plan = planned.value;
  const notes = [...plan.notes];
  const { packageVersion, targetDir, expectedFiles, expectedSource, clientEntry } = plan;

  note(`installing ${plan.packageName}@${packageVersion} into ${targetDir} via ${method}`);
  const made = await ports.fs.makeDir(plan.nodeModulesDir);
  if (!made.ok) {
    return err(
      installFailure(
        "install",
        failure("io", `could not create ${plan.nodeModulesDir}: ${made.error.message}`, "check the profile directory is writable"),
      ),
    );
  }
  if (plan.willReplaceExisting) {
    const removed = await ports.fs.remove(targetDir, { recursive: true });
    if (!removed.ok) {
      return err(
        installFailure(
          "install",
          failure("io", `could not replace ${targetDir}: ${removed.error.message}`, "stop the instance and retry; a running process may hold files"),
        ),
      );
    }
  }
  const targetMade = await ports.fs.makeDir(targetDir);
  if (!targetMade.ok) {
    return err(
      installFailure(
        "install",
        failure("io", `could not create ${targetDir}: ${targetMade.error.message}`, "check the profile directory is writable"),
      ),
    );
  }

  if (method === "extract") {
    for (const file of plan.unpacked.files) {
      const target = joinFsPath(targetDir, ...file.path.split("/"));
      const parent = parentPath(target) ?? targetDir;
      const parentMade = await ports.fs.makeDir(parent);
      if (!parentMade.ok) {
        return err(
          installFailure("install", failure("io", `could not create ${parent}: ${parentMade.error.message}`)),
        );
      }
      const written = await options.binaryWriter.write(target, file.content);
      if (!written.ok) {
        return err(installFailure("install", written.error));
      }
    }
  } else {
    const npmArgv = plan.npmArgv ?? [];
    const npm = npmArgv[0] ?? "npm";
    const run = await ports.command.run({
      argv: npmArgv,
      cwd: profileDir,
      timeoutMs: 180_000,
    });
    if (!run.ok) {
      return err(
        installFailure(
          "install",
          failure("io", `could not run ${npm}: ${run.error.message}`, "install Node.js/npm on PATH, or rerun with --method extract"),
        ),
      );
    }
    if (run.value.exitCode !== 0) {
      return err(
        installFailure(
          "install",
          failure(
            "io",
            `${npm} install exited with ${run.value.exitCode ?? run.value.signal ?? "no status"}`,
            "rerun with --method extract; it does not invoke npm",
            { stderr: tail(run.value.stderr), stdout: tail(run.value.stdout) },
          ),
        ),
      );
    }
  }

  const dependency = await writeProfileDependency(ports, profileDir, profileName, packageName, tgzPath);
  if (!dependency.ok) return err(installFailure("profile", dependency.error));

  note("verifying installed bytes");
  const checks: CheckResult[] = [];
  const installedManifestPath = joinFsPath(targetDir, "package.json");
  const installedManifest = await ports.fs.readJson(installedManifestPath);
  const installedRecord = installedManifest.ok ? asRecord(installedManifest.value) : null;
  const installedName = installedRecord === null ? null : readString(installedRecord, "name");
  const installedVersion = installedRecord === null ? null : readString(installedRecord, "version");

  checks.push(
    installedName === packageName
      ? row("package-installed", "package is installed", "pass", `${packageName}@${installedVersion ?? "?"} is at ${targetDir}`)
      : row(
          "package-installed",
          "package is installed",
          "fail",
          installedManifest.ok ? `${installedManifestPath} does not name ${packageName}` : `${installedManifestPath} is unreadable`,
          {
            expected: `${installedManifestPath} with name ${packageName}`,
            actual: installedManifest.ok ? JSON.stringify(installedManifest.value) : installedManifest.error.message,
            hint: "rerun install; if the profile was modified by hand, remove node_modules and install again",
          },
        ),
  );

  checks.push(
    installedVersion === packageVersion
      ? row("package-version", "installed version matches the tarball", "pass", `version ${packageVersion}`)
      : row(
          "package-version",
          "installed version matches the tarball",
          "fail",
          `installed version is ${installedVersion ?? "missing"}`,
          {
            expected: packageVersion,
            actual: installedVersion ?? "missing",
            hint: "the profile is holding a different build; rerun install from this tarball",
          },
        ),
  );

  const entryExpected =
    plan.candidate?.entry !== undefined && plan.candidate.entry.clientEntry === clientEntry
      ? plan.candidate.entry.sha256
      : expectedFiles.find((file) => file.path === clientEntry)?.sha256 ?? null;
  const entryPath = joinFsPath(targetDir, ...clientEntry.split("/"));
  const entryHash = await ports.fs.hashFile(entryPath);
  checks.push(
    entryExpected === null
      ? row("package-client-entry", "client entry matches the tarball", "fail", `${clientEntry} is not in the expected file list`, {
          expected: clientEntry,
          actual: "absent from the tarball/candidate file list",
          hint: "check profile.clientEntry; the tarball must contain that path",
        })
      : entryHash.ok && entryHash.value === entryExpected
        ? row("package-client-entry", "client entry matches the tarball", "pass", `${clientEntry} sha256 ${entryExpected.slice(0, 12)}…`)
        : row(
            "package-client-entry",
            "client entry matches the tarball",
            "fail",
            entryHash.ok ? `${clientEntry} sha256 differs` : `${clientEntry} is unreadable`,
            {
              expected: entryExpected,
              actual: entryHash.ok ? entryHash.value : entryHash.error.message,
              hint: "rerun install; a stale or partial client entry means the install did not copy the candidate",
            },
          ),
  );

  const entryText = await ports.fs.readText(entryPath);
  const claims = entryText.ok ? readEntryClaims(entryText.value) : null;
  const claimsMatch = claims !== null && claims.name === packageName && claims.version === packageVersion;
  checks.push(
    claimsMatch
      ? row("package-version-constant", "client entry states the package identity", "pass", `${packageName}@${packageVersion}`)
      : row(
          "package-version-constant",
          "client entry states the package identity",
          "fail",
          claims === null
            ? `${clientEntry} is unreadable`
            : `client entry states ${claims.name ?? "no name"}@${claims.version ?? "no version"}`,
          {
            expected: `${packageName}@${packageVersion}`,
            actual: claims === null ? "unreadable" : `${claims.name ?? "no name"}@${claims.version ?? "no version"}`,
            hint: "the build must embed its package name and version; rebuild before freezing the candidate",
          },
        ),
  );

  const listed = await listInstalledFiles(ports, targetDir);
  let fileCheck: CheckResult;
  if (!listed.ok) {
    fileCheck = row("package-files", "installed files match the expected list", "fail", `could not list ${targetDir}: ${listed.error.message}`, {
      expected: `${expectedFiles.length} file(s) from ${expectedSource}`,
      actual: listed.error.message,
      hint: "check the profile directory permissions",
    });
  } else {
    const actualFiles = new Map<string, ActualFile>();
    let hashFailure: string | null = null;
    for (const [path, absolute] of listed.value) {
      const [hashed, stat] = await Promise.all([ports.fs.hashFile(absolute), ports.fs.stat(absolute)]);
      if (!hashed.ok || !stat.ok) {
        hashFailure = `${path}: ${hashed.ok ? stat.ok ? "unknown" : stat.error.message : hashed.error.message}`;
        break;
      }
      actualFiles.set(path, { bytes: stat.value.size, sha256: hashed.value });
    }
    if (hashFailure !== null) {
      fileCheck = row("package-files", "installed files match the expected list", "fail", hashFailure, {
        expected: `${expectedFiles.length} file(s) from ${expectedSource}`,
        actual: hashFailure,
        hint: "rerun install; an unreadable installed file cannot be verified",
      });
    } else {
      const compared = installedFilesDetail(expectedFiles, actualFiles);
      fileCheck = row(
        "package-files",
        "installed files match the expected list",
        compared.ok ? "pass" : "fail",
        compared.ok ? `${compared.detail} (source: ${expectedSource})` : compared.detail,
        compared.ok
          ? {}
          : {
              expected: `${expectedFiles.length} file(s) from ${expectedSource}`,
              actual: compared.actual,
              hint: expectedSource === "candidate" ? "rerun install from the candidate tarball; do not edit installed files" : "rerun install; the tarball and installed tree differ",
            },
      );
    }
  }
  checks.push(fileCheck);

  const installedFileCount = listed.ok ? listed.value.size : 0;
  if (dependency.value.created) notes.push(`created ${joinFsPath(profileDir, "package.json")} with the package dependency`);

  return ok({
    method,
    targetDir,
    packageName,
    packageVersion,
    clientEntry,
    expectedSource,
    candidatePath: plan.candidatePath,
    expectedFileCount: plan.expectedFileCount,
    installedFileCount,
    checks,
    notes,
  });
}