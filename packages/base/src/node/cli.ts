import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HELP = `dsh-base — FeatherHunter base package CLI

Usage:
  dsh-base readme:init            Insert the four managed blocks into a README
  dsh-base readme:sync [--check]  Refresh managed blocks in every repo
  dsh-base readme:sync --all      Refresh every managed block, even unchanged ones
  dsh-base contact:update [--check]
                                  Refresh contact/ data from the QR source images
  dsh-base doctor                 Diagnose data, CDN and README state
  dsh-base --version              Print the package version
  dsh-base --help                 Print this help

Commands that change files only rewrite the text between their managed markers.
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
    case "readme:sync":
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
