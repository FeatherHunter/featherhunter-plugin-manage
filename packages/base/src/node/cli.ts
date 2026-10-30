import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { updateReadmes, type ReadmeBatchResult } from "./readme-sync";

const HELP = `dsh-base — FeatherHunter base package CLI

Usage:
  dsh-base readme:init [--check] [--root <dir>]...
                                  Insert the managed blocks (contact first) into a README
  dsh-base readme:sync [--check] [--root <dir>]...
                                  Refresh the text between the managed markers
  dsh-base readme:init|readme:sync --all [--root <dir>]...
                                  Process every target directory and keep going after errors
  dsh-base contact:update [--check]
                                  Refresh contact/ data from the QR source images
  dsh-base doctor                 Diagnose data, CDN and README state
  dsh-base --version              Print the package version
  dsh-base --help                 Print this help

Options:
  --root <dir>     Repository root to update; repeatable (default: current directory)
  --readme <path>  README path relative to each root (default: README.md)
  --self <id>      Plugin id of the repository; the MORE block excludes it
  --check          Report drift without writing; nonzero exit when a README is out of date
  --all            Process every --root and continue after per-file errors

Commands that change files only rewrite the text between their managed markers and
refuse to touch a README with unpaired markers or merge-conflict residue.

Exit codes: 0 success / no drift, 1 drift or error, 2 usage error.
`;

function readVersion(): string {
  try {
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const parsed = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function notImplemented(command: string): number {
  process.stderr.write(`dsh-base: "${command}" is not implemented yet`);
  process.stderr.write("\n");
  return 1;
}

type ReadmeCommand = "init" | "sync";

interface ReadmeCliOptions {
  command: ReadmeCommand;
  roots: string[];
  check: boolean;
  all: boolean;
  readme?: string;
  selfId?: string;
}

/** Parse the arguments of readme:init / readme:sync. */
function parseReadmeArgs(
  command: ReadmeCommand,
  args: string[],
): { options: ReadmeCliOptions } | { error: string } {
  const roots: string[] = [];
  let check = false;
  let all = false;
  let readme: string | undefined;
  let selfId: string | undefined;

  /** Read the value of a flag in either `--flag value` or `--flag=value` form. */
  const takeValue = (name: string, argument: string, position: number): { value: string } | { error: string } => {
    if (argument.startsWith(name + "=")) {
      const value = argument.slice(name.length + 1);
      if (value.length === 0) return { error: 'readme:' + command + ': "' + name + '" needs a value' };
      return { value };
    }
    const value = args[position + 1];
    if (value === undefined || value.startsWith("-")) {
      return { error: 'readme:' + command + ': "' + name + '" needs a value' };
    }
    return { value };
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--check") {
      check = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--root") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { error: 'readme:' + command + ': "--root" needs a directory value' };
      }
      roots.push(value);
      index += 1;
    } else if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length);
      if (value.length === 0) {
        return { error: 'readme:' + command + ': "--root" needs a directory value' };
      }
      roots.push(value);
    } else if (arg === "--readme" || arg.startsWith("--readme=")) {
      const parsed = takeValue("--readme", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      readme = parsed.value;
      if (arg === "--readme") index += 1;
    } else if (arg === "--self" || arg.startsWith("--self=")) {
      const parsed = takeValue("--self", arg, index);
      if ("error" in parsed) return { error: parsed.error };
      selfId = parsed.value;
      if (arg === "--self") index += 1;
    } else {
      return { error: 'readme:' + command + ': unknown option "' + arg + '"' };
    }
  }

  if (roots.length === 0) roots.push(process.cwd());
  return {
    options: {
      command,
      roots: roots.map((root) => resolve(root)),
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

/** Run one CLI invocation and return its exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${readVersion()}\n`);
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
      const { roots, check, all, readme, selfId } = parsed.options;
      return reportReadmeBatch(
        updateReadmes({ roots, command: readmeCommand, check, all, readme, selfId }),
      );
    }
    case "contact:update":
    case "doctor":
      return notImplemented(command);
    default:
      process.stderr.write(`dsh-base: unknown command "${command}"\n\n`);
      process.stderr.write(HELP);
      return 2;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryUrl) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
