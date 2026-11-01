/**
 * L2 primitives: the small, composable operations a scenario is made of.
 *
 * A primitive is a function over `Ports`, never a command. It returns a
 * `Result` or a stable observation, so a scenario can branch on the value and a
 * test can call it without a CLI. The CLI commands are thin wrappers around
 * these; scenarios compose them.
 *
 * L3 is deliberately part of the handle rather than a separate module: a
 * scenario that needs the raw pid, a page, or a startup hook reaches through the
 * same object it launched. That is the escape hatch — no new command, no new
 * seam.
 */
import type { ProfileName } from "../contracts/branding";
import { parseCheckId } from "../contracts/branding";
import type { CheckResult, CheckStatus } from "../contracts/check";
import type { EvidenceItem, EvidenceKind } from "../contracts/evidence-contract";
import type { DshRuntimePaths } from "../contracts/launch-plan";
import type { BrowserPageHandle, BrowserProbeFactory, KillOutcome, Ports } from "../contracts/ports";
import { err, failure, ok, type Failure, type Result } from "../contracts/result";
import type { ScenarioObservation } from "../contracts/scenario";
import type { ModelSelection, VerificationProfile } from "../contracts/verification-profile";
import type { EvidenceStore } from "../evidence/store";
import type { DeclarationKind } from "../declaration/loader";
import type { CheckOutcome } from "./types";
import { checkId, normalizeOutcome } from "./types";
import { executeInstance, planInstance, type ExecutedInstance, type InstanceFailure, type PlanProjection } from "./instance";
import type { SelfCheckContext, SelfCheckDeclaration } from "./self-check";
import { createModelConfiguredCheck } from "./checks/model-configured";
import { createModelCredentialCheck } from "./checks/model-credential";
import { createPackageInstalledCheck } from "./checks/package-installed";
import { createScreenPresentCheck } from "./checks/screen-present";
import { createSkillsSetCheck } from "./checks/skills-set";
import { installPackage, type InstallMethod, type InstallOutcome } from "./install-package";
import type { InstanceRecord } from "../runtime/dsh/launch";
import { stopRecord, tailOf } from "../runtime/dsh/launch";
import type { CredentialPresence, ModelConfigObservation } from "../runtime/dsh/model-configurator";
import { observeCredentialPresence, readModelConfig } from "../runtime/dsh/model-configurator";
import { joinFsPath } from "../runtime/paths";
import type { BinaryWriter } from "../runtime/platform/binary-writer";
import { createBinaryWriter } from "../runtime/platform/binary-writer";
import type { ReadFileSlice } from "../runtime/types";
import type { BrowserAdapterDeclaration } from "../contracts/verification-profile";
import { loadBrowserAdapter } from "../adapters/browser/loader";

/** The five built-in checks a `check` step may name. */
export const PRIMITIVE_CHECK_IDS = [
  "package-installed",
  "skills-set",
  "model-configured",
  "model-credential",
  "screen-present",
] as const;
export type PrimitiveCheckName = (typeof PRIMITIVE_CHECK_IDS)[number];

export interface PrimitiveCheckResult {
  readonly id: PrimitiveCheckName;
  readonly title: string;
  readonly outcome: CheckOutcome;
}

/** A page plus the session that owns it; closing the handle closes both. */
export interface PageHandle {
  readonly page: BrowserPageHandle;
  url(): string;
  evaluate<TResult>(script: string): Promise<Result<TResult>>;
  innerSize(): Promise<Result<{ readonly width: number; readonly height: number }>>;
  outerSize(): Promise<Result<{ readonly width: number; readonly height: number }>>;
  text(selector: string): Promise<Result<string | null>>;
  screenshot(path: string, options?: { readonly fullPage?: boolean }): Promise<Result<{ readonly bytes: number }>>;
  pageErrors(): readonly string[];
  close(): Promise<void>;
}

export interface PageFailure extends Failure {
  readonly kind: "blocked" | "failed";
}

export interface RawProcessHandle {
  readonly pid: number;
  isAlive(): boolean;
  kill(): Promise<Result<KillOutcome>>;
}

export interface PrimitiveLogSnapshot {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly bytes: number;
  readonly pid: number;
  readonly alive: boolean;
  readonly readable: boolean;
}

/** The L3 escape hatch: one running instance and everything attached to it. */
export interface InstanceHandle {
  readonly record: InstanceRecord;
  readonly plan: PlanProjection;
  readonly pid: number;
  isAlive(): boolean;
  kill(): Promise<Result<KillOutcome>>;
  stop(): Promise<Result<KillOutcome>>;
  logs(bytes?: number): Promise<Result<PrimitiveLogSnapshot>>;
  page(): Promise<Result<PageHandle, PageFailure>>;
  rawProcess(): RawProcessHandle;
}

export interface LaunchPrimitiveOptions {
  readonly port?: number;
  readonly keep?: boolean;
  readonly readyTimeoutMs?: number;
  /** Runs after the plan exists and its directories are created, before the process starts. */
  readonly beforeLaunch?: (info: { readonly home: string; readonly dir: string; readonly profile: string }) => void | Promise<void>;
  /** Runs after the process is ready; the handle is the L3 escape hatch. */
  readonly afterLaunch?: (handle: InstanceHandle) => void | Promise<void>;
}

export interface ModelPrimitiveState {
  readonly selection: ModelSelection | false;
  readonly patchPath: string;
  readonly configured: boolean;
  readonly observation: ModelConfigObservation | null;
  readonly credential: CredentialPresence | null;
  readonly note: string | null;
}

export interface InstallPrimitiveParams {
  readonly tgz: string;
  readonly method?: InstallMethod;
  readonly candidate?: string | null;
}

export interface EvidencePrimitiveOptions {
  readonly json?: boolean;
  readonly kind?: EvidenceKind;
  readonly note?: string;
}

export interface PrimitiveOptions {
  readonly ports: Ports;
  readonly runtime: { readonly nodeVersion: string; readonly readFileSlice: ReadFileSlice | null };
  readonly runtimePaths: DshRuntimePaths;
  readonly dshHome: string;
  readonly workRoot: string;
  readonly repoRoot: string;
  readonly profileName: ProfileName;
  readonly profile: VerificationProfile;
  readonly profileDir: string;
  readonly evidence: EvidenceStore;
  readonly note?: (message: string) => void;
  readonly binaryWriter?: BinaryWriter;
  readonly adapter?: BrowserProbeFactory | null;
  readonly loadAdapter?: (options: {
    readonly fs: Ports["fs"];
    readonly repoRoot: string;
    readonly declaration: BrowserAdapterDeclaration;
  }) => Promise<Result<BrowserProbeFactory, PageFailure>>;
  readonly headless?: boolean;
  readonly npmCommand?: string;
  readonly importModule?: (specifier: string) => Promise<unknown>;
}

export interface Primitives {
  launch(options?: LaunchPrimitiveOptions): Promise<Result<InstanceHandle, InstanceFailure>>;
  stop(target?: InstanceHandle | string): Promise<Result<readonly KillOutcome[]>>;
  logs(target?: InstanceHandle | string, bytes?: number): Promise<Result<PrimitiveLogSnapshot>>;
  page(target?: InstanceHandle | string): Promise<Result<PageHandle, PageFailure>>;
  model(): Promise<Result<ModelPrimitiveState>>;
  install(params: InstallPrimitiveParams): Promise<Result<InstallOutcome>>;
  skills(): Promise<Result<PrimitiveCheckResult>>;
  check(name: PrimitiveCheckName): Promise<Result<PrimitiveCheckResult>>;
  evidence(name: string, value: string | unknown, options?: EvidencePrimitiveOptions): Promise<Result<EvidenceItem>>;
  expect(observation: ScenarioObservation): ScenarioObservation;
  sleep(ms: number): Promise<void>;
  instances(): readonly InstanceHandle[];
  lastInstance(): InstanceHandle | null;
  dispose(): Promise<Result<readonly KillOutcome[]>>;
}

function pageFailure(kind: "blocked" | "failed", failureValue: Failure): PageFailure {
  return { ...failureValue, kind };
}

function resolveCheckModule(name: PrimitiveCheckName) {
  switch (name) {
    case "package-installed":
      return createPackageInstalledCheck();
    case "skills-set":
      return createSkillsSetCheck();
    case "model-configured":
      return createModelConfiguredCheck();
    case "model-credential":
      return createModelCredentialCheck();
    case "screen-present":
      return createScreenPresentCheck();
  }
}

function pageWrapper(page: BrowserPageHandle): PageHandle {
  return {
    page,
    url: () => page.url(),
    evaluate: (script) => page.evaluate(script),
    innerSize: () => page.innerSize(),
    outerSize: () => page.outerSize(),
    text: (selector) => page.text(selector),
    screenshot: (path, options) => page.screenshot(path, options),
    pageErrors: () => page.pageErrors(),
    close: () => page.close(),
  };
}

export function createPrimitives(options: PrimitiveOptions): Primitives {
  const { ports, profile, profileName, profileDir, dshHome, workRoot, repoRoot } = options;
  const note = options.note ?? (() => undefined);
  const binaryWriter = options.binaryWriter ?? createBinaryWriter();
  const active: InstanceHandle[] = [];
  const pages = new Set<{ readonly session: { close(): Promise<void> }; readonly page: PageHandle }>();
  let pageFactory: BrowserProbeFactory | null | undefined;
  let disposed = false;

  const selfCheckDeclaration: SelfCheckDeclaration = {
    path: "<scenario>",
    kind: "ts" as DeclarationKind,
    exportName: "default",
    requiredNode: ">=22",
  };

  const selfCheckContext = (): SelfCheckContext => ({
    profile,
    profileName,
    ports,
    cwd: repoRoot,
    dshHome,
    profileDir,
    workRoot,
    nodeVersion: options.runtime.nodeVersion,
    readFileSlice: options.runtime.readFileSlice,
    declaration: selfCheckDeclaration,
    screenRequested: true,
    evidence: options.evidence,
    note,
  });

  async function resolveAdapter(): Promise<Result<BrowserProbeFactory, PageFailure>> {
    if (options.adapter !== undefined) {
      return options.adapter === null
        ? err(pageFailure("blocked", failure("prerequisite", "no browser adapter was supplied to this scenario", "inject a BrowserProbeFactory or declare profile.browser")))
        : ok(options.adapter);
    }
    if (ports.browser !== null) return ok(ports.browser);
    if (profile.browser === false) {
      return err(pageFailure("blocked", failure("prerequisite", "profile declares no browser adapter", "set profile.browser or inject one through the scenario runner")));
    }
    const loader = options.loadAdapter;
    if (loader !== undefined) {
      const loaded = await loader({ fs: ports.fs, repoRoot, declaration: profile.browser });
      return loaded;
    }
    const loaded = await loadBrowserAdapter({
      fs: ports.fs,
      repoRoot,
      declaration: profile.browser,
      ...(options.importModule === undefined ? {} : { importModule: options.importModule }),
    });
    if (!loaded.ok) return err(pageFailure(loaded.error.kind, loaded.error));
    return ok(loaded.value.factory);
  }

  async function adapter(): Promise<Result<BrowserProbeFactory, PageFailure>> {
    if (pageFactory !== undefined) {
      return pageFactory === null
        ? err(pageFailure("blocked", failure("prerequisite", "no browser adapter is available", "inject one or declare profile.browser")))
        : ok(pageFactory);
    }
    const resolved = await resolveAdapter();
    pageFactory = resolved.ok ? resolved.value : null;
    return resolved;
  }

  function rawProcess(handle: InstanceHandle): RawProcessHandle {
    return {
      pid: handle.record.pid,
      isAlive: () => ports.process.isAlive(handle.record.pid),
      kill: () => handle.stop(),
    };
  }

  function makeHandle(executed: ExecutedInstance): InstanceHandle {
    let pageSession: { close(): Promise<void> } | null = null;
    let pageHandle: PageHandle | null = null;

    const closePage = async (): Promise<void> => {
      if (pageHandle !== null) {
        try {
          await pageHandle.close();
        } catch {
          // closing a page is best effort; the session close below still runs
        }
        pageHandle = null;
      }
      if (pageSession !== null) {
        for (const entry of [...pages]) {
          if (entry.session === pageSession) pages.delete(entry);
        }
        try {
          await pageSession.close();
        } catch {
          // best effort
        }
        pageSession = null;
      }
    };

    const handle: InstanceHandle = {
      record: executed.record,
      plan: executed.plan,
      pid: executed.record.pid,
      isAlive: () => ports.process.isAlive(executed.record.pid),
      stop: async () => {
        await closePage();
        return stopRecord(ports, executed.record);
      },
      kill: async () => handle.stop(),
      logs: async (bytes = 2000) => {
        const stdout = await tailOf(ports.fs, executed.record.stdoutPath, bytes);
        const stderr = await tailOf(ports.fs, executed.record.stderrPath, bytes);
        const [stdoutExists, stderrExists] = await Promise.all([
          ports.fs.exists(executed.record.stdoutPath),
          ports.fs.exists(executed.record.stderrPath),
        ]);
        return ok({
          stdout,
          stderr,
          stdoutPath: executed.record.stdoutPath,
          stderrPath: executed.record.stderrPath,
          bytes,
          pid: executed.record.pid,
          alive: ports.process.isAlive(executed.record.pid),
          readable: stdoutExists && stderrExists,
        });
      },
      page: async () => {
        if (pageHandle !== null) return ok(pageHandle);
        const factory = await adapter();
        if (!factory.ok) return factory;
        note("launching the browser adapter");
        const session = await factory.value.launch({ headless: options.headless ?? true });
        if (!session.ok) return err(pageFailure("blocked", session.error));
        const created = await session.value.newPage();
        if (!created.ok) {
          await session.value.close().catch(() => undefined);
          return err(pageFailure("blocked", created.error));
        }
        pageSession = session.value;
        pageHandle = pageWrapper(created.value);
        pages.add({ session: session.value, page: pageHandle });
        return ok(pageHandle);
      },
      rawProcess: () => rawProcess(handle),
    };
    return handle;
  }

  async function stopHandle(handle: InstanceHandle): Promise<Result<KillOutcome>> {
    const stopped = await handle.stop();
    const index = active.indexOf(handle);
    if (index >= 0) active.splice(index, 1);
    return stopped;
  }

  async function findTarget(target?: InstanceHandle | string): Promise<Result<InstanceHandle | null>> {
    if (target === undefined) return ok(active.length === 0 ? null : (active[active.length - 1] ?? null));
    if (typeof target !== "string") return ok(target);
    const found = active.find(
      (handle) => handle.record.instanceId === target || handle.record.dir === target || String(handle.pid) === target,
    );
    return found === undefined ? err(failure("not-found", `no active instance matches ${JSON.stringify(target)}`, "launch it first in this scenario")) : ok(found);
  }

  const primitives: Primitives = {
    async launch(launchOptions = {}) {
      if (disposed) return err({ code: "internal", message: "primitives were disposed", stage: "not-ready" });
      const startedAtMs = ports.clock.nowMs();
      const planned = await planInstance({
        ports,
        runtime: options.runtimePaths,
        dshHome,
        profileName,
        profile,
        profileDir,
        workRoot,
        ...(launchOptions.port === undefined ? {} : { port: launchOptions.port }),
        keep: launchOptions.keep ?? false,
        startedAtMs,
      });
      if (!planned.ok) return planned;
      const plan = planned.value;
      // executeInstance owns home creation: copyProfile refuses a pre-existing
      // target home, so a scenario primitive must not create it first.
      if (launchOptions.beforeLaunch !== undefined) {
        try {
          await launchOptions.beforeLaunch({ home: plan.layout.home, dir: plan.layout.dir, profile: profileName });
        } catch (error) {
          return err({
            code: "internal",
            message: `beforeLaunch hook failed: ${error instanceof Error ? error.message : String(error)}`,
            hint: "the hook runs before the process starts; fix it and rerun",
            stage: "prerequisite",
          });
        }
      }
      note(`launching ${profileName}`);
      const executed = await executeInstance({
        ports,
        plan,
        runtime: options.runtimePaths,
        note,
        ...(launchOptions.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: launchOptions.readyTimeoutMs }),
      });
      if (!executed.ok) return executed;
      const handle = makeHandle(executed.value);
      active.push(handle);
      if (launchOptions.afterLaunch !== undefined) {
        try {
          await launchOptions.afterLaunch(handle);
        } catch (error) {
          await stopHandle(handle);
          return err({
            code: "internal",
            message: `afterLaunch hook failed: ${error instanceof Error ? error.message : String(error)}`,
            hint: "the instance was stopped after the hook threw; fix the hook and rerun",
            stage: "not-ready",
          });
        }
      }
      return ok(handle);
    },

    async stop(target) {
      if (target === undefined) {
        const outcomes: KillOutcome[] = [];
        for (const handle of [...active]) {
          const stopped = await stopHandle(handle);
          if (!stopped.ok) return stopped;
          outcomes.push(stopped.value);
        }
        return ok(outcomes);
      }
      const found = await findTarget(target);
      if (!found.ok) return found;
      if (found.value === null) return ok([]);
      const stopped = await stopHandle(found.value);
      return stopped.ok ? ok([stopped.value]) : stopped;
    },

    async logs(target, bytes = 2000) {
      const found = await findTarget(target);
      if (!found.ok) return found;
      if (found.value === null) return err(failure("not-found", "there is no active instance whose logs can be read", "launch an instance first"));
      return found.value.logs(bytes);
    },

    async page(target) {
      const found = await findTarget(target);
      if (!found.ok) return err(pageFailure("failed", found.error));
      if (found.value === null) return err(pageFailure("blocked", failure("prerequisite", "no active instance to open a page on", "launch an instance first")));
      return found.value.page();
    },

    async model() {
      if (profile.model === false) {
        return ok({ selection: false, patchPath: "", configured: false, observation: null, credential: null, note: "profile declares model: false" });
      }
      const observation = await readModelConfig(ports.fs, profileDir, profile.model);
      if (!observation.ok) return observation;
      const credential = await observeCredentialPresence(ports.fs, ports.env, dshHome, profile.model.apiKeyEnv);
      return ok({
        selection: profile.model,
        patchPath: observation.value.patchPath,
        configured: observation.value.state.configured,
        observation: observation.value,
        credential,
        note: observation.value.state.configured ? null : "the patch layer does not configure the declared model",
      });
    },

    async install(params) {
      return installPackage({
        ports,
        binaryWriter,
        tgzPath: params.tgz,
        method: params.method ?? "extract",
        dshHome,
        profileName,
        profileDir,
        packageName: profile.packageName,
        clientEntry: profile.clientEntry,
        candidatePath: params.candidate ?? null,
        note,
        ...(options.npmCommand === undefined ? {} : { npmCommand: options.npmCommand }),
      });
    },

    async skills() {
      return primitives.check("skills-set");
    },

    async check(name) {
      if (!(PRIMITIVE_CHECK_IDS as readonly string[]).includes(name)) {
        return err(failure("invalid-input", `unknown built-in check ${JSON.stringify(name)}`, `use one of: ${PRIMITIVE_CHECK_IDS.join(", ")}`));
      }
      const module = resolveCheckModule(name);
      try {
        const outcome = await module.run(selfCheckContext());
        return ok({ id: name, title: module.title, outcome });
      } catch (error) {
        const failed = {
          status: "fail" as const,
          detail: `check ${name} threw: ${error instanceof Error ? error.message : String(error)}`,
          expected: "the check returns an observation",
          actual: error instanceof Error ? error.message : String(error),
          hint: "this is a bug in the check; report it with the scenario file",
        };
        return ok({ id: name, title: module.title, outcome: failed });
      }
    },

    async evidence(name, value, evidenceOptions = {}) {
      if (evidenceOptions.json === true || typeof value !== "string") {
        return options.evidence.recordJson(name, value, {
          ...(evidenceOptions.kind === undefined ? {} : { kind: evidenceOptions.kind }),
          ...(evidenceOptions.note === undefined ? {} : { note: evidenceOptions.note }),
        });
      }
      return options.evidence.recordText(name, value, {
        ...(evidenceOptions.kind === undefined ? {} : { kind: evidenceOptions.kind }),
        ...(evidenceOptions.note === undefined ? {} : { note: evidenceOptions.note }),
      });
    },

    expect(observation) {
      return { ...observation, source: observation.source ?? "custom" };
    },

    async sleep(ms) {
      await ports.clock.sleep(ms);
    },

    instances() {
      return [...active];
    },

    lastInstance() {
      return active.length === 0 ? null : (active[active.length - 1] ?? null);
    },

    async dispose() {
      if (disposed) return ok([]);
      disposed = true;
      const outcomes: KillOutcome[] = [];
      for (const handle of [...active]) {
        const stopped = await stopHandle(handle);
        if (!stopped.ok) {
          for (const page of [...pages]) {
            await page.session.close().catch(() => undefined);
            pages.delete(page);
          }
          return stopped;
        }
        outcomes.push(stopped.value);
      }
      for (const page of [...pages]) {
        await page.session.close().catch(() => undefined);
        pages.delete(page);
      }
      return ok(outcomes);
    },
  };

  return primitives;
}

/** Turn a primitive check outcome into a scenario observation without losing its id. */
export function checkObservation(
  result: PrimitiveCheckResult,
  options: { readonly source?: "builtin" | "custom"; readonly hard?: boolean; readonly title?: string } = {},
): ScenarioObservation {
  const outcome = result.outcome;
  const status: CheckStatus = outcome.status;
  return {
    checkId: result.id,
    title: options.title ?? result.title,
    ok: status === "pass" || status === "skip",
    status,
    detail: outcome.detail,
    ...(outcome.expected === undefined ? {} : { expected: outcome.expected }),
    ...(outcome.actual === undefined ? {} : { actual: outcome.actual }),
    ...(outcome.hint === undefined ? {} : { hint: outcome.hint }),
    ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence.map((item) => item.path) }),
    source: options.source ?? "builtin",
    hard: options.hard ?? true,
  };
}

/** Convert a scenario observation to a report check; shared by the runner and CLI. */
export function observationToCheck(
  observation: ScenarioObservation,
  fallback: { readonly id: string; readonly title: string; readonly source: "builtin" | "custom" },
  index: number,
  evidenceRefs: (paths: readonly string[]) => CheckResult["evidence"],
): CheckResult {
  const status: CheckStatus = observation.status ?? (observation.ok ? "pass" : "fail");
  const effectiveStatus: CheckStatus = status === "pass" && !observation.ok ? "fail" : status;
  const requestedId = observation.checkId ?? (index === 0 ? fallback.id : `${fallback.id}-${index + 1}`);
  const parsed = parseCheckId(requestedId);
  const id = parsed.ok ? parsed.value : checkId(fallback.id);
  const normalized = normalizeOutcome({
    status: effectiveStatus,
    detail: observation.detail,
    ...(observation.expected === undefined ? {} : { expected: observation.expected }),
    ...(observation.actual === undefined ? {} : { actual: observation.actual }),
    ...(observation.hint === undefined ? {} : { hint: observation.hint }),
    ...(observation.evidence === undefined ? {} : { evidence: evidenceRefs(observation.evidence) }),
  });
  return {
    id,
    title: observation.title ?? fallback.title,
    hard: observation.hard ?? true,
    status: normalized.status,
    detail: normalized.detail,
    ...(normalized.expected === undefined ? {} : { expected: normalized.expected }),
    ...(normalized.actual === undefined ? {} : { actual: normalized.actual }),
    ...(normalized.hint === undefined ? {} : { hint: normalized.hint }),
    evidence: normalized.evidence ?? [],
    durationMs: 0,
    source: observation.source ?? fallback.source,
  };
}

export type CheckResultEvidence = CheckResult["evidence"];
