/**
 * Argument parsing for the current command surface.
 *
 * Parsing is separate from dispatch so the dispatcher can be tested with plain
 * arrays, and so a flag a command does not support is a *reported* problem instead
 * of being silently ignored (a typo in `--declaration` must not fall back to
 * discovery and verify a different declaration than the caller meant).
 */
export interface ParsedArgs {
  /** First non-flag argument, or `null`. */
  readonly command: string | null;
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly screen: boolean;
  readonly declaration?: string;
  readonly profile?: string;
  readonly workRoot?: string;
  readonly positional: readonly string[];
  /** Flags nobody recognizes; the command decides whether that is fatal. */
  readonly unknown: readonly string[];
  /** Structural problems, e.g. a value flag with no value. */
  readonly problems: readonly string[];
}

/** Flags that consume the next argument as their value. */
const VALUE_FLAGS = new Map<string, "declaration" | "profile" | "workRoot">([
  ["--declaration", "declaration"],
  ["--profile", "profile"],
  ["--work-root", "workRoot"],
]);

const BOOLEAN_FLAGS = new Set(["--json", "--screen", "--help", "-h", "--version", "-v"]);

/**
 * Parse one argv array.
 *
 * `--flag=value` is accepted alongside `--flag value`; both spellings are common
 * enough that rejecting one would only produce a confusing "unknown option".
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let json = false;
  let help = false;
  let version = false;
  let screen = false;
  let declaration: string | undefined;
  let profile: string | undefined;
  let workRoot: string | undefined;
  const positional: string[] = [];
  const unknown: string[] = [];
  const problems: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (argument.startsWith("--") && argument.includes("=")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(0, equals);
      const value = argument.slice(equals + 1);
      const target = VALUE_FLAGS.get(name);
      if (target === undefined) {
        unknown.push(argument);
        continue;
      }
      if (value.length === 0) {
        problems.push(`${name} needs a value`);
        continue;
      }
      if (target === "declaration") declaration = value;
      else if (target === "profile") profile = value;
      else workRoot = value;
      continue;
    }

    if (argument.startsWith("-")) {
      if (!BOOLEAN_FLAGS.has(argument)) {
        const target = VALUE_FLAGS.get(argument);
        if (target === undefined) {
          unknown.push(argument);
          continue;
        }
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("-")) {
          problems.push(`${argument} needs a value`);
          continue;
        }
        index += 1;
        if (target === "declaration") declaration = value;
        else if (target === "profile") profile = value;
        else workRoot = value;
        continue;
      }
      if (argument === "--json") json = true;
      else if (argument === "--screen") screen = true;
      else if (argument === "--help" || argument === "-h") help = true;
      else version = true;
      continue;
    }

    positional.push(argument);
  }

  return {
    command: positional[0] ?? null,
    json,
    help,
    version,
    screen,
    ...(declaration === undefined ? {} : { declaration }),
    ...(profile === undefined ? {} : { profile }),
    ...(workRoot === undefined ? {} : { workRoot }),
    positional,
    unknown,
    problems,
  };
}
