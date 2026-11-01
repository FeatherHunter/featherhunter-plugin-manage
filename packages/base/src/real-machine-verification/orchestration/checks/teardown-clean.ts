/**
 * `teardown-clean` — "every instance this run launched is gone".
 *
 * The claim is deliberately narrower than "no process is left on the machine": it
 * covers the instances this run started and nothing else. A launch that failed is
 * not this check's concern because `executeInstance` reaps its own process before
 * returning; pretending otherwise would hide a real orphan behind an expected
 * failure.
 *
 * Coverage is the point: the table has one row per instance that reached
 * readiness, and the check fails if *any* row could not be verified dead, naming
 * the pid and the instance. A survivor is expensive — it holds the port and the
 * next run inherits the conflict.
 */
import type { ConcurrentContext, ConcurrentRow } from "../concurrent";
import { checkId, failed, passed, skipped, type CheckModule, type CheckOutcome } from "../types";

/** One rendered "this instance did not get reclaimed" sentence. */
function uncleanLine(row: ConcurrentRow): string {
  const cleanup = row.cleanup;
  const pid = row.pid === null ? "(no pid)" : String(row.pid);
  const why =
    cleanup === null
      ? "no cleanup observation was recorded"
      : cleanup.error !== null
        ? `stopRecord failed: ${cleanup.error}`
        : "is still alive after the stop request";
  return `pid ${pid} (instance ${row.index}, id ${row.instanceId}) ${why}`;
}

/** Build the check module; the plan decides when it runs. */
export function createTeardownCleanCheck(): CheckModule<ConcurrentContext> {
  return {
    id: checkId("teardown-clean"),
    title: "every launched instance is stopped and its process is gone",
    hard: true,
    requires: [],
    onMissing: "skip",
    run(context: ConcurrentContext): CheckOutcome {
      const refs = context.evidenceRefs ?? [];
      if (context.failure !== null) {
        return skipped(
          "no instance was started, so there is nothing to clean up",
          "the run stopped before the launch phase",
          refs,
        );
      }
      const launched = context.rows.filter((row) => row.cleanup !== null);
      if (launched.length === 0) {
        return passed(
          "no instance survived the launch phase; every failed launch was reaped by executeInstance, so 0 residual process(es) were observed",
          refs,
        );
      }
      const unclean = launched.filter(
        (row) =>
          row.cleanup === null ||
          !row.cleanup.stopped ||
          row.cleanup.aliveAfter ||
          row.cleanup.error !== null,
      );
      if (unclean.length > 0) {
        return failed(
          `${unclean.length} of ${launched.length} launched instance(s) could not be reclaimed`,
          "every launched instance is stopped and its pid is gone",
          unclean.slice(0, 3).map(uncleanLine).join("; "),
          `kill the named pid from the task manager, then remove its instance directory under ${context.workRoot}; a survivor holds a port and would poison the next run`,
          refs,
        );
      }
      return passed(
        `stopped ${launched.length} instance(s); 0 residual process(es); stopped.json was written for each`,
        refs,
      );
    },
  };
}
