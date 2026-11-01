/**
 * `logs-readable` — the plugin wrote its own log inside the isolated instance.
 *
 * The instance's HTTP surface proves the host is up; it does not prove the plugin
 * itself executed. The plugin log is the one file the host does not mediate, so a
 * non-empty, parseable log is the strongest signal this tool has that the plugin
 * loaded *and ran*. The claim is deliberately narrow: the log exists, it parses,
 * and it contains at least one event. One torn line is a race, not a failure.
 *
 * A log directory that does not exist yet is `blocked`, not `fail`: the plugin
 * may not have created it, and the machine has not given the run a chance to
 * observe the product. Zero events in an existing log *is* a failure — there was
 * something to observe and it was empty.
 *
 * Evidence is a summary (counts, timestamps, event names), never the raw log: the
 * log can contain operator data, and the summary is enough to re-derive the
 * verdict.
 */
import type { EvidenceItemRef } from "../../contracts/evidence-contract";
import type { Ports } from "../../contracts/ports";
import type { VerificationProfile } from "../../contracts/verification-profile";
import type { EvidenceStore } from "../../evidence/store";
import type { InstanceRecord } from "../../runtime/dsh/launch";
import {
  findLatestPluginLog,
  pluginLogDirectory,
  readPluginLog,
  summarizeLogEvents,
} from "../../runtime/dsh/logs";
import { recordEvidence } from "./shared";
import { blocked, checkId, failed, passed, type CheckModule, type CheckOutcome } from "../types";

/** What `logs-readable` needs; the single-instance command supplies the rest. */
export interface SingleInstanceCheckContext {
  readonly ports: Ports;
  readonly profile: VerificationProfile;
  readonly instance: InstanceRecord;
  readonly evidence: EvidenceStore;
  /** Progress/warning sink; never stdout in JSON mode. */
  readonly note: (message: string) => void;
}

/** Summary of an empty or missing log, recorded as evidence of what was (not) seen. */
function unreadableSummary(
  state: string,
  logDirectory: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { check: "logs-readable", state, logDirectory, ...extra };
}

/** Build the check module; the command decides when it runs. */
export function createLogsReadableCheck(): CheckModule<SingleInstanceCheckContext> {
  return {
    id: checkId("logs-readable"),
    title: "the plugin wrote a non-empty, parseable log inside the isolated instance",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context: SingleInstanceCheckContext): Promise<CheckOutcome> {
      const { ports, profile, instance, evidence, note } = context;
      const { fs } = ports;

      if (profile.pluginCacheDir === undefined || profile.pluginCacheDir.length === 0) {
        const refs = await recordEvidence(
          evidence,
          "logs-readable",
          unreadableSummary("not-declared", null, { profile: profile.id }),
          "the profile declares no plugin cache directory, so there is no log to read",
          note,
        );
        return blocked(
          "the profile does not declare a plugin cache directory, so the plugin log has no known location",
          "declare pluginCacheDir in the profile declaration, then rerun; without it this check cannot observe the plugin",
          refs,
        );
      }

      const logDirectory = pluginLogDirectory(instance.startCwd, profile.pluginCacheDir);
      const stat = await fs.stat(logDirectory);
      if (!stat.ok || stat.value.kind !== "directory") {
        const refs = await recordEvidence(
          evidence,
          "logs-readable",
          unreadableSummary("missing-directory", logDirectory, {
            instanceId: instance.instanceId ?? null,
            statError: stat.ok ? `kind=${stat.value.kind}` : stat.error.message,
          }),
          "the plugin log directory was absent when the check ran",
          note,
        );
        return blocked(
          `the plugin log directory does not exist yet: ${logDirectory}`,
          "the plugin creates this directory when it loads; check instance.stderr.log and the plugin inventory, then rerun",
          refs,
        );
      }

      const found = await findLatestPluginLog(fs, logDirectory);
      if (!found.ok) {
        const refs = await recordEvidence(
          evidence,
          "logs-readable",
          unreadableSummary("no-log-file", logDirectory, { message: found.error.message }),
          "the log directory existed but held no dated log file",
          note,
        );
        return failed(
          "the plugin log file is missing",
          `a <YYYY-MM-DD>.log file in ${logDirectory}`,
          found.error.message,
          found.error.hint ?? "the plugin writes one JSON object per line into the log directory",
          refs,
        );
      }
      const file = found.value;

      const read = await readPluginLog(fs, file);
      if (!read.ok) {
        const refs = await recordEvidence(
          evidence,
          "logs-readable",
          unreadableSummary("unreadable", logDirectory, { file, message: read.error.message }),
          "the plugin log existed but could not be read",
          note,
        );
        return failed(
          `the plugin log could not be read: ${file}`,
          "the plugin log opens and parses as newline-delimited JSON",
          read.error.message,
          read.error.hint ?? "check the file permissions and that the instance still owns the directory",
          refs,
        );
      }

      const summary = summarizeLogEvents(read.value.events, read.value.badLines);
      // `events` also holds the unparsable lines, so the verdict counts only lines
      // that parsed into a JSON object. A log of pure garbage has zero events.
      const parsedCount = read.value.events.filter((event) => event.json !== null).length;
      const firstBadLine = read.value.events.find((event) => event.json === null)?.line ?? null;
      const observed = {
        check: "logs-readable",
        state: "read",
        file,
        logDirectory,
        bytes: read.value.bytes,
        total: parsedCount,
        lines: read.value.events.length,
        badLines: summary.badLines,
        firstTs: summary.firstTs,
        lastTs: summary.lastTs,
        byEvent: summary.byEvent,
        byLevel: summary.byLevel,
        firstBadLine,
      };

      if (parsedCount === 0) {
        const refs = await recordEvidence(
          evidence,
          "logs-readable",
          observed,
          "the plugin log existed but contained no parsed events",
          note,
        );
        return failed(
          "the plugin log contains zero events",
          "the plugin log contains at least one parsed event",
          `${file}: 0 parsed event(s), ${summary.badLines} unparsable line(s), ${read.value.bytes} byte(s)` +
            (firstBadLine === null ? "" : `; first unparsable line: ${firstBadLine}`),
          "the plugin loaded but never wrote a log event; check instance.stderr.log and whether the plugin's log writer ran",
          refs,
        );
      }

      const refs = await recordEvidence(
        evidence,
        "logs-readable",
        observed,
        "the plugin log summary behind the logs-readable verdict",
        note,
      );
      return passed(
        `plugin log ${file} has ${parsedCount} parsed event(s)` +
          (summary.badLines === 0 ? "" : ` (${summary.badLines} unparsable line(s) tolerated)`) +
          (summary.lastTs === null ? "" : `, last at ${summary.lastTs}`),
        refs,
      );
    },
  };
}
