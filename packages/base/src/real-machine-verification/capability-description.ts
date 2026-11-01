/**
 * The capability description: one structure that the CLI, the docs and the
 * architecture gate all read.
 *
 * A capability that can be driven by an agent has to be able to describe itself
 * in the same words the agent will be taught. Keeping that description as data —
 * commands, flags, check ids, exit codes — means `describe --json`, the generated
 * help text and `AGENTS-USAGE.md` cannot disagree; a mismatch is a gate failure
 * rather than something a reader has to notice.
 */
import type { CheckId } from "./contracts/branding";

/** Which layer of the three-layer model a command belongs to. */
export type CapabilityLayer = 1 | 2 | 3;

/** Global switches accepted by every command. */
export interface GlobalFlagDescription {
  readonly name: string;
  readonly value?: string;
  readonly summary: string;
}

/** One CLI command. */
export interface CommandDescription {
  readonly name: string;
  readonly layer: CapabilityLayer;
  readonly summary: string;
  readonly usage: string;
  /** What this command may write. "nothing" is a promise the tests can check. */
  readonly writes: string;
  readonly flags: readonly string[];
}

/** The exit-code contract. `stdout` and the code always agree. */
export const EXIT_CODES = {
  ok: 0,
  hardFailure: 1,
  blocked: 2,
} as const;

/**
 * One-sentence meaning per exit code.
 *
 * Kept next to `EXIT_CODES` so the help text, `describe` and the generated
 * markdown all say the same thing: there is no second copy of this sentence.
 */
export const EXIT_CODE_SUMMARIES: Readonly<Record<keyof typeof EXIT_CODES, string>> = {
  ok: "all checks passed; a skipped check is allowed and is reported as skipped",
  hardFailure: "a hard check failed; the report says which claim was falsified",
  blocked: "blocked: a prerequisite or adapter is missing, so the run proved nothing about the product",
};

/** Ids of the checks the built-in orchestration emits. Stable: comments cite them. */
export const BUILT_IN_CHECK_IDS: readonly CheckId[] = [
  "dsh-runtime",
  "node-version",
  "profile-declaration",
  "profile-present",
  "isolation-home",
  "settings-isolated",
  "package-installed",
  "package-files",
  "skills-set",
  "model-configured",
  "model-credential",
  "instance-reachable",
  "instances-distinct",
  "instance-pages",
  "logs-readable",
  "teardown-clean",
  "candidate-identity",
  "batch-freshness",
  "evidence-bound",
  "screen-present",
].map((id) => id as CheckId);

/** Fields a plugin may set in `verify/profile.ts`. */
export const PROFILE_FIELDS: readonly string[] = [
  "id",
  "packageName",
  "defaultProfile",
  "clientEntry",
  "pluginCacheDir",
  "pluginSettingsDir",
  "bundledSkills",
  "model",
  "browser",
  "workspaceBackends",
  "build",
  "instanceEnvAllowlist",
  "hooks",
  "checks",
];

/** The whole capability, as data. */
export interface CapabilityDescription {
  readonly capability: "real-machine-verification";
  readonly schemaVersion: 1;
  readonly summary: string;
  readonly layers: readonly {
    readonly layer: CapabilityLayer;
    readonly audience: string;
    readonly use: string;
  }[];
  readonly commands: readonly CommandDescription[];
  readonly builtInCheckIds: readonly CheckId[];
  readonly profileFields: readonly string[];
  readonly exitCodes: Readonly<Record<"ok" | "hardFailure" | "blocked", number>>;
  readonly globalFlags: readonly GlobalFlagDescription[];
  readonly docs: {
    readonly readme: string;
    readonly agentUsage: string;
  };
}

const GLOBAL_FLAGS: readonly GlobalFlagDescription[] = [
  { name: "--json", summary: "Print exactly one JSON document on stdout and nothing else." },
  {
    name: "--declaration",
    value: "<file>",
    summary: "Load the verification declaration from this file instead of discovering verify/profile.ts.",
  },
  {
    name: "--work-root",
    value: "<dir>",
    summary: "Write run reports and evidence under this directory (default: <cwd>/.scratch/verify).",
  },
  { name: "--dry-run", summary: "Print the plan that would run; touch nothing." },
  { name: "--negative", value: "<case>", summary: "Run only the named negative fixture." },
  { name: "--verbose", summary: "Append diagnostics to stderr (never to stdout)." },
  { name: "--help", summary: "Print usage." },
  { name: "--version", summary: "Print the base package version." },
];

const COMMANDS: readonly CommandDescription[] = [
  {
    name: "describe",
    layer: 1,
    summary: "Print this capability description (the entry point for an agent).",
    usage: "dsh-verify describe [--json]",
    writes: "nothing",
    flags: ["--json"],
  },
  {
    name: "self-check",
    layer: 1,
    summary:
      "Read-only checks: declaration, DSH runtime, Node floor, profile, installed package, display (with --screen).",
    usage:
      "dsh-verify self-check [--profile <p>] [--declaration <file>] [--work-root <dir>] [--screen] [--json]",
    writes: "run.json and evidence files under the work root",
    flags: ["--profile <p>", "--declaration <file>", "--work-root <dir>", "--screen", "--json"],
  },
  {
    name: "launch",
    layer: 2,
    summary: "Launch one isolated instance and print its handle.",
    usage: "dsh-verify launch [--profile <p>] [--port <n>] [--keep] [--json]",
    writes: "an isolated home, a working directory, instance.json",
    flags: ["--profile <p>", "--keep", "--port <n>", "--json"],
  },
  {
    name: "stop",
    layer: 2,
    summary: "Stop one instance by id or directory; --all reaps every instance in the work root.",
    usage: "dsh-verify stop [--id <id>] [--dir <d>] [--all] [--json]",
    writes: "stopped.json in the instance directory",
    flags: ["--id <id>", "--dir <d>", "--all", "--json"],
  },
  {
    name: "isolation",
    layer: 2,
    summary: "Prove plugin settings are redirected: child-process probe plus real-file hash before/after.",
    usage: "dsh-verify isolation [--json]",
    writes: "probe artifacts under the work root",
    flags: ["--json"],
  },
  {
    name: "model",
    layer: 2,
    summary: "Inspect or configure the model triple; verify cross-entry references agree.",
    usage: "dsh-verify model [--profile <p>] [--provider <p>] [--model <m>] [--api-key-env <ENV>] [--fix] [--json]",
    writes: "nothing unless --fix is given",
    flags: ["--profile <p>", "--provider <p>", "--model <m>", "--api-key-env <ENV>", "--fix", "--json"],
  },
  {
    name: "install",
    layer: 2,
    summary: "Install a candidate tgz into a profile and verify every file against the manifest.",
    usage:
      "dsh-verify install --tgz <file> [--method extract|cli] [--profile <p>] [--declaration <file>] [--work-root <dir>] [--json]",
    writes: "the isolated profile's node_modules",
    flags: [
      "--tgz <file>",
      "--method extract|cli",
      "--profile <p>",
      "--declaration <file>",
      "--work-root <dir>",
      "--candidate <dir>",
      "--json",
    ],
  },
  {
    name: "skills",
    layer: 2,
    summary: "Compare registered skills by set equality against the declaration (never by count).",
    usage: "dsh-verify skills [--profile <p>] [--declaration <file>] [--json]",
    writes: "nothing",
    flags: ["--profile <p>", "--declaration <file>", "--json"],
  },
  {
    name: "single-instance",
    layer: 1,
    summary: "Launch, open the app shell, run declared checks, collect evidence, tear down.",
    usage:
      "dsh-verify single-instance [--profile <p>] [--declaration <file>] [--work-root <dir>] [--keep] [--dry-run] [--json]",
    writes: "a run directory under the work root: report, evidence, logs",
    flags: [
      "--profile <p>",
      "--declaration <file>",
      "--work-root <dir>",
      "--keep",
      "--dry-run",
      "--json",
    ],
  },
  {
    name: "concurrent",
    layer: 1,
    summary: "Launch N instances across profiles and assert pairwise isolation of home, port, cwd and logs.",
    usage: "dsh-verify concurrent --count <N> [--profiles a,b,c] [--json]",
    writes: "the batch directory: evidence, summary, logs",
    flags: ["--count <N>", "--profiles a,b,c", "--json"],
  },
  {
    name: "freeze",
    layer: 1,
    summary: "Build, pack and record the candidate identity (commit, file digest, tgz digest).",
    usage: "dsh-verify freeze [--out <dir>] [--allow-dirty] [--json]",
    writes: "candidate.json and the tgz under the given output directory",
    flags: ["--out <dir>", "--allow-dirty", "--json"],
  },
  {
    name: "batch",
    layer: 1,
    summary: "Open, inspect or finish a verification batch; writes the identity line and checks freshness.",
    usage:
      "dsh-verify batch open|status [--name <n>] [--base-ref <r>] [--candidate <dir>] [--allow-stale] [--work-root <dir>] [--json]",
    writes: "batch.json under the work root, plus the identity and baseline lines",
    flags: [
      "--name <n>",
      "--base-ref <r>",
      "--candidate <dir>",
      "--allow-stale",
      "--profile <p>",
      "--declaration <file>",
      "--work-root <dir>",
      "--dry-run",
      "--json",
    ],
  },
  {
    name: "evidence",
    layer: 1,
    summary: "Add bound evidence, archive a batch with a sorted SHA256SUMS.txt, or verify an archive by recomputing it.",
    usage:
      "dsh-verify evidence add|archive|verify [--file <p>]... [--check <id>=pass|fail] [--archive-root <dir>] [--dir <dir>] [--name <n>] [--work-root <dir>] [--json]",
    writes: "evidence/files, evidence.json, the archive directory",
    flags: [
      "--file <p>",
      "--check <id>=pass|fail",
      "--archive-root <dir>",
      "--dir <dir>",
      "--name <n>",
      "--work-root <dir>",
      "--json",
    ],
  },
  {
    name: "run",
    layer: 1,
    summary: "Run a scenario file: steps in file order, bounded concurrency, fail-fast or collect-all.",
    usage:
      "dsh-verify run <scenario.ts> [--concurrency <n>] [--fail-fast|--collect-all] [--profile <p>] [--declaration <file>] [--work-root <dir>] [--json]",
    writes: "a run directory under the work root: report, evidence, logs",
    flags: [
      "--concurrency <n>",
      "--fail-fast",
      "--collect-all",
      "--profile <p>",
      "--declaration <file>",
      "--work-root <dir>",
      "--json",
    ],
  },
  {
    name: "cleanup",
    layer: 1,
    summary: "Report or delete work-root artifacts by ownership and age; unknown entries are only reported.",
    usage: "dsh-verify cleanup [--yes] [--keep-batches 2] [--keep-homes <n>] [--include-pkg] [--json]",
    writes: "the work root, only with --yes",
    flags: ["--yes", "--keep-batches <n>", "--keep-homes <n>", "--include-pkg", "--json"],
  },
];

/** Build the description value. Pure: same input (none) means same output. */
export function describeCapability(): CapabilityDescription {
  return {
    capability: "real-machine-verification",
    schemaVersion: 1,
    summary:
      "Run a plugin build inside a provably isolated DSH instance, check falsifiable claims, and keep evidence that another machine can re-verify.",
    layers: [
      { layer: 1, audience: "people and CI", use: "fixed-shape orchestration: one command per intent" },
      { layer: 2, audience: "agents and scripts", use: "composable primitives in any order" },
      { layer: 3, audience: "agents facing an unforeseen case", use: "break-glass: pages, raw handles, custom steps" },
    ],
    commands: COMMANDS,
    builtInCheckIds: BUILT_IN_CHECK_IDS,
    profileFields: PROFILE_FIELDS,
    exitCodes: EXIT_CODES,
    globalFlags: GLOBAL_FLAGS,
    docs: {
      readme: "README.md",
      agentUsage: "AGENTS-USAGE.md",
    },
  };
}
