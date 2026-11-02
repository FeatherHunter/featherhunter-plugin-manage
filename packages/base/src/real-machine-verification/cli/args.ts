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

/**
 * Every flag this build accepts, declared once.
 *
 * Each spec owns its key (the `ParsedArgs` field), its canonical spelling and any
 * aliases; the lookup maps, the canonical-spelling record and the default-value
 * objects are all derived from these three tables. Adding a flag is therefore one
 * row, not four edits that can drift apart.
 */
interface FlagSpec<Key extends string> {
  readonly key: Key;
  /** Non-empty; the first spelling is canonical (reported in `given` and errors). */
  readonly spellings: readonly [string, ...string[]];
}

/** Flags that consume the next argument as their value. */
const VALUE_FLAG_SPECS = [
  { key: "declaration", spellings: ["--declaration"] },
  { key: "profile", spellings: ["--profile"] },
  { key: "workRoot", spellings: ["--work-root"] },
  { key: "port", spellings: ["--port"] },
  { key: "id", spellings: ["--id"] },
  { key: "dir", spellings: ["--dir"] },
  { key: "count", spellings: ["--count"] },
  { key: "profiles", spellings: ["--profiles"] },
  { key: "out", spellings: ["--out"] },
  { key: "name", spellings: ["--name"] },
  { key: "baseRef", spellings: ["--base-ref"] },
  { key: "batch", spellings: ["--batch"] },
  { key: "candidate", spellings: ["--candidate"] },
  { key: "archiveRoot", spellings: ["--archive-root"] },
  { key: "tgz", spellings: ["--tgz"] },
  { key: "method", spellings: ["--method"] },
  { key: "provider", spellings: ["--provider"] },
  { key: "model", spellings: ["--model"] },
  { key: "apiKeyEnv", spellings: ["--api-key-env"] },
  { key: "concurrency", spellings: ["--concurrency"] },
  { key: "keepBatches", spellings: ["--keep-batches"] },
  { key: "keepHomes", spellings: ["--keep-homes"] },
] as const satisfies readonly FlagSpec<string>[];

type ValueFlag = (typeof VALUE_FLAG_SPECS)[number]["key"];

/** Flags that may be given more than once; every occurrence is kept. */
const MULTI_VALUE_FLAG_SPECS = [
  { key: "file", spellings: ["--file"] },
  { key: "check", spellings: ["--check"] },
] as const satisfies readonly FlagSpec<string>[];

type MultiValueFlag = (typeof MULTI_VALUE_FLAG_SPECS)[number]["key"];

/** Boolean switches, including the short aliases. */
const BOOLEAN_FLAG_SPECS = [
  { key: "json", spellings: ["--json"] },
  { key: "help", spellings: ["--help", "-h"] },
  { key: "version", spellings: ["--version", "-v"] },
  { key: "screen", spellings: ["--screen"] },
  { key: "keep", spellings: ["--keep"] },
  { key: "dryRun", spellings: ["--dry-run"] },
  { key: "all", spellings: ["--all"] },
  { key: "fix", spellings: ["--fix"] },
  { key: "failFast", spellings: ["--fail-fast"] },
  { key: "collectAll", spellings: ["--collect-all"] },
  { key: "yes", spellings: ["--yes"] },
  { key: "includePkg", spellings: ["--include-pkg"] },
  { key: "allowDirty", spellings: ["--allow-dirty"] },
  { key: "allowStale", spellings: ["--allow-stale"] },
] as const satisfies readonly FlagSpec<string>[];

type BooleanFlag = (typeof BOOLEAN_FLAG_SPECS)[number]["key"];

function lookupMap<Key extends string>(specs: readonly FlagSpec<Key>[]): ReadonlyMap<string, Key> {
  const map = new Map<string, Key>();
  for (const spec of specs) {
    for (const spelling of spec.spellings) map.set(spelling, spec.key);
  }
  return map;
}

function canonicalRecord<Key extends string>(specs: readonly FlagSpec<Key>[]): Readonly<Record<Key, string>> {
  const record = {} as Record<Key, string>;
  for (const spec of specs) record[spec.key] = spec.spellings[0];
  return record;
}

const VALUE_FLAGS = lookupMap(VALUE_FLAG_SPECS);
/** The spelling reported in `given`; `--flag=value` still reports the flag name. */
const VALUE_CANONICAL = canonicalRecord(VALUE_FLAG_SPECS);
const MULTI_VALUE_FLAGS = lookupMap(MULTI_VALUE_FLAG_SPECS);
const MULTI_VALUE_CANONICAL = canonicalRecord(MULTI_VALUE_FLAG_SPECS);
const BOOLEAN_FLAGS = lookupMap(BOOLEAN_FLAG_SPECS);
const BOOLEAN_CANONICAL = canonicalRecord(BOOLEAN_FLAG_SPECS);

/**
 * Parse one argv array.
 *
 * `--flag=value` is accepted alongside `--flag value`; both spellings are common
 * enough that rejecting one would only produce a confusing "unknown option".
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const booleans = Object.fromEntries(
    BOOLEAN_FLAG_SPECS.map((spec) => [spec.key, false]),
  ) as Record<BooleanFlag, boolean>;
  const values: Partial<Record<ValueFlag, string>> = {};
  const multi = Object.fromEntries(
    MULTI_VALUE_FLAG_SPECS.map((spec) => [spec.key, [] as string[]]),
  ) as Record<MultiValueFlag, string[]>;
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

  // Only flags that were given become fields: with exactOptionalPropertyTypes,
  // an absent flag must stay absent rather than become an explicit undefined.
  const definedValues: Partial<Record<ValueFlag, string>> = {};
  for (const key of Object.keys(values) as ValueFlag[]) {
    const value = values[key];
    if (value !== undefined) definedValues[key] = value;
  }

  return {
    command: positional[0] ?? null,
    ...booleans,
    ...definedValues,
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
