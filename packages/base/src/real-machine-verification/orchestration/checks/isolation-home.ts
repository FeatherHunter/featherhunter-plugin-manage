/**
 * `isolation-home` — a real child process resolves its home inside the
 * redirected directory.
 *
 * This is the counter-example guard for the whole isolation claim: an
 * environment variable being set on the parent proves nothing, while a child
 * that reports a home outside the probe root proves the redirect did not reach
 * it. The check is hard because a wrong home is a plugin-settings hazard, not a
 * best-effort observation.
 */
import { formatFailure, type Result } from "../../contracts/result";
import type { EvidenceStore } from "../../evidence/store";
import type { IsolationProblem, IsolationProblemCode, SettingsIsolationResult } from "../../runtime/dsh/isolation";
import type { CheckModule, CheckOutcome } from "../types";
import { blocked, checkId, failed, passed } from "../types";
import { recordEvidence } from "./shared";

/** The declaration is missing a field the probe cannot invent. */
export const MISSING_SETTINGS_DIR_DETAIL =
  "the verification declaration does not set profile.pluginSettingsDir, so there is no plugin settings directory to prove isolated";
export const MISSING_SETTINGS_DIR_HINT =
  "add pluginSettingsDir (the single directory name under <userprofile>/.dsh/) to verify/profile.ts and rerun; the probe will not claim isolation without it";

/** Everything the two isolation checks need, assembled once by the command. */
export interface IsolationProbeContext {
  readonly probeRoot: string;
  readonly redirectedHome: string;
  readonly workdir: string;
  readonly pluginSettingsDir: string | null;
  readonly evidence: EvidenceStore;
  readonly note: (message: string) => void;
  /** Memoized by the command: both checks observe the same single child run. */
  readonly probe: () => Promise<Result<SettingsIsolationResult>>;
}

const HOME_PROBLEM_CODES: ReadonlySet<IsolationProblemCode> = new Set([
  "probe-exit",
  "probe-output",
  "child-home",
]);

function hintFor(problems: readonly IsolationProblem[], result: SettingsIsolationResult): string {
  if (problems.some((problem) => problem.code === "child-home")) {
    return "the redirect did not reach the child: pass USERPROFILE and HOME in the child environment (the runtime sets them from the probe root) and have the child resolve its home through the platform API";
  }
  if (problems.some((problem) => problem.code === "probe-output")) {
    return "the child must print exactly one JSON line as the last line of stdout; inspect the recorded stderr and rerun the probe command by hand under " + result.probeRoot;
  }
  return "run the probe command by hand under " + result.probeRoot + "; check the node executable path and the allowlisted child environment";
}

export function createIsolationHomeCheck(): CheckModule<IsolationProbeContext> {
  return {
    id: checkId("isolation-home"),
    title: "a child process resolves its home inside the redirected directory",
    hard: true,
    requires: ["command"],
    onMissing: "blocked",
    missingHint:
      "inject a CommandPort (runtime/platform/defaults.ts creates the Node one) so the probe can start a real child process",
    async run(context): Promise<CheckOutcome> {
      if (context.pluginSettingsDir === null) {
        return blocked(MISSING_SETTINGS_DIR_DETAIL, MISSING_SETTINGS_DIR_HINT);
      }
      const probed = await context.probe();
      if (!probed.ok) {
        return blocked(
          `the isolation probe could not run: ${formatFailure(probed.error)}`,
          probed.error.hint ?? "make sure the node executable and the work root are usable, then rerun",
        );
      }
      const result = probed.value;
      const problems = result.problems.filter((problem) => HOME_PROBLEM_CODES.has(problem.code));
      const evidence = await recordEvidence(
        context.evidence,
        "isolation-home",
        {
          probeRoot: result.probeRoot,
          redirectedHome: result.redirectedHome,
          workdir: result.workdir,
          redirectEnv: result.redirectEnv,
          envNames: result.envNames,
          argv: result.argv,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          child: result.child,
          problems: result.problems.map((problem) => ({ code: problem.code, message: problem.message })),
          stdout: result.stdout,
          stderr: result.stderr,
        },
        "the child-process home probe",
        context.note,
      );
      if (problems.length > 0) {
        const actualHome = result.child.home ?? "(not reported)";
        const actualExit = result.exitCode === null ? "(none)" : String(result.exitCode);
        return failed(
          problems.map((problem) => problem.message).join("; "),
          `child home: ${result.redirectedHome}; exit code: 0`,
          `child home: ${actualHome}; exit code: ${actualExit}`,
          hintFor(problems, result),
          evidence,
        );
      }
      return passed(
        `the child resolved its home to ${result.redirectedHome} and wrote its marker under it`,
        evidence,
      );
    },
  };
}
