/**
 * `dsh-verify evidence` — attach evidence to a batch, archive a batch, or
 * verify an archive.
 *
 * The command is deliberately thin: copying, manifest merging, checksum
 * rendering and archive verification all live in `evidence/`, are injected with
 * ports, and are tested without a machine. What is here is the CLI contract —
 * which flags each subcommand accepts, how a batch directory is located, the two
 * output modes and the exit-code mapping (0 ok, 1 hard failure, 2 prerequisite).
 *
 * Two decisions worth calling out:
 *
 * - The candidate identity is never read from argv. It arrives in the injected
 *   batch context (the batch record, ticket 09); `buildEvidenceManifest` writes
 *   it last and skips reserved keys from `extra`, so no flag can shadow it.
 * - When no batch context is injected, `--dir` or `--name` locate the batch for
 *   manual use. That fallback exists for humans and tests, not for the runner,
 *   which always injects the batch it just created.
 *
 * Output contract: with `--json`, stdout carries exactly one JSON document and
 * everything else goes to stderr; without it, stdout carries the human result
 * lines. `verify` reports archive disagreements as `ok:false` in the same JSON
 * shape as a successful verification (plus `issues`), and exits 1.
 */

import { EXIT_CODES } from "../../capability-description";
import { asEvidencePath, parseBatchName, parseCheckId } from "../../contracts/branding";
import type { EvidenceManifest, EvidenceManifestItem } from "../../contracts/evidence-contract";
import type { Ports } from "../../contracts/ports";
import { failure, formatFailure, ok, type Failure, type Result } from "../../contracts/result";
import { archiveEvidence, planEvidenceArchive } from "../../evidence/archive";
import {
  EVIDENCE_MANIFEST_FILENAME,
  buildEvidenceManifest,
  loadEvidenceManifest,
  mergeEvidenceManifest,
  writeEvidenceManifest,
  type BuildEvidenceManifestInput,
  type EvidenceCheckLine,
} from "../../evidence/manifest";
import {
  DEFAULT_ARCHIVE_ROOT_DIRNAME,
  EVIDENCE_DIRNAME,
  EVIDENCE_FILES_DIRNAME,
  MAX_EVIDENCE_ORDINAL,
  evidenceFilesRelativePath,
  sanitizeEvidenceFileName,
  withOrdinal,
} from "../../evidence/paths";
import { verifyEvidenceArchive } from "../../evidence/verify";
import { resolveWorkRoot } from "../../orchestration/context";
import { baseName, joinFsPath, resolveAgainst } from "../../runtime/paths";
import type { ParsedArgs } from "../args";
import type { CliIo } from "../io";

/** The usage line, repeated in errors so a caller never has to read `describe`. */
export const EVIDENCE_USAGE =
  "dsh-verify evidence add|archive|verify [--file <p>]... [--check <id>=pass|fail] [--archive-root <dir>] [--dir <batch-or-archive-dir>] [--name <batch-name>] [--work-root <dir>] [--json] [--dry-run]";

const EVIDENCE_SUBCOMMANDS = ["add", "archive", "verify"] as const;
type EvidenceSubcommand = (typeof EVIDENCE_SUBCOMMANDS)[number];

const ADD_FLAGS: ReadonlySet<string> = new Set(["--json", "--dry-run", "--file", "--check", "--dir", "--name", "--work-root"]);
const ARCHIVE_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--dry-run",
  "--archive-root",
  "--dir",
  "--name",
  "--work-root",
]);
const VERIFY_FLAGS: ReadonlySet<string> = new Set(["--json", "--dir"]);

const SUBCOMMAND_FLAGS: Readonly<Record<EvidenceSubcommand, ReadonlySet<string>>> = {
  add: ADD_FLAGS,
  archive: ARCHIVE_FLAGS,
  verify: VERIFY_FLAGS,
};

/**
 * Batch context injected by the command layer.
 *
 * `candidate` is the identity binding from the batch record; it is the only
 * source for `evidence.json.candidate`. CLI flags cannot provide it.
 */
export interface EvidenceBatchContext {
  readonly batchName: string;
  readonly batchDir: string;
  readonly workRoot?: string;
  readonly candidate?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, string>>;
  readonly summary?: Readonly<Record<string, unknown>>;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** Everything the command needs injected; the CLI wires the real machine. */
export interface EvidenceCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly batch?: EvidenceBatchContext;
  /**
   * Resolve `--batch` / `--name` into the identity-bearing batch context.
   *
   * The CLI wires this to the batch layer so a named batch that has no record or
   * no frozen candidate is a blocked prerequisite instead of an evidence package
   * that can never be bound. Injected context still wins; no name means `null`
   * and the command keeps its own default.
   */
  readonly loadBatch?: (args: ParsedArgs) => Promise<Result<EvidenceBatchContext | null, Failure>>;
}

/** The evidence-side half of the JSON contract: one failure document. */
function failureJson(subcommand: string | null, stage: string, error: Failure): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    command: "evidence",
    subcommand,
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.details === undefined ? {} : { details: error.details }),
      stage,
    },
  })}\n`;
}

/** Report a usage/prerequisite problem in whichever mode the caller asked for. */
function reject(
  args: ParsedArgs,
  io: CliIo,
  subcommand: string | null,
  stage: string,
  message: string,
): number {
  io.stderr(`dsh-verify evidence: ${message}\n`);
  if (args.json) io.stdout(failureJson(subcommand, stage, failure("invalid-input", message)));
  return EXIT_CODES.blocked;
}

/** Report an execution failure; `not-found`/`prerequisite` are blocked (2), the rest are 1. */
function failWith(
  args: ParsedArgs,
  deps: EvidenceCommandDeps,
  subcommand: EvidenceSubcommand,
  error: Failure,
  stage: string,
): number {
  deps.io.stderr(`dsh-verify evidence ${subcommand}: ${formatFailure(error)}\n`);
  if (args.json) deps.io.stdout(failureJson(subcommand, stage, error));
  return error.code === "not-found" || error.code === "prerequisite"
    ? EXIT_CODES.blocked
    : EXIT_CODES.hardFailure;
}

type ValidationOutcome =
  | { readonly ok: true; readonly subcommand: EvidenceSubcommand }
  | { readonly ok: false; readonly message: string };

function isEvidenceSubcommand(value: string): value is EvidenceSubcommand {
  return (EVIDENCE_SUBCOMMANDS as readonly string[]).includes(value);
}

/**
 * Validate the invocation shape for `evidence`.
 *
 * `flagProblems` cannot be reused here because `evidence add` legitimately has
 * two positionals (command + subcommand); everything else follows the same
 * policy: unknown options, structural problems, a recognized flag that belongs
 * to another command, or a stray positional are all usage errors (exit 2).
 */
function validateInvocation(args: ParsedArgs): ValidationOutcome {
  if (args.command !== "evidence") {
    return { ok: false, message: `证据命令被错误分发（收到 ${args.command ?? "空命令"}）` };
  }
  const problems: string[] = [];
  if (args.unknown.length > 0) problems.push(`unknown option(s): ${args.unknown.join(", ")}`);
  for (const problem of args.problems) problems.push(problem);
  const subcommand = args.positional[1];
  if (subcommand === undefined) {
    return { ok: false, message: `缺少子命令（add|archive|verify）\n${EVIDENCE_USAGE}` };
  }
  if (!isEvidenceSubcommand(subcommand)) {
    return { ok: false, message: `未知子命令 "${subcommand}"（支持 add|archive|verify）\n${EVIDENCE_USAGE}` };
  }
  if (args.positional.length > 2) {
    problems.push(`unexpected argument(s): ${args.positional.slice(2).join(" ")}`);
  }
  const allowed = SUBCOMMAND_FLAGS[subcommand];
  const notAllowed = [...new Set(args.given)].filter((flag) => !allowed.has(flag)).sort();
  if (notAllowed.length > 0) {
    problems.push(`option(s) not valid for evidence ${subcommand}: ${notAllowed.join(", ")}`);
  }
  if (problems.length > 0) return { ok: false, message: `${problems.join("; ")}\n${EVIDENCE_USAGE}` };
  return { ok: true, subcommand };
}

/* -------------------------------------------------------------- batch context */

interface ResolvedBatch {
  readonly batchName: string;
  readonly batchDir: string;
  readonly workRoot: string;
  readonly candidate?: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly extra?: Readonly<Record<string, unknown>>;
}

type BatchResolution =
  | { readonly ok: true; readonly batch: ResolvedBatch }
  | { readonly ok: false; readonly error: Failure };

/**
 * Locate the batch for `add`/`archive`.
 *
 * Precedence: injected context (runner / ticket 09) wins; otherwise `--dir`
 * names the batch directory directly; otherwise `--name` resolves under
 * `<workRoot>/batches/<name>`. `--work-root` only affects the defaults.
 */
function resolveBatchContext(
  args: ParsedArgs,
  ports: Ports,
  deps: EvidenceCommandDeps,
): BatchResolution {
  const cwd = ports.env.cwd();
  const workRoot = resolveWorkRoot(cwd, args.workRoot);
  if (deps.batch !== undefined) {
    const name = parseBatchName(deps.batch.batchName);
    if (!name.ok) return { ok: false, error: name.error };
    return {
      ok: true,
      batch: {
        batchName: name.value,
        batchDir: resolveAgainst(cwd, deps.batch.batchDir),
        workRoot:
          deps.batch.workRoot === undefined ? workRoot : resolveAgainst(cwd, deps.batch.workRoot),
        meta: deps.batch.meta ?? {},
        summary: deps.batch.summary ?? {},
        ...(deps.batch.candidate === undefined ? {} : { candidate: deps.batch.candidate }),
        ...(deps.batch.extra === undefined ? {} : { extra: deps.batch.extra }),
      },
    };
  }
  if (args.dir !== undefined) {
    const batchDir = resolveAgainst(cwd, args.dir);
    const rawName = args.name ?? baseName(batchDir);
    const name = parseBatchName(rawName);
    if (!name.ok) {
      return {
        ok: false,
        error: failure(
          "invalid-input",
          `无法从 --dir 推导批次名：${rawName}`,
          "请显式传 --name <批次名>（字母/数字/._-，1-64 字符，且不能是 . 或 ..）",
        ),
      };
    }
    return {
      ok: true,
      batch: { batchName: name.value, batchDir, workRoot, meta: {}, summary: {} },
    };
  }
  if (args.name !== undefined) {
    const name = parseBatchName(args.name);
    if (!name.ok) return { ok: false, error: name.error };
    return {
      ok: true,
      batch: {
        batchName: name.value,
        batchDir: joinFsPath(workRoot, "batches", name.value),
        workRoot,
        meta: {},
        summary: {},
      },
    };
  }
  return {
    ok: false,
    error: failure(
      "prerequisite",
      "无法确定批次目录",
      "传 --dir <批次目录> 或 --name <批次名>；编程调用时由命令层注入 batch 上下文",
    ),
  };
}

/* ------------------------------------------------------------------- add */

type ParsedCheckSpec =
  | { readonly ok: true; readonly line: EvidenceCheckLine }
  | { readonly ok: false; readonly message: string };

/** `--check <id>=pass|fail`: one conclusion, from a check the caller actually ran. */
function parseCheckSpec(raw: string, recordedAt: string): ParsedCheckSpec {
  const equals = raw.indexOf("=");
  if (equals <= 0 || equals === raw.length - 1) {
    return { ok: false, message: `--check 需要 <检查项 id>=pass|fail，收到 "${raw}"` };
  }
  const id = raw.slice(0, equals);
  const verdict = raw.slice(equals + 1);
  if (verdict !== "pass" && verdict !== "fail") {
    return { ok: false, message: `--check 结论只能是 pass 或 fail，收到 "${verdict}"` };
  }
  const parsedId = parseCheckId(id);
  if (!parsedId.ok) {
    const hint = parsedId.error.hint === undefined ? "" : `（${parsedId.error.hint}）`;
    return { ok: false, message: `${parsedId.error.message}${hint}` };
  }
  return {
    ok: true,
    line: {
      name: parsedId.value,
      ok: verdict === "pass",
      detail: "recorded by dsh-verify evidence add",
      recordedAt,
    },
  };
}

/** First free `name`, `name-2`, ... under `files/`; never overwrites. */
async function allocateEvidenceName(
  fs: Ports["fs"],
  filesDir: string,
  requested: string,
  planned: Set<string>,
): Promise<string | null> {
  for (let ordinal = 1; ordinal <= MAX_EVIDENCE_ORDINAL; ordinal += 1) {
    const name = withOrdinal(requested, ordinal);
    if (planned.has(name)) continue;
    if (await fs.exists(joinFsPath(filesDir, name))) continue;
    planned.add(name);
    return name;
  }
  return null;
}

interface PreparedFile {
  readonly absolutePath: string;
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

async function runAdd(args: ParsedArgs, deps: EvidenceCommandDeps): Promise<number> {
  const { ports, io } = deps;
  const { fs, clock } = ports;
  if (args.files.length === 0 && args.checks.length === 0) {
    return reject(args, io, "add", "usage", "add 需要至少一个 --file 或 --check");
  }
  const resolution = resolveBatchContext(args, ports, deps);
  if (!resolution.ok) return failWith(args, deps, "add", resolution.error, "prerequisite");
  const batch = resolution.batch;
  const capturedAt = clock.iso();
  const checks: EvidenceCheckLine[] = [];
  for (const raw of args.checks) {
    const spec = parseCheckSpec(raw, capturedAt);
    if (!spec.ok) return reject(args, io, "add", "usage", spec.message);
    checks.push(spec.line);
  }

  // Read and hash every source before writing anything, so a bad --file path
  // fails the invocation without leaving half a payload behind.
  const cwd = ports.env.cwd();
  const evidenceRoot = joinFsPath(batch.batchDir, EVIDENCE_DIRNAME);
  const filesDir = joinFsPath(evidenceRoot, EVIDENCE_FILES_DIRNAME);
  const plannedNames = new Set<string>();
  const prepared: PreparedFile[] = [];
  for (const rawPath of args.files) {
    const absolutePath = resolveAgainst(cwd, rawPath);
    const stat = await fs.stat(absolutePath);
    if (!stat.ok) {
      return failWith(
        args,
        deps,
        "add",
        failure("not-found", `证据源文件不存在：${rawPath}`, "检查 --file 路径；证据采集不替调用方创建文件", {
          file: rawPath,
        }),
        "collect",
      );
    }
    if (stat.value.kind !== "file") {
      return failWith(
        args,
        deps,
        "add",
        failure("invalid-input", `证据源不是普通文件：${rawPath}`, "只接受普通文件；目录请先展开成文件列表", {
          file: rawPath,
        }),
        "collect",
      );
    }
    const hashed = await fs.hashFile(absolutePath);
    if (!hashed.ok) return failWith(args, deps, "add", hashed.error, "collect");
    const requestedName = sanitizeEvidenceFileName(baseName(absolutePath));
    const name = await allocateEvidenceName(fs, filesDir, requestedName, plannedNames);
    if (name === null) {
      return failWith(
        args,
        deps,
        "add",
        failure("conflict", `同名证据序号已用尽：${requestedName}`, "同一批次最多 999 个同名证据；请换一个文件名或开新批次"),
        "collect",
      );
    }
    prepared.push({ absolutePath, name, bytes: stat.value.size, sha256: hashed.value });
  }
  const items: EvidenceManifestItem[] = prepared.map((file) => ({
    kind: "file",
    path: asEvidencePath(evidenceFilesRelativePath(file.name)),
    bytes: file.bytes,
    sha256: file.sha256 as EvidenceManifestItem["sha256"],
    capturedAt,
  }));

  // Decide the merged manifest before copying: a candidate conflict must be a
  // failed invocation, not a set of copied files the manifest does not describe.
  const existing = await loadEvidenceManifest(fs, evidenceRoot);
  if (!existing.ok) return failWith(args, deps, "add", existing.error, "manifest");
  const input: BuildEvidenceManifestInput = {
    generatedAt: capturedAt,
    batch: { name: batch.batchName, dir: batch.batchDir, root: batch.workRoot },
    meta: batch.meta,
    summary: batch.summary,
    checks,
    items,
    ...(batch.candidate === undefined ? {} : { candidate: batch.candidate }),
    ...(batch.extra === undefined ? {} : { extra: batch.extra }),
  };
  let merged: EvidenceManifest;
  if (existing.value === null) {
    merged = buildEvidenceManifest(input);
  } else {
    const mergeResult = mergeEvidenceManifest(existing.value.manifest, input);
    if (!mergeResult.ok) return failWith(args, deps, "add", mergeResult.error, "manifest");
    merged = mergeResult.value;
  }


  if (args.dryRun) {
    const manifestPath =
      existing.value === null ? joinFsPath(evidenceRoot, EVIDENCE_MANIFEST_FILENAME) : existing.value.manifestPath;
    const plan = {
      batch: { name: batch.batchName, dir: batch.batchDir, root: batch.workRoot },
      evidenceRoot,
      filesDir,
      files: prepared.map((file) => ({
        source: file.absolutePath,
        name: file.name,
        target: joinFsPath(filesDir, file.name),
        bytes: file.bytes,
        sha256: file.sha256,
      })),
      fileCount: prepared.length,
      items,
      checks,
      manifest: {
        path: manifestPath,
        replacing: existing.value !== null,
        itemCount: merged.items.length,
      },
    };
    if (args.json) {
      io.stdout(
        `${JSON.stringify({
          schemaVersion: 1,
          command: "evidence",
          subcommand: "add",
          ok: true,
          dryRun: true,
          plan,
        })}\n`,
      );
    } else {
      io.stdout(`batch ${batch.batchName} (${batch.batchDir})\n`);
      io.stdout(`would copy ${prepared.length} file(s):\n`);
      for (const file of plan.files) {
        io.stdout(`  ${file.source} -> ${file.target} (${file.bytes} bytes, sha256 ${file.sha256})\n`);
      }
      for (const check of checks) {
        io.stdout(`check ${check.name} ${check.ok ? "pass" : "fail"}\n`);
      }
      io.stdout(
        `manifest ${manifestPath} (${existing.value === null ? "new" : "replace"}, ${merged.items.length} item(s))\n`,
      );
      io.stdout("dry run: nothing was written\n");
    }
    return EXIT_CODES.ok;
  }

  // Copy payload, then verify the copies, then publish the manifest.
  const copiedPaths: string[] = [];
  const rollbackCopies = async (): Promise<void> => {
    for (const path of copiedPaths) await fs.remove(path, { recursive: false });
  };
  for (const file of prepared) {
    const targetPath = joinFsPath(filesDir, file.name);
    const made = await fs.makeDir(filesDir);
    if (!made.ok) {
      await rollbackCopies();
      return failWith(args, deps, "add", made.error, "copy");
    }
    const copied = await fs.copy(file.absolutePath, targetPath, { recursive: false });
    if (!copied.ok) {
      await rollbackCopies();
      return failWith(args, deps, "add", copied.error, "copy");
    }
    copiedPaths.push(targetPath);
    const copiedHash = await fs.hashFile(targetPath);
    if (!copiedHash.ok) {
      await rollbackCopies();
      return failWith(args, deps, "add", copiedHash.error, "copy");
    }
    if (copiedHash.value !== file.sha256) {
      await rollbackCopies();
      return failWith(
        args,
        deps,
        "add",
        failure(
          "io",
          `证据文件复制后哈希不一致：${file.absolutePath}`,
          "源文件在复制过程中被改动，或文件系统不可靠；请重试",
          { path: file.absolutePath, expected: file.sha256, actual: copiedHash.value },
        ),
        "copy",
      );
    }
  }
  const written = await writeEvidenceManifest({
    fs,
    evidenceRoot,
    manifest: merged,
    replace: existing.value !== null,
  });
  if (!written.ok) {
    await rollbackCopies();
    return failWith(args, deps, "add", written.error, "manifest");
  }

  if (args.json) {
    io.stdout(
      `${JSON.stringify({
        schemaVersion: 1,
        command: "evidence",
        subcommand: "add",
        ok: true,
        batch: { name: batch.batchName, dir: batch.batchDir, root: batch.workRoot },
        evidence: {
          root: evidenceRoot,
          manifest: written.value.manifestPath,
          manifestSha256: written.value.manifestSha256,
        },
        items,
        checks,
      })}\n`,
    );
  } else {
    io.stdout(`batch ${batch.batchName} (${batch.batchDir})\n`);
    for (const item of items) {
      io.stdout(`added ${item.path} (${item.bytes} bytes, sha256 ${item.sha256})\n`);
    }
    for (const check of checks) {
      io.stdout(`check ${check.name} ${check.ok ? "pass" : "fail"}\n`);
    }
    io.stdout(`evidence ${evidenceRoot}\n`);
    io.stdout(`manifest ${written.value.manifestPath} (sha256 ${written.value.manifestSha256})\n`);
  }
  return EXIT_CODES.ok;
}

/* ---------------------------------------------------------------- archive */

async function runArchive(args: ParsedArgs, deps: EvidenceCommandDeps): Promise<number> {
  const { ports, io } = deps;
  const resolution = resolveBatchContext(args, ports, deps);
  if (!resolution.ok) return failWith(args, deps, "archive", resolution.error, "prerequisite");
  const batch = resolution.batch;
  const archiveRoot =
    args.archiveRoot === undefined
      ? joinFsPath(batch.workRoot, DEFAULT_ARCHIVE_ROOT_DIRNAME)
      : resolveAgainst(ports.env.cwd(), args.archiveRoot);

  if (args.dryRun) {
    const planned = await planEvidenceArchive({
      fs: ports.fs,
      clock: ports.clock,
      batchDir: batch.batchDir,
      batchName: batch.batchName,
      archiveRoot,
    });
    if (!planned.ok) return failWith(args, deps, "archive", planned.error, "archive");
    const plan = planned.value;
    if (args.json) {
      io.stdout(
        `${JSON.stringify({
          schemaVersion: 1,
          command: "evidence",
          subcommand: "archive",
          ok: true,
          dryRun: true,
          plan: {
            batch: { name: batch.batchName, dir: batch.batchDir },
            archiveRoot,
            directory: plan.directory,
            createdAt: plan.createdAt,
            files: plan.files,
            fileCount: plan.files.length,
            copied: plan.copied,
            fileDigest: plan.fileDigest,
            sumsPath: joinFsPath(plan.directory, "SHA256SUMS.txt"),
          },
        })}\n`,
      );
    } else {
      io.stdout(`archive ${plan.directory} (dry run)\n`);
      io.stdout(`batch ${batch.batchName} (${batch.batchDir})\n`);
      io.stdout(`would copy ${plan.copied.files} file(s), ${plan.copied.bytes} byte(s)\n`);
      for (const file of plan.files) io.stdout(`  ${file.path} (${file.bytes} bytes, sha256 ${file.sha256})\n`);
      io.stdout(`SHA256SUMS.txt ${joinFsPath(plan.directory, "SHA256SUMS.txt")}\n`);
      io.stdout(`digest ${plan.fileDigest}\n`);
      io.stdout("dry run: nothing was written\n");
    }
    return EXIT_CODES.ok;
  }

  const archived = await archiveEvidence({
    fs: ports.fs,
    clock: ports.clock,
    batchDir: batch.batchDir,
    batchName: batch.batchName,
    archiveRoot,
  });
  if (!archived.ok) return failWith(args, deps, "archive", archived.error, "archive");
  const result = archived.value;
  if (args.json) {
    io.stdout(
      `${JSON.stringify({
        schemaVersion: 1,
        command: "evidence",
        subcommand: "archive",
        ok: true,
        batch: { name: batch.batchName, dir: batch.batchDir },
        archive: {
          directory: result.directory,
          batchName: result.batchName,
          createdAt: result.createdAt,
          files: result.files,
          sumsPath: result.sumsPath,
          sumsSha256: result.sumsSha256,
          fileDigest: result.fileDigest,
          copied: result.copied,
        },
      })}\n`,
    );
  } else {
    io.stdout(`archive ${result.directory}\n`);
    io.stdout(`batch ${batch.batchName} (${batch.batchDir})\n`);
    io.stdout(`copied ${result.copied.files} file(s), ${result.copied.bytes} byte(s)\n`);
    io.stdout(`SHA256SUMS.txt ${result.sumsPath} (sha256 ${result.sumsSha256})\n`);
    io.stdout(`digest ${result.fileDigest}\n`);
  }
  return EXIT_CODES.ok;
}

/* ----------------------------------------------------------------- verify */

async function runVerify(args: ParsedArgs, deps: EvidenceCommandDeps): Promise<number> {
  const { ports, io } = deps;
  if (args.dir === undefined) {
    return reject(args, io, "verify", "usage", `verify 需要 --dir <归档目录>\n${EVIDENCE_USAGE}`);
  }
  const directory = resolveAgainst(ports.env.cwd(), args.dir);
  const verified = await verifyEvidenceArchive({ fs: ports.fs, directory });
  if (!verified.ok) return failWith(args, deps, "verify", verified.error, "verify");
  const result = verified.value;
  if (args.json) {
    io.stdout(
      `${JSON.stringify({
        schemaVersion: 1,
        command: "evidence",
        subcommand: "verify",
        ok: result.ok,
        directory: result.directory,
        sumsPath: result.sumsPath,
        checked: result.checked,
        counts: result.counts,
        issues: result.issues,
        annotations: result.annotations,
      })}\n`,
    );
  } else {
    for (const issue of result.issues) {
      if (issue.kind === "malformed") {
        io.stdout("malformed line " + (issue.line ?? "?") + " " + issue.message + "\n");
      } else {
        io.stdout(`${issue.kind} ${issue.path ?? "?"} ${issue.message}\n`);
      }
      if (issue.expected !== undefined) io.stdout(`  expected: ${issue.expected}\n`);
      if (issue.actual !== undefined) io.stdout(`  actual:   ${issue.actual}\n`);
      if (issue.hint !== undefined) io.stdout(`  hint:     ${issue.hint}\n`);
    }
    for (const annotation of result.annotations) io.stdout(`note ${annotation}\n`);
    io.stdout(
      `${result.ok ? "ok" : "fail"} archive ${result.directory} (${result.checked} file(s) verified, ${result.issues.length} issue(s))\n`,
    );
  }
  return result.ok ? EXIT_CODES.ok : EXIT_CODES.hardFailure;
}

/** Run one `evidence` invocation and return its exit code. */
export async function runEvidenceCommand(args: ParsedArgs, deps: EvidenceCommandDeps): Promise<number> {
  const validation = validateInvocation(args);
  if (!validation.ok) {
    return reject(args, deps.io, args.positional[1] ?? null, "usage", validation.message);
  }
  const subcommand = validation.subcommand;
  let resolved = deps;
  if (deps.batch === undefined && deps.loadBatch !== undefined) {
    const loaded = await deps.loadBatch(args);
    if (!loaded.ok) return failWith(args, deps, subcommand, loaded.error, "batch");
    if (loaded.value !== null) resolved = { ...deps, batch: loaded.value };
  }
  if (subcommand === "add") return runAdd(args, resolved);
  if (subcommand === "archive") return runArchive(args, resolved);
  return runVerify(args, resolved);
}