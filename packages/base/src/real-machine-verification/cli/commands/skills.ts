/**
 * `dsh-verify skills` — report the shipped skill set from the file tree.
 *
 * The rule lives in `orchestration/checks/skills-set.ts`; this command only
 * supplies the context, renders the check and maps its status to an exit code.
 * It deliberately writes nothing: the authoritative observation is the six
 * ranked skill roots plus each SKILL.md's frontmatter name, not a model-facing
 * catalog (the host hides `disable-model-invocation` skills there).
 */
import { EXIT_CODES } from "../../capability-description";
import { asEvidencePath } from "../../contracts/branding";
import type { CheckResult } from "../../contracts/check";
import type { EvidenceItem, EvidenceKind } from "../../contracts/evidence-contract";
import type { ClockPort, Ports } from "../../contracts/ports";
import { sha256Text } from "../../contracts/identity";
import { ok, type Result } from "../../contracts/result";
import { stateFromChecks } from "../../contracts/run-state";
import { MODEL_CATALOG_CAVEAT } from "../../contracts/skills-rules";
import type { DeclarationLoadResult, LoadDeclarationOptions } from "../../declaration/loader";
import type { EvidenceStore, EvidenceRecordOptions } from "../../evidence/store";
import { loadDeclarationContext } from "../../orchestration/context";
import { createSkillsSetCheck } from "../../orchestration/checks/skills-set";
import { renderCheckLines } from "../../orchestration/report";
import type { SelfCheckContext } from "../../orchestration/self-check";
import { toCheckResult } from "../../orchestration/types";
import type { RuntimeFacts } from "../../runtime/types";
import { flagProblems, type ParsedArgs } from "../args";
import type { CliIo } from "../io";
import { emitFailure, emitUsageFailure } from "./failure";

/** Everything the command needs injected; tests replace the machine. */
export interface SkillsCommandDeps {
  readonly ports: Ports;
  readonly io: CliIo;
  readonly runtime: RuntimeFacts;
  readonly loadDeclaration?: (options: LoadDeclarationOptions) => Promise<DeclarationLoadResult>;
}

export const SKILLS_USAGE = "dsh-verify skills [--profile <p>] [--json]";

const SKILLS_FLAGS: ReadonlySet<string> = new Set(["--json", "--profile", "--declaration"]);

const encoder = new TextEncoder();

/**
 * An in-memory evidence store for a read-only report.
 *
 * The skills command promises "writes nothing"; the shared check still wants a
 * store to record its observation. A memory store keeps that observation in the
 * process (the check's detail carries the conclusion) without creating a run
 * directory or an evidence package.
 */
function createMemoryEvidenceStore(clock: ClockPort): EvidenceStore {
  const recorded: EvidenceItem[] = [];
  const record = (
    name: string,
    content: string,
    kind: EvidenceKind,
    options?: EvidenceRecordOptions,
  ): Result<EvidenceItem> => {
    const item: EvidenceItem = {
      kind: options?.kind ?? kind,
      path: asEvidencePath(name),
      bytes: encoder.encode(content).byteLength,
      sha256: sha256Text(content) as EvidenceItem["sha256"],
      capturedAt: options?.capturedAt ?? clock.iso(),
      ...(options?.note === undefined ? {} : { note: options.note }),
    };
    recorded.push(item);
    return ok(item);
  };
  return {
    root: "(memory)",
    items: () => [...recorded],
    recordText: async (name, content, options) => record(name, content, "text", options),
    recordJson: async (name, value, options) => record(name, `${JSON.stringify(value, null, 2)}\n`, "json", options),
  };
}

/** Run one `skills` invocation and return its exit code. */
export async function runSkillsCommand(args: ParsedArgs, deps: SkillsCommandDeps): Promise<number> {
  const { ports, io } = deps;
  const problems = flagProblems(args, SKILLS_FLAGS);
  if (problems.length > 0) return emitUsageFailure(io, args.json, "skills", problems, SKILLS_USAGE);

  const cwd = ports.env.cwd();
  const loaded = await loadDeclarationContext({
    ports,
    cwd,
    nodeVersion: deps.runtime.nodeVersion,
    ...(args.declaration === undefined ? {} : { declarationPath: args.declaration }),
    ...(args.profile === undefined ? {} : { profileOverride: args.profile }),
    ...(deps.loadDeclaration === undefined ? {} : { loadDeclaration: deps.loadDeclaration }),
  });
  if (!loaded.ok) {
    return emitFailure(io, args.json, "skills", loaded.error.stage, loaded.error.failure);
  }
  const context = loaded.value;
  const evidence = createMemoryEvidenceStore(ports.clock);
  const note = (message: string): void => {
    io.stderr(`dsh-verify skills: ${message}\n`);
  };
  const checkContext: SelfCheckContext = {
    profile: context.profile,
    profileName: context.profileName,
    ports,
    cwd,
    dshHome: context.dshHome,
    profileDir: context.profileDir,
    workRoot: context.workRoot,
    nodeVersion: deps.runtime.nodeVersion,
    readFileSlice: deps.runtime.readFileSlice,
    declaration: {
      path: context.declaration.path,
      kind: context.declaration.kind,
      exportName: context.declaration.exportName,
      requiredNode: context.declaration.requiredNode,
    },
    screenRequested: false,
    evidence,
    note,
  };

  const module = createSkillsSetCheck();
  const startedMs = ports.clock.nowMs();
  const outcome = await module.run(checkContext);
  const check: CheckResult = {
    ...toCheckResult(module, outcome, Math.max(0, ports.clock.nowMs() - startedMs)),
    source: "builtin",
  };
  const exitCode = stateFromChecks([check]).exitCode;
  const lines = renderCheckLines(check);

  if (args.json) {
    const payload = {
      schemaVersion: 1,
      command: "skills",
      ok: exitCode === 0,
      profile: context.profileName,
      checks: [check],
      notes: [MODEL_CATALOG_CAVEAT],
    };
    io.stdout(`${JSON.stringify(payload)}\n`);
    for (const line of lines) io.stderr(`${line}\n`);
  } else {
    for (const line of lines) io.stdout(`${line}\n`);
    io.stdout(`note: ${MODEL_CATALOG_CAVEAT}\n`);
  }
  return exitCode === 0 ? EXIT_CODES.ok : exitCode;
}
