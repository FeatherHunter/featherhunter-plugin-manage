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
  readonly fix: boolean;
  readonly failFast: boolean;
  readonly collectAll: boolean;
  readonly yes: boolean;
  readonly includePkg: boolean;
  readonly allowDirty: boolean;
  readonly allowStale: boolean;
  readonly declaration?: string;
  readonly profile?: string;
  readonly workRoot?: string;
  /** Raw `--port` value; validated by the launch command. */
  readonly port?: string;
  /** Raw `--id` value; resolved by the stop command. */
  readonly id?: string;
  /** Raw `--dir` value; resolved by the stop command. */
  readonly dir?: string;
  /** Raw `--count` value; validated by the concurrent command. */
  readonly count?: string;
  /** Raw `--profiles` value (comma separated); validated by the concurrent command. */
  readonly profiles?: string;
  /** Raw `--out` value (freeze output directory). */
  readonly out?: string;
  /** Raw `--name` value (batch name). */
  readonly name?: string;
  /** Raw `--batch` value (batch name selected for evidence binding). */
  readonly batch?: string;
  /** Raw `--candidate` value (frozen candidate directory). */
  readonly candidate?: string;
  /** Raw `--base-ref` value (batch baseline ref). */
  readonly baseRef?: string;
  /** Raw `--archive-root` value (evidence archive root). */
  readonly archiveRoot?: string;
  /** Raw `--tgz` value (candidate package to install). */
  readonly tgz?: string;
  /** Raw `--method` value (install method). */
  readonly method?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  /** Raw `--concurrency` value (scenario runner). */
  readonly concurrency?: string;
  /** Raw `--keep-batches` value (cleanup). */
  readonly keepBatches?: string;
  /** Raw `--keep-homes` value (cleanup). */
  readonly keepHomes?: string;
  /** Every `--file` value, in order; evidence add accepts several. */
  readonly files: readonly string[];
  /** Every `--check` value, in order; evidence add accepts several. */
  readonly checks: readonly string[];
  readonly positional: readonly string[];
  /** Flags nobody recognizes; the command decides whether that is fatal. */
  readonly unknown: readonly string[];
  /** Structural problems, e.g. a value flag with no value. */
  readonly problems: readonly string[];
  /** Canonical spellings of every recognized flag that was given, in order. */
  readonly given: readonly string[];
}

/** Flags that consume the next argument as their value. */
type ValueFlag =
  | "declaration"
  | "profile"
  | "workRoot"
  | "port"
  | "id"
  | "dir"
  | "count"
  | "profiles"
  | "out"
  | "name"
  | "baseRef"
  | "batch"
  | "candidate"
  | "archiveRoot"
  | "tgz"
  | "method"
  | "provider"
  | "model"
  | "apiKeyEnv"
  | "concurrency"
  | "keepBatches"
  | "keepHomes";

/** Flags that may be given more than once; every occurrence is kept. */
type MultiValueFlag = "file" | "check";

const VALUE_FLAGS = new Map<string, ValueFlag>([
  ["--declaration", "declaration"],
  ["--profile", "profile"],
  ["--work-root", "workRoot"],
  ["--port", "port"],
  ["--id", "id"],
  ["--dir", "dir"],
  ["--count", "count"],
  ["--profiles", "profiles"],
  ["--out", "out"],
  ["--name", "name"],
  ["--base-ref", "baseRef"],
  ["--batch", "batch"],
  ["--candidate", "candidate"],
  ["--archive-root", "archiveRoot"],
  ["--tgz", "tgz"],
  ["--method", "method"],
  ["--provider", "provider"],
  ["--model", "model"],
  ["--api-key-env", "apiKeyEnv"],
  ["--concurrency", "concurrency"],
  ["--keep-batches", "keepBatches"],
  ["--keep-homes", "keepHomes"],
]);

/** The spelling reported in `given`; `--flag=value` still reports the flag name. */
const VALUE_CANONICAL: Readonly<Record<ValueFlag, string>> = {
  declaration: "--declaration",
  profile: "--profile",
  workRoot: "--work-root",
  port: "--port",
  id: "--id",
  dir: "--dir",
  count: "--count",
  profiles: "--profiles",
  out: "--out",
  name: "--name",
  baseRef: "--base-ref",
  batch: "--batch",
  candidate: "--candidate",
  archiveRoot: "--archive-root",
  tgz: "--tgz",
  method: "--method",
  provider: "--provider",
  model: "--model",
  apiKeyEnv: "--api-key-env",
  concurrency: "--concurrency",
  keepBatches: "--keep-batches",
  keepHomes: "--keep-homes",
};

const MULTI_VALUE_FLAGS = new Map<string, MultiValueFlag>([
  ["--file", "file"],
  ["--check", "check"],
]);

const MULTI_VALUE_CANONICAL: Readonly<Record<MultiValueFlag, string>> = {
  file: "--file",
  check: "--check",
};

type BooleanFlag =
  | "json"
  | "help"
  | "version"
  | "screen"
  | "keep"
  | "dryRun"
  | "all"
  | "fix"
  | "failFast"
  | "collectAll"
  | "yes"
  | "includePkg"
  | "allowDirty"
  | "allowStale";

const BOOLEAN_FLAGS = new Map<string, BooleanFlag>([
  ["--json", "json"],
  ["--screen", "screen"],
  ["--keep", "keep"],
  ["--dry-run", "dryRun"],
  ["--all", "all"],
  ["--fix", "fix"],
  ["--fail-fast", "failFast"],
  ["--collect-all", "collectAll"],
  ["--yes", "yes"],
  ["--include-pkg", "includePkg"],
  ["--allow-dirty", "allowDirty"],
  ["--allow-stale", "allowStale"],
  ["--help", "help"],
  ["-h", "help"],
  ["--version", "version"],
  ["-v", "version"],
]);

const BOOLEAN_CANONICAL: Readonly<Record<BooleanFlag, string>> = {
  json: "--json",
  help: "--help",
  version: "--version",
  screen: "--screen",
  keep: "--keep",
  dryRun: "--dry-run",
  all: "--all",
  fix: "--fix",
  failFast: "--fail-fast",
  collectAll: "--collect-all",
  yes: "--yes",
  includePkg: "--include-pkg",
  allowDirty: "--allow-dirty",
  allowStale: "--allow-stale",
};

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
    fix: false,
    failFast: false,
    collectAll: false,
    yes: false,
    includePkg: false,
    allowDirty: false,
    allowStale: false,
  };
  const values: Partial<Record<ValueFlag, string>> = {};
  const multi: Record<MultiValueFlag, string[]> = { file: [], check: [] };
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
      const multiTarget = MULTI_VALUE_FLAGS.get(name);
      if (multiTarget !== undefined) {
        given.push(MULTI_VALUE_CANONICAL[multiTarget]);
        if (value.length === 0) {
          problems.push(`${name} needs a value`);
          continue;
        }
        multi[multiTarget].push(value);
        continue;
      }
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
        const multiTarget = MULTI_VALUE_FLAGS.get(argument);
        if (multiTarget !== undefined) {
          const value = argv[index + 1];
          given.push(MULTI_VALUE_CANONICAL[multiTarget]);
          if (value === undefined || value.startsWith("-")) {
            problems.push(`${argument} needs a value`);
            continue;
          }
          index += 1;
          multi[multiTarget].push(value);
          continue;
        }
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
      given.push(BOOLEAN_CANONICAL[booleanFlag]);
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
    fix: booleans.fix,
    failFast: booleans.failFast,
    collectAll: booleans.collectAll,
    yes: booleans.yes,
    includePkg: booleans.includePkg,
    allowDirty: booleans.allowDirty,
    allowStale: booleans.allowStale,
    ...(values.declaration === undefined ? {} : { declaration: values.declaration }),
    ...(values.profile === undefined ? {} : { profile: values.profile }),
    ...(values.workRoot === undefined ? {} : { workRoot: values.workRoot }),
    ...(values.port === undefined ? {} : { port: values.port }),
    ...(values.id === undefined ? {} : { id: values.id }),
    ...(values.dir === undefined ? {} : { dir: values.dir }),
    ...(values.count === undefined ? {} : { count: values.count }),
    ...(values.profiles === undefined ? {} : { profiles: values.profiles }),
    ...(values.out === undefined ? {} : { out: values.out }),
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.baseRef === undefined ? {} : { baseRef: values.baseRef }),
    ...(values.batch === undefined ? {} : { batch: values.batch }),
    ...(values.candidate === undefined ? {} : { candidate: values.candidate }),
    ...(values.archiveRoot === undefined ? {} : { archiveRoot: values.archiveRoot }),
    ...(values.tgz === undefined ? {} : { tgz: values.tgz }),
    ...(values.method === undefined ? {} : { method: values.method }),
    ...(values.provider === undefined ? {} : { provider: values.provider }),
    ...(values.model === undefined ? {} : { model: values.model }),
    ...(values.apiKeyEnv === undefined ? {} : { apiKeyEnv: values.apiKeyEnv }),
    ...(values.concurrency === undefined ? {} : { concurrency: values.concurrency }),
    ...(values.keepBatches === undefined ? {} : { keepBatches: values.keepBatches }),
    ...(values.keepHomes === undefined ? {} : { keepHomes: values.keepHomes }),
    files: multi.file,
    checks: multi.check,
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
