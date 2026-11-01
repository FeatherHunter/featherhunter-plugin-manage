/**
 * The source state a candidate claims to come from.
 *
 * Freeze reads this twice: before the build and after packing. Equality of the
 * two snapshots is the evidence behind `sourceStable`; a commit that moved in
 * between makes the candidate unanswerable, not merely dirty.
 */
import type { CommitSha } from "../../contracts/branding";
import { parseCommitSha } from "../../contracts/branding";
import type { Ports } from "../../contracts/ports";
import { err, ok, type Result } from "../../contracts/result";

export interface GitState {
  readonly commit: CommitSha;
  /** `HEAD` when detached; git's own name for the branch otherwise. */
  readonly branch: string;
  readonly dirty: boolean;
  /** Porcelain paths, sorted, with rename/copy sources collapsed to the new path. */
  readonly dirtyFiles: readonly string[];
}

export interface GitStateOptions {
  readonly ports: Pick<Ports, "command">;
  readonly cwd: string;
  readonly timeoutMs?: number;
}

const GIT_TIMEOUT_MS = 60_000;

interface RunText {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runGit(options: GitStateOptions, argv: readonly string[]): Promise<Result<RunText>> {
  const outcome = await options.ports.command.run({
    argv,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? GIT_TIMEOUT_MS,
  });
  if (!outcome.ok) return outcome;
  if (outcome.value.timedOut) {
    return err({ code: "timeout", message: `${argv.join(" ")} timed out after ${outcome.value.durationMs}ms` });
  }
  return ok({ exitCode: outcome.value.exitCode ?? -1, stdout: outcome.value.stdout, stderr: outcome.value.stderr });
}

function commandFailure(argv: readonly string[], run: RunText): Result<never> {
  const detail = (run.stderr.trim() || run.stdout.trim()).split(/\r?\n/).slice(0, 4).join("\n");
  return err({
    code: "prerequisite",
    message: `${argv.join(" ")} failed with exit code ${run.exitCode}${detail.length === 0 ? "" : `: ${detail}`}`,
    hint: "freeze must run inside a git work tree with git on PATH",
  });
}

/**
 * Parse `git status --porcelain -z --untracked-files=all`. With `-z` paths are
 * raw (no quoting), and a rename or copy entry is followed by its source path
 * as a separate NUL-terminated token.
 */
export function parsePorcelainZ(stdout: string): Result<readonly string[]> {
  const tokens = stdout.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length === 0) continue;
    if (token.length < 4 || token[2] !== " ") {
      return err({ code: "invalid-input", message: `unexpected git status --porcelain entry: ${JSON.stringify(token)}` });
    }
    const status = token.slice(0, 2);
    const path = token.slice(3);
    if (status.includes("R") || status.includes("C")) {
      if (index + 1 >= tokens.length || tokens[index + 1].length === 0) {
        return err({ code: "invalid-input", message: `git status rename entry has no source path: ${JSON.stringify(token)}` });
      }
      index += 1;
    }
    paths.push(path);
  }
  return ok(paths.sort());
}

export async function readGitState(options: GitStateOptions): Promise<Result<GitState>> {
  const headArgv = ["git", "rev-parse", "HEAD"] as const;
  const headRun = await runGit(options, headArgv);
  if (!headRun.ok) return headRun;
  if (headRun.value.exitCode !== 0) return commandFailure(headArgv, headRun.value);
  const commit = parseCommitSha(headRun.value.stdout.trim());
  if (!commit.ok) {
    return err({
      code: "prerequisite",
      message: `git rev-parse HEAD printed ${JSON.stringify(headRun.value.stdout.trim())}, not a commit`,
    });
  }

  const branchArgv = ["git", "rev-parse", "--abbrev-ref", "HEAD"] as const;
  const branchRun = await runGit(options, branchArgv);
  if (!branchRun.ok) return branchRun;
  if (branchRun.value.exitCode !== 0) return commandFailure(branchArgv, branchRun.value);
  const branch = branchRun.value.stdout.trim();
  if (branch.length === 0) return err({ code: "prerequisite", message: "git rev-parse --abbrev-ref HEAD printed nothing" });

  const statusArgv = ["git", "status", "--porcelain", "-z", "--untracked-files=all"] as const;
  const statusRun = await runGit(options, statusArgv);
  if (!statusRun.ok) return statusRun;
  if (statusRun.value.exitCode !== 0) return commandFailure(statusArgv, statusRun.value);
  const dirtyFiles = parsePorcelainZ(statusRun.value.stdout);
  if (!dirtyFiles.ok) return dirtyFiles;

  return ok({
    commit: commit.value,
    branch,
    dirty: dirtyFiles.value.length > 0,
    dirtyFiles: dirtyFiles.value,
  });
}

/** True when two snapshots describe exactly the same source. */
export function sameGitState(left: GitState, right: GitState): boolean {
  if (left.commit !== right.commit) return false;
  if (left.dirtyFiles.length !== right.dirtyFiles.length) return false;
  return left.dirtyFiles.every((path, index) => path === right.dirtyFiles[index]);
}
