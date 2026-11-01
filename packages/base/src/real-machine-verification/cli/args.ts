/**
 * Argument parsing for the current command surface.
 *
 * Parsing is separate from dispatch so the dispatcher can be tested with plain
 * arrays, and so a flag a command does not support is a *reported* problem instead
 * of being silently ignored (a typo in `--declaration` must not fall back to
 * discovery and verify a different declaration than the caller meant).
 *
 * The parser knows every flag this build declares, including the command-specific
 * ones. `given` records the canonical spelling of each flag that was seen, which
 * is how a command rejects a real flag it does not implement (`stop --keep`)
 * instead of treating it as a typo (`unknown`).
 */
export interface ParsedArgs {
  /** First non-flag argument, or `null`. */
  readonly command: string | null;
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly screen: boolean;
  readonly keep: boolean;
  readonly dryRun: boolean;
  readonly all: boolean;
  readonly declaration?: string;
  readonly profile?: string;
  readonly workRoot?: string;
  /** Raw `--port` value; validated by the launch command. */
  readonly port?: string;
  /** Raw `--id` value; resolved by the stop command. */
  readonly id?: string;
  /** Raw `--dir` value; resolved by the stop command. */
  readonly dir?: string;
  readonly positional: readonly string[];
  /** Flags nobody recognizes; the command decides whether that is fatal. */
  readonly unknown: readonly string[];
  /** Structural problems, e.g. a value flag with no value. */
  readonly problems: readonly string[];
  /** Canonical spellings of every recognized flag that was given, in order. */
  readonly given: readonly string[];
}

/** Flags that consume the next argument as their value. */
type ValueFlag = "declaration" | "profile" | "workRoot" | "port" | "id" | "dir";

const VALUE_FLAGS = new Map<string, ValueFlag>([
  ["--declaration", "declaration"],
  ["--profile", "profile"],
  ["--work-root", "workRoot"],
  ["--port", "port"],
  ["--id", "id"],
  ["--dir", "dir"],
]);

/** The spelling reported in `given`; `--flag=value` still reports the flag name. */
const VALUE_CANONICAL: Readonly<Record<ValueFlag, string>> = {
  declaration: "--declaration",
  profile: "--profile",
  workRoot: "--work-root",
  port: "--port",
  id: "--id",
  dir: "--dir",
};

type BooleanFlag = "json" | "help" | "version" | "screen" | "keep" | "dryRun" | "all";

const BOOLEAN_FLAGS = new Map<string, BooleanFlag>([
  ["--json", "json"],
  ["--screen", "screen"],
  ["--keep", "keep"],
  ["--dry-run", "dryRun"],
  ["--all", "all"],
  ["--help", "help"],
  ["-h", "help"],
  ["--version", "version"],
  ["-v", "version"],
]);

/**
 * Parse one argv array.
 *
 * `--flag=value` is accepted alongside `--flag value`; both spellings are common
 * enough that rejecting one would only produce a confusing "unknown option".
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const booleans: Record<BooleanFlag, boolean> = {
    json: false,
    help: false,
    version: false,
    screen: false,
    keep: false,
    dryRun: false,
    all: false,
  };
  const values: Partial<Record<ValueFlag, string>> = {};
  const positional: string[] = [];
  const unknown: string[] = [];
  const problems: string[] = [];
  const given: string[] = [];

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
      given.push(VALUE_CANONICAL[target]);
      if (value.length === 0) {
        problems.push(`${name} needs a value`);
        continue;
      }
      values[target] = value;
      continue;
    }

    if (argument.startsWith("-")) {
      const booleanFlag = BOOLEAN_FLAGS.get(argument);
      if (booleanFlag === undefined) {
        const target = VALUE_FLAGS.get(argument);
        if (target === undefined) {
          unknown.push(argument);
          continue;
        }
        const value = argv[index + 1];
        given.push(VALUE_CANONICAL[target]);
        if (value === undefined || value.startsWith("-")) {
          problems.push(`${argument} needs a value`);
          continue;
        }
        index += 1;
        values[target] = value;
        continue;
      }
      given.push(`--${booleanFlag === "dryRun" ? "dry-run" : booleanFlag}`);
      booleans[booleanFlag] = true;
      continue;
    }

    positional.push(argument);
  }

  return {
    command: positional[0] ?? null,
    json: booleans.json,
    help: booleans.help,
    version: booleans.version,
    screen: booleans.screen,
    keep: booleans.keep,
    dryRun: booleans.dryRun,
    all: booleans.all,
    ...(values.declaration === undefined ? {} : { declaration: values.declaration }),
    ...(values.profile === undefined ? {} : { profile: values.profile }),
    ...(values.workRoot === undefined ? {} : { workRoot: values.workRoot }),
    ...(values.port === undefined ? {} : { port: values.port }),
    ...(values.id === undefined ? {} : { id: values.id }),
    ...(values.dir === undefined ? {} : { dir: values.dir }),
    positional,
    unknown,
    problems,
    given,
  };
}

/**
 * Problems that make one command's invocation invalid.
 *
 * Shared by every dispatch branch: an unknown option, a structural problem, a
 * recognized flag that belongs to another command, and stray positional arguments
 * are all reported the same way (`exit 2`), so a script typo never silently
 * changes what is executed.
 */
export function flagProblems(args: ParsedArgs, allowed: ReadonlySet<string>): readonly string[] {
  const problems: string[] = [];
  if (args.unknown.length > 0) problems.push(`unknown option(s): ${args.unknown.join(", ")}`);
  for (const problem of args.problems) problems.push(problem);
  const notAllowed = [...new Set(args.given)].filter((flag) => !allowed.has(flag)).sort();
  if (notAllowed.length > 0) problems.push(`option(s) not valid for this command: ${notAllowed.join(", ")}`);
  if (args.positional.length > 1) problems.push(`unexpected argument(s): ${args.positional.slice(1).join(" ")}`);
  return problems;
}
