/**
 * `dsh-verify` — the thin command shell over the verification capability.
 *
 * The CLI owns three things and nothing else: argument dispatch, the stdout
 * contract (one JSON document when `--json` is given, human text otherwise) and
 * the exit-code mapping. Every behaviour it exposes is reachable from the library,
 * which is what lets an agent write a scenario nobody pre-built.
 *
 * Exit codes are part of the contract: `0` all checks passed, `1` a hard check
 * failed, `2` blocked — a prerequisite or adapter is missing, so the run proved
 * nothing about the product.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  describeCapability,
  EXIT_CODE_SUMMARIES,
  EXIT_CODES,
  type CapabilityDescription,
} from "../capability-description";

const CLI_NAME = "dsh-verify";

/**
 * Commands that already have an implementation. A command listed in the
 * capability description but missing here exits `2` with a sentence instead of
 * pretending to succeed — the description is the contract, this set is the truth.
 */
export const IMPLEMENTED: ReadonlySet<string> = new Set<string>(["describe"]);

/** Walk up from this module to the package manifest; survives both `src/` and `dist/`. */
function readPackageVersion(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = resolve(current, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
        if (typeof manifest.version === "string" && manifest.version.length > 0) return manifest.version;
      } catch {
        // A malformed manifest further up is not our problem; keep walking.
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "0.0.0-unknown";
}

/** Help is generated from the description, so the two cannot drift apart. */
export function renderHelp(description: CapabilityDescription = describeCapability()): string {
  const lines: string[] = [];
  lines.push(`${CLI_NAME} ${readPackageVersion()} — ${description.summary}`);
  lines.push("");
  lines.push("Usage:");
  for (const command of description.commands) lines.push(`  ${command.usage}`);
  lines.push("");
  lines.push("Layers:");
  for (const layer of description.layers) {
    lines.push(`  L${layer.layer}  ${layer.audience.padEnd(32)}${layer.use}`);
  }
  lines.push("");
  lines.push("Global options:");
  for (const flag of description.globalFlags) {
    const rendered = flag.value === undefined ? flag.name : `${flag.name} ${flag.value}`;
    lines.push(`  ${rendered.padEnd(26)}${flag.summary}`);
  }
  lines.push("");
  lines.push(`Built-in checks (${description.builtInCheckIds.length}):`);
  lines.push(`  ${description.builtInCheckIds.join(", ")}`);
  lines.push("");
  lines.push(`Profile fields (${description.profileFields.length}): ${description.profileFields.join(", ")}`);
  lines.push("");
  lines.push("Exit codes:");
  for (const key of ["ok", "hardFailure", "blocked"] as const) {
    lines.push(`  ${description.exitCodes[key]}  ${EXIT_CODE_SUMMARIES[key]}`);
  }
  return lines.join("\n") + "\n";
}

/** Human-readable `describe` output. */
export function renderDescription(description: CapabilityDescription = describeCapability()): string {
  const lines: string[] = [];
  lines.push(`capability ${description.capability} (schema ${description.schemaVersion})`);
  lines.push("");
  lines.push("commands:");
  for (const command of description.commands) {
    lines.push(`  L${command.layer}  ${command.name.padEnd(16)}${command.summary}`);
    lines.push(`        writes: ${command.writes}`);
  }
  lines.push("");
  lines.push(`built-in checks (${description.builtInCheckIds.length}): ${description.builtInCheckIds.join(", ")}`);
  lines.push(`profile fields: ${description.profileFields.join(", ")}`);
  lines.push(
    `exit codes: ok=${description.exitCodes.ok} hardFailure=${description.exitCodes.hardFailure} blocked=${description.exitCodes.blocked}`,
  );
  return lines.join("\n") + "\n";
}

/** Run one CLI invocation and return its exit code. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = [...argv];
  const wantsJson = args.includes("--json");
  const description = describeCapability();

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    process.stdout.write(renderHelp(description));
    return EXIT_CODES.ok;
  }

  if (args[0] === "--version" || args[0] === "-v" || args[0] === "version") {
    process.stdout.write(`${readPackageVersion()}\n`);
    return EXIT_CODES.ok;
  }

  const command = args.find((argument) => !argument.startsWith("-"));
  if (command === undefined) {
    process.stderr.write(`${CLI_NAME}: no command given\n\n${renderHelp(description)}`);
    return EXIT_CODES.blocked;
  }

  if (command === "describe") {
    process.stdout.write(
      wantsJson ? `${JSON.stringify(description, null, 2)}\n` : renderDescription(description),
    );
    return EXIT_CODES.ok;
  }

  const known = description.commands.some((entry) => entry.name === command);
  if (!known) {
    process.stderr.write(`${CLI_NAME}: unknown command "${command}"\n\n${renderHelp(description)}`);
    return EXIT_CODES.blocked;
  }

  if (!IMPLEMENTED.has(command)) {
    process.stderr.write(
      `${CLI_NAME}: "${command}" is described but not implemented in this build; ` +
        `use "describe --json" to see the contract\n`,
    );
    return EXIT_CODES.blocked;
  }

  process.stderr.write(`${CLI_NAME}: "${command}" reached an unexpected dispatch branch\n`);
  return EXIT_CODES.blocked;
}

const entryUrl = process.argv[1] === undefined ? "" : pathToFileURL(process.argv[1]).href;
if (import.meta.url === entryUrl) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
