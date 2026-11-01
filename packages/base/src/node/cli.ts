import { existsSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDoctorReport, runDoctor } from "./doctor";
import { updateReadmeTargets, updateReadmes, type ReadmeBatchResult } from "./readme-sync";
import {
  expandReadmeTargets,
  readPackagedManifest,
  readPackageVersion,
  readmeTargetRepos,
  resolveRepoReadmeTargets,
} from "./targets";

const HELP = `dsh-base — FeatherHunter base package CLI

Usage:
  dsh-base readme:init [--check] [--root <dir>]... [--readme <path>] [--self <id>]
                                  Insert the managed blocks (contact first) into a README
  dsh-base readme:sync [--check] [--root <dir>]...
                                  Refresh the text between the managed markers
  dsh-base readme:init|readme:sync --all --repos <dir>...
                                  Process the eleven managed READMEs of the five repositories
  dsh-base readme:init|readme:sync --repo <dir>...
                                  Process every managed README of one managed repository (CI)
  dsh-base contact:update          Source-repo only: refresh contact/ from a QR screenshot
                                  (run "npm run contact:update -- <image>" in the checkout)
  dsh-base doctor [<repo-dir>]... [--repos <dir>]... [--offline] [--json]
                                  Diagnose data, CDN and README state
  dsh-base --version              Print the package version
  dsh-base --help                 Print this help

Options:
  --root <dir>     Repository root to update; repeatable (default: current directory)
  --readme <path>  README path relative to each root (default: README.md)
  --self <id>      Plugin id of the repository; the MORE block excludes it
  --repos <dir>    Parent directory that contains the five plugin repositories; repeatable.
                   readme:init/sync: process the built-in table of eleven managed READMEs.
                   doctor: check every managed repository under that directory.
  --repo <dir>     One managed repository root; repeatable. Processes all of its READMEs
                   (README.md and docs/README.en.md); useful as a per-repository CI gate.
  --all            Process every target and keep going after per-file errors
  --check          Report drift without writing; nonzero exit when a README is out of date
  --offline        doctor: skip the remote manifest probe
  --json           doctor: print a machine-readable JSON report

Commands that change files only rewrite the text between their managed markers and
refuse to touch a README with unpaired markers or merge-conflict residue.

Exit codes: 0 success / no drift, 1 drift or error, 2 usage error.
`;

type ReadmeCommand = "init" | "sync";

interface ReadmeCliOptions {
  command: ReadmeCommand;
  roots: string[];
  repos: string[];
  repoRoots: string[];
  check: boolean;
  all: boolean;
  readme?: string;
  selfId?: string;
}

/** Read a flag value in either `--flag value` or `--flag=value` form. */
function takeFlagValue(
  args: string[],
  prefix: string,
  name: string,
  argument: string,
  position: number,
): { value: string } | { error: string } {
  if (argument.startsWith(name + "=")) {
    const value = argument.slice(name.length + 1);
    if (value.length === 0) return { error: prefix + ': "' + name + '" needs a value' };
    return { value };
  }
  const value = args[position + 1];
  if (value === undefined || value.startsWith("-")) {
    return { error: prefix + ': "' + name + '" needs a value' };
  }
  return { value };
}

/** Parse the arguments of readme:init / readme:sync. */
function parseReadmeArgs(
  command: ReadmeCommand,
  args: string[],
): { options: ReadmeCliOptions } | { error: string } {
  const roots: string[] = [];
  const repos: string[] = [];
  const repoRoots: string[] = [];
  let check = false;
  let all = false;
  let readme: string | undefined;
  let selfId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--check") {
      check = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--root" || arg.startsWith("--root=")) {
      const parsed = takeFlagValue(args, "readme:" + command, "--root", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      roots.push(parsed.value);
      if (arg === "--root") index += 1;
    } else if (arg === "--repos" || arg.startsWith("--repos=")) {
      const parsed = takeFlagValue(args, "readme:" + command, "--repos", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      repos.push(parsed.value);
      if (arg === "--repos") index += 1;
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      const parsed = takeFlagValue(args, "readme:" + command, "--repo", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      repoRoots.push(parsed.value);
      if (arg === "--repo") index += 1;
    } else if (arg === "--readme" || arg.startsWith("--readme=")) {
      const parsed = takeFlagValue(args, "readme:" + command, "--readme", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      readme = parsed.value;
      if (arg === "--readme") index += 1;
    } else if (arg === "--self" || arg.startsWith("--self=")) {
      const parsed = takeFlagValue(args, "readme:" + command, "--self", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      selfId = parsed.value;
      if (arg === "--self") index += 1;
    } else {
      return { error: 'readme:' + command + ': unknown option "' + arg + '"' };
    }
  }

  if (repos.length > 0) {
    if (roots.length > 0) {
      return { error: 'readme:' + command + ': "--repos" cannot be combined with "--root"' };
    }
    if (repoRoots.length > 0) {
      return { error: 'readme:' + command + ': "--repos" cannot be combined with "--repo"' };
    }
    if (readme !== undefined || selfId !== undefined) {
      return {
        error: 'readme:' + command + ': "--repos" uses the built-in per-repository paths; do not pass --readme/--self',
      };
    }
  } else if (repoRoots.length > 0) {
    if (roots.length > 0) {
      return { error: 'readme:' + command + ': "--repo" cannot be combined with "--root"' };
    }
    if (readme !== undefined || selfId !== undefined) {
      return {
        error: 'readme:' + command + ': "--repo" uses the built-in per-repository paths; do not pass --readme/--self',
      };
    }
  } else if (roots.length === 0) {
    roots.push(process.cwd());
  }

  return {
    options: {
      command,
      roots: roots.map((root) => resolve(root)),
      repos: repos.map((reposDir) => resolve(reposDir)),
      repoRoots: repoRoots.map((repoRoot) => resolve(repoRoot)),
      check,
      all,
      readme,
      selfId,
    },
  };
}

/** Print per-file outcomes; errors go to stderr so scripts can watch stdout. */
function reportReadmeBatch(result: ReadmeBatchResult): number {
  for (const file of result.files) {
    if (file.ok && file.changed && file.blocks.length > 0) {
      const changed = file.blocks
        .filter((block) => block.status === "inserted" || block.status === "updated")
        .map((block) => block.name + " " + block.status);
      process.stdout.write(file.readmePath + ": " + changed.join(", ") + "\n");
    } else if (file.ok) {
      process.stdout.write(file.readmePath + ": up to date\n");
    }
    for (const error of file.errors) {
      process.stderr.write("dsh-base: " + error + "\n");
    }
  }
  return result.ok ? 0 : 1;
}

interface DoctorCliOptions {
  repoRoots: string[];
  reposDirs: string[];
  offline: boolean;
  json: boolean;
}

/** Parse the arguments of the doctor command. */
function parseDoctorArgs(args: string[]): { options: DoctorCliOptions } | { error: string } {
  const repoRoots: string[] = [];
  const reposDirs: string[] = [];
  let offline = false;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--offline") {
      offline = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--repos" || arg.startsWith("--repos=")) {
      const parsed = takeFlagValue(args, "doctor", "--repos", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      reposDirs.push(resolve(parsed.value));
      if (arg === "--repos") index += 1;
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      const parsed = takeFlagValue(args, "doctor", "--repo", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      repoRoots.push(resolve(parsed.value));
      if (arg === "--repo") index += 1;
    } else if (!arg.startsWith("-")) {
      repoRoots.push(resolve(arg));
    } else {
      return { error: 'doctor: unknown option "' + arg + '"' };
    }
  }

  if (repoRoots.length === 0 && reposDirs.length === 0) {
    const cwd = process.cwd();
    const repos = readmeTargetRepos();
    if (repos.includes(basename(cwd))) {
      repoRoots.push(cwd);
    } else if (repos.some((repo) => existsSync(join(cwd, repo)))) {
      reposDirs.push(cwd);
    } else {
      return {
        error: "doctor: no managed repository found here; pass a repository directory or --repos <parent-dir>",
      };
    }
  }

  return { options: { repoRoots, reposDirs, offline, json } };
}

/** Run one CLI invocation and return its exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${readPackageVersion()}\n`);
    return 0;
  }
  switch (command) {
    case "readme:init":
    case "readme:sync": {
      const readmeCommand: ReadmeCommand = command === "readme:init" ? "init" : "sync";
      const parsed = parseReadmeArgs(readmeCommand, argv.slice(1));
      if ("error" in parsed) {
        process.stderr.write("dsh-base: " + parsed.error + "\n\n");
        process.stderr.write(HELP);
        return 2;
      }
      const { roots, repos, repoRoots, check, all, readme, selfId } = parsed.options;
      if (repos.length > 0) {
        const manifest = readPackagedManifest();
        const targets = expandReadmeTargets(repos, { manifest });
        return reportReadmeBatch(updateReadmeTargets(targets, { command: readmeCommand, check }));
      }
      if (repoRoots.length > 0) {
        const manifest = readPackagedManifest();
        let targets;
        try {
          targets = repoRoots.flatMap((repoRoot) =>
            resolveRepoReadmeTargets(repoRoot, { manifest }),
          );
        } catch (error) {
          process.stderr.write(
            "dsh-base: " + (error instanceof Error ? error.message : String(error)) + "\n",
          );
          return 1;
        }
        return reportReadmeBatch(updateReadmeTargets(targets, { command: readmeCommand, check }));
      }
      return reportReadmeBatch(
        updateReadmes({ roots, command: readmeCommand, check, all, readme, selfId }),
      );
    }
    case "doctor": {
      const parsed = parseDoctorArgs(argv.slice(1));
      if ("error" in parsed) {
        process.stderr.write("dsh-base: " + parsed.error + "\n\n");
        process.stderr.write(HELP);
        return 2;
      }
      const { repoRoots, reposDirs, offline, json } = parsed.options;
      let result;
      try {
        result = await runDoctor({ repoRoots, reposDirs, offline });
      } catch (error) {
        process.stderr.write("dsh-base: " + (error as Error).message + "\n");
        return 2;
      }
      if (json) {
        process.stdout.write(JSON.stringify({ ok: result.ok, checks: result.checks }, null, 2) + "\n");
      } else {
        process.stdout.write(formatDoctorReport(result) + "\n");
      }
      if (!result.ok) {
        const failed = result.checks.filter((check) => !check.ok).length;
        process.stderr.write("dsh-base: doctor found " + failed + " failing check(s)\n");
        return 1;
      }
      return 0;
    }
    case "contact:update":
      process.stderr.write(
        "dsh-base: contact:update refreshes contact/ from QR screenshots inside the package source repository;\n" +
          "it needs the image tooling (pngjs/jpeg-js) that only the maintainer checkout has.\n" +
          "Run it there instead: npm run contact:update -- <image> [--group <id>] [--confirmed]\n",
      );
      return 2;
    default:
      process.stderr.write(`dsh-base: unknown command "${command}"\n\n`);
      process.stderr.write(HELP);
      return 2;
  }
}

// A `file:`/`link:` install reaches this file through a junction or symlink;
// Node reports import.meta.url as the real path while argv[1] keeps the link.
// Accept either spelling, otherwise a linked install silently runs nothing.
const entryUrls = new Set<string>();
if (process.argv[1]) {
  entryUrls.add(pathToFileURL(process.argv[1]).href);
  try {
    entryUrls.add(pathToFileURL(realpathSync(process.argv[1])).href);
  } catch {
    // The argv path may not exist (deleted while running); the literal URL stands.
  }
}
if (entryUrls.has(import.meta.url)) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
