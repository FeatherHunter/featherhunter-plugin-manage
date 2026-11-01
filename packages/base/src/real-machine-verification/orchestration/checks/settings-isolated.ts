/**
 * `settings-isolated` — the plugin's real settings file is byte-identical after
 * the probe, and the redirected marker really landed where the child claimed.
 *
 * The real file is only ever observed through existence and sha256: the probe
 * must never read, print or persist the settings content. A file that did not
 * exist before and still does not exist after passes trivially (`existed=false`),
 * which is different from `null === null` pretending two failed reads agree.
 */
import type { IsolationProblem, IsolationProblemCode, SettingsFingerprint, SettingsIsolationResult } from "../../runtime/dsh/isolation";
import type { CheckModule, CheckOutcome } from "../types";
import { blocked, checkId, failed, passed } from "../types";
import type { IsolationProbeContext } from "./isolation-home";
import { MISSING_SETTINGS_DIR_DETAIL, MISSING_SETTINGS_DIR_HINT } from "./isolation-home";
import { recordEvidence } from "./shared";

const SETTINGS_PROBLEM_CODES: ReadonlySet<IsolationProblemCode> = new Set([
  "marker-write",
  "marker-readback",
  "marker-missing",
  "marker-hash",
  "real-settings-changed",
  "real-settings-unreadable",
]);

function describeFingerprint(value: SettingsFingerprint): string {
  if (!value.existed) return "absent";
  return value.sha256 === null ? "existed, unreadable" : `existed sha256 ${value.sha256}`;
}

function hintFor(problems: readonly IsolationProblem[]): string {
  if (problems.some((problem) => problem.code === "real-settings-changed")) {
    return "the real settings file changed while the probe ran; do not launch the plugin again until it is restored, and follow the four-step fallback plan printed with this report";
  }
  return "check that the redirected home is writable and that the child's settings path is <userprofile>/.dsh/<pluginSettingsDir>/settings.yaml; inspect the recorded settings-isolated evidence";
}

function passDetail(result: SettingsIsolationResult): string {
  if (!result.realSettings.existed) {
    return `the real settings file ${result.realSettings.path} did not exist before or after (existed=false); the marker was written and reread under ${result.redirectedHome}`;
  }
  return `the real settings file ${result.realSettings.path} kept sha256 ${result.realSettings.sha256 ?? "(unreadable)"}`;
}

export function createSettingsIsolatedCheck(): CheckModule<IsolationProbeContext> {
  return {
    id: checkId("settings-isolated"),
    title: "the plugin's real settings file stays byte-identical",
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
          `the isolation probe could not run: ${probed.error.message}`,
          probed.error.hint ?? "make sure the node executable and the work root are usable, then rerun",
        );
      }
      const result = probed.value;
      const problems = result.problems.filter((problem) => SETTINGS_PROBLEM_CODES.has(problem.code));
      const evidence = await recordEvidence(
        context.evidence,
        "settings-isolated",
        {
          realSettings: {
            path: result.realSettings.path,
            existedBefore: result.realSettings.existed,
            existedAfter: result.realSettingsAfter.existed,
            sha256Before: result.realSettings.sha256,
            sha256After: result.realSettingsAfter.sha256,
            unchanged: result.realSettingsUnchanged,
          },
          marker: {
            expectedPath: result.expectedMarkerPath,
            reportedPath: result.child.markerPath,
            present: result.markerPresent,
            sha256: result.markerSha256,
            childSha256: result.child.sha256,
            bytes: result.child.bytes,
          },
          child: {
            home: result.child.home,
            wrote: result.child.wrote,
            readBack: result.child.readBack,
          },
          problems: result.problems.map((problem) => ({ code: problem.code, message: problem.message })),
        },
        "the real settings file fingerprint and the redirected marker",
        context.note,
      );

      if (!result.reported) {
        const detail =
          result.problems.length === 0
            ? "the probe child did not print a parsable result"
            : result.problems.map((problem) => problem.message).join("; ");
        return blocked(
          `the probe child did not report its write/read result, so settings isolation could not be observed: ${detail}`,
          "run the probe command by hand and inspect stdout; the isolation-home check in this report explains why the child failed",
          evidence,
        );
      }

      if (problems.length > 0) {
        const onlyUnreadable = problems.every((problem) => problem.code === "real-settings-unreadable");
        if (onlyUnreadable) {
          return blocked(
            problems.map((problem) => problem.message).join("; "),
            "make the real settings file readable (check its permissions and the current user) and rerun; the probe will not claim pass without comparing hashes",
            evidence,
          );
        }
        const expectedReal = result.realSettings.existed
          ? `real settings: ${result.realSettings.path} keeps sha256 ${result.realSettings.sha256 ?? "(unreadable)"}`
          : `real settings: ${result.realSettings.path} stays absent (existed=false)`;
        return failed(
          problems.map((problem) => problem.message).join("; "),
          `marker: ${result.expectedMarkerPath} exists with the child's read-back sha256; ${expectedReal}`,
          `marker present: ${String(result.markerPresent)}; child wrote: ${String(result.child.wrote)}, read back: ${String(result.child.readBack)}; real settings before: ${describeFingerprint(result.realSettings)}; after: ${describeFingerprint(result.realSettingsAfter)}`,
          hintFor(problems),
          evidence,
        );
      }

      return passed(passDetail(result), evidence);
    },
  };
}
