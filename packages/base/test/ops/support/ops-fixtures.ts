/**
 * Shared fixtures for the ops test domain (packages/base/test/ops).
 *
 * FROZEN BY TICKET 01 — do not modify this file in later tickets.
 * 本文件由票 01 冻结，后续票不得修改（需要新辅助时各自新建文件）。
 *
 * Every helper here drives the ops toolkit across its process boundary:
 * scripts are spawned without a shell, script internals are never imported,
 * and every temporary artifact lives under os.tmpdir().
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface OpsRunResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface OpsRunOptions {
  /** Working directory for the child process (default: REPO_ROOT). */
  cwd?: string;
  /** Extra environment entries merged over process.env. */
  env?: NodeJS.ProcessEnv;
  /** Hard limit before the child is killed and the call rejects (default: 120s). */
  timeoutMs?: number;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Repository root: the nearest ancestor of this file that holds both
 * scripts/ops/base-verify.mjs and packages/base/package.json.
 * Derived from the file location, never hardcoded.
 */
export const REPO_ROOT: string = findRepoRoot();

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "scripts", "ops", "base-verify.mjs")) && existsSync(join(dir, "packages", "base", "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("cannot locate the repository root from " + import.meta.url);
    dir = parent;
  }
}

/**
 * Run an ops script with the current Node binary, never through a shell.
 * Accepts a repo-relative path or an absolute path (e.g. a copied toolkit).
 * Non-zero exits are results, not errors; spawn failures reject.
 */
export async function runOps(
  scriptRelPath: string,
  args: readonly string[] = [],
  opts: OpsRunOptions = {},
): Promise<OpsRunResult> {
  const script = isAbsolute(scriptRelPath) ? scriptRelPath : resolve(REPO_ROOT, scriptRelPath);
  if (!existsSync(script)) throw new Error("ops script not found: " + script);
  return await runNode([script, ...args], opts);
}

function runNode(argv: readonly string[], opts: OpsRunOptions): Promise<OpsRunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(process.execPath, [...argv], {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeoutMs ?? 120_000,
    });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    child.on("error", (error) => {
      settle(() => rejectPromise(new Error("failed to run " + argv[0] + ": " + error.message)));
    });
    child.on("close", (code, signal) => {
      settle(() => resolvePromise({ code: code === null ? 1 : code, signal: signal ?? null, stdout, stderr }));
    });
  });
}

/** Create a unique directory under os.tmpdir(). Caller owns cleanup via removeTempDir. */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Best-effort recursive removal of a temp dir (Windows keeps handles briefly). */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Teardown must not fail the suite; leftovers stay under os.tmpdir().
  }
}

/** Copy the whole repo ops toolkit to <destRoot>/scripts/ops and return that path. */
export function copyOpsToolkit(destRoot: string): string {
  const target = join(destRoot, "scripts", "ops");
  cpSync(join(REPO_ROOT, "scripts", "ops"), target, { recursive: true, force: true });
  return target;
}

/** Write a relative-path -> content map under dir, creating parent directories. */
export function writeFiles(dir: string, files: Record<string, string | Buffer>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(dir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** Read and parse a JSON file. */
export function readJsonFile(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf8"));
}

/**
 * Initialise a git repository at dir and return a git(args) helper bound to it.
 * The helper does not throw: inspect code/stdout/stderr. Git's own defaults for
 * signing and hooks are neutralised so fixtures behave on any machine.
 */
export function initGitRepo(dir: string): (args: readonly string[]) => GitResult {
  mkdirSync(dir, { recursive: true });
  const git = (args: readonly string[]): GitResult => {
    const result = spawnSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return {
      code: result.status === null ? 1 : result.status,
      stdout: (result.stdout ?? "").replace(/\s+$/, ""),
      stderr: (result.stderr ?? "").replace(/\s+$/, ""),
    };
  };
  const must = (result: GitResult, what: string): void => {
    if (result.code !== 0) throw new Error("git " + what + " failed (" + result.code + "): " + result.stderr);
  };
  must(git(["init"]), "init");
  must(git(["config", "user.name", "ops fixtures"]), "config user.name");
  must(git(["config", "user.email", "ops-fixtures@example.invalid"]), "config user.email");
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "core.autocrlf", "false"]);
  return git;
}

/**
 * Stable sha256 over a directory tree: sorted relative paths (forward slashes)
 * plus file bytes. Used for "nothing changed" read-only assertions.
 */
export function hashDirectory(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const rel = relative(dir, abs).split(sep).join("/");
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) {
        hash.update("other\0" + rel + "\0");
        continue;
      }
      hash.update("file\0" + rel + "\0");
      hash.update(readFileSync(abs));
      hash.update("\0");
    }
  };
  walk(dir);
  return hash.digest("hex");
}
