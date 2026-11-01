/**
 * `instances-distinct` — the "N instances could not have interfered" claim.
 *
 * This is the hard check of the `concurrent` command. It compares the four facts
 * that decide whether two instances write to the same place or answer on the same
 * endpoint: the port, `DSH_HOME`, the start directory (which holds the plugin
 * cache and logs) and the plugin log directory. Any collision is a failure that
 * names both instances and the shared value, because "they were not distinct" is
 * not actionable without the field.
 *
 * Two honest exceptions:
 * - an instance that did not reach readiness is already a failure — the check
 *   reports that first instead of comparing fields of a process that never ran;
 * - a profile that does not declare `pluginCacheDir` has no plugin log directory.
 *   That field is reported as not compared rather than counted equal, so a
 *   declaration that cannot express the fact does not produce a false red.
 */
import type { ConcurrentContext, ConcurrentRow } from "../concurrent";
import { blocked, checkId, failed, passed, type CheckModule, type CheckOutcome } from "../types";

interface IsolationField {
  readonly label: string;
  readonly read: (row: ConcurrentRow) => string | null;
}

/** The comparison dimensions, in the order the pass detail names them. */
const ISOLATION_FIELDS: readonly IsolationField[] = [
  { label: "port", read: (row) => (row.port === null ? null : String(row.port)) },
  { label: "DSH_HOME", read: (row) => row.home },
  { label: "start directory", read: (row) => row.workdir },
  { label: "plugin log directory", read: (row) => row.pluginLogDir },
];

/** Every pair of instances that share one field, rendered for the `actual` line. */
function collisionsOf(rows: readonly ConcurrentRow[]): readonly string[] {
  const collisions: string[] = [];
  for (const field of ISOLATION_FIELDS) {
    const firstIndex = new Map<string, number>();
    for (const row of rows) {
      const value = field.read(row);
      if (value === null) continue;
      const first = firstIndex.get(value);
      if (first === undefined) {
        firstIndex.set(value, row.index);
        continue;
      }
      collisions.push(`${field.label}: instances #${first} and #${row.index} share ${value}`);
    }
  }
  return collisions;
}

/** Build the check module; the plan decides when it runs. */
export function createInstancesDistinctCheck(): CheckModule<ConcurrentContext> {
  return {
    id: checkId("instances-distinct"),
    title: "instances are isolated on port, DSH_HOME, start directory and plugin log directory",
    hard: true,
    requires: [],
    onMissing: "skip",
    run(context: ConcurrentContext): CheckOutcome {
      const refs = context.evidenceRefs ?? [];
      if (context.failure !== null) {
        return blocked(
          `could not plan the isolated instances: ${context.failure.message}`,
          context.failure.hint ?? "fix the prerequisite named above, then rerun dsh-verify concurrent",
          refs,
        );
      }
      const rows = context.rows;
      if (rows.length === 0) {
        return blocked(
          "no instance rows were recorded",
          "this is a defect in the concurrent planner; keep the report and open a ticket",
          refs,
        );
      }

      const notReady = rows.filter((row) => row.readiness !== "ready");
      if (notReady.length > 0) {
        const shown = notReady
          .slice(0, 3)
          .map(
            (row) =>
              `instance ${row.index} (profile ${row.profile}, id ${row.instanceId}) ` +
              `${row.failure === null ? "did not reach readiness" : row.failure.message}`,
          )
          .join("; ");
        const more = notReady.length > 3 ? `; +${notReady.length - 3} more` : "";
        return failed(
          `only ${rows.length - notReady.length} of ${rows.length} instance(s) reached readiness`,
          `all ${rows.length} requested instances start and become ready`,
          `${shown}${more}`,
          `read the instance stderr log: ${notReady[0].dir}/instance.stderr.log, fix the failure and rerun`,
          refs,
        );
      }

      const collisions = collisionsOf(rows);
      if (collisions.length > 0) {
        return failed(
          `${collisions.length} isolation field(s) collide across instances`,
          `port, DSH_HOME, start directory and plugin log directory are pairwise distinct across ${rows.length} instances`,
          collisions.slice(0, 3).join("; "),
          `each instance gets a fresh home, a fresh working directory and an ephemeral port; inspect ${rows[0].dir}/plan.json and the launch argv`,
          refs,
        );
      }

      const ports = rows.map((row) => (row.port === null ? "(none)" : String(row.port))).join(", ");
      const pluginLogUndeclared = rows.every((row) => row.pluginLogDir === null);
      const suffix = pluginLogUndeclared
        ? "; plugin log directory is not declared (profile.pluginCacheDir missing), so that field was not compared"
        : "";
      return passed(
        `${rows.length} instance(s) are pairwise distinct on port (${ports}), DSH_HOME, start directory and plugin log directory${suffix}`,
        refs,
      );
    },
  };
}
