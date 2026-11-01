/**
 * `dsh-runtime` — the machine has a usable DSH desktop install.
 *
 * Two different worlds produce two different statuses:
 *
 * - nothing found → `blocked`: the machine has no DSH, so the run proves nothing
 *   about the plugin. The hint is the install instruction, not a bug report.
 * - an executable found but an incomplete install (no `app.asar`, archive without
 *   the host CLI entry, executable is a directory) → `fail`: something is there
 *   and it is broken, and the report names both sides of the comparison.
 *
 * The "is the CLI entry inside app.asar?" question is answered by reading the
 * archive header through the injected slice reader; the archive's interior paths
 * cannot be stat'ed from plain Node.
 */
import { readAsarEntry } from "../../runtime/dsh/asar";
import { discoverDsh } from "../../runtime/dsh/discover";
import type { SelfCheckContext } from "../self-check";
import type { CheckModule } from "../types";
import { blocked, checkId, failed, passed } from "../types";
import { recordEvidence } from "./shared";

/** Read the discovery stage out of a failure's details without trusting its type. */
function discoveryStage(details: Readonly<Record<string, unknown>> | undefined): string {
  const stage = details?.["stage"];
  return typeof stage === "string" ? stage : "exe-missing";
}

export function createDshRuntimeCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("dsh-runtime"),
    title: "DSH is installed with an executable and its host CLI entry",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const { fs, env } = context.ports;
      const discovery = await discoverDsh({ fs, env });
      if (!discovery.ok) {
        const stage = discoveryStage(discovery.error.details);
        const tried = discovery.error.details?.["tried"];
        const evidence = await recordEvidence(
          context.evidence,
          "dsh-runtime",
          {
            found: false,
            stage,
            platform: env.platform(),
            message: discovery.error.message,
            tried: Array.isArray(tried) ? tried : [],
          },
          "the DSH discovery attempt",
          context.note,
        );
        const hint =
          discovery.error.hint ??
          "install the DSH desktop app, pass --dsh-exe, set DSH_EXE, or put its dsh wrapper on PATH";
        if (stage === "structure-missing") {
          return failed(
            `found a DSH executable but the install is incomplete: ${discovery.error.message}`,
            "a DSH install with both an executable and resources/app.asar containing the host CLI entry",
            discovery.error.message,
            hint,
            evidence,
          );
        }
        return blocked("could not find a DSH desktop install on this machine", hint, evidence);
      }

      const found = discovery.value;
      const exeStats = await fs.stat(found.exe);
      if (!exeStats.ok || exeStats.value.kind !== "file") {
        const actual = exeStats.ok ? `found a ${exeStats.value.kind}` : exeStats.error.message;
        const evidence = await recordEvidence(
          context.evidence,
          "dsh-runtime",
          { found: true, exe: found.exe, source: found.source, exeKind: exeStats.ok ? exeStats.value.kind : null },
          "the DSH executable that discovery reported",
          context.note,
        );
        return failed(
          `the discovered DSH executable is not a regular file: ${found.exe}`,
          "the DSH executable is a regular file",
          actual,
          "reinstall DSH, or pass --dsh-exe/DSH_EXE pointing at the real executable",
          evidence,
        );
      }

      if (found.asarPath !== null) {
        if (context.readFileSlice === null) {
          const evidence = await recordEvidence(
            context.evidence,
            "dsh-runtime",
            { found: true, exe: found.exe, asarPath: found.asarPath, readFileSlice: false },
            "the install was found but its archive could not be inspected",
            context.note,
          );
          return blocked(
            "cannot inspect resources/app.asar: the runtime did not provide a bounded file reader",
            "run this check through the dsh-verify CLI (or inject RuntimeFacts.readFileSlice) so the archive header is readable",
            evidence,
          );
        }
        const entry = await readAsarEntry(context.readFileSlice, found.asarPath, found.cliJs);
        if (!entry.ok) {
          const evidence = await recordEvidence(
            context.evidence,
            "dsh-runtime",
            {
              found: true,
              exe: found.exe,
              asarPath: found.asarPath,
              cliJs: found.cliJs,
              error: entry.error.message,
            },
            "the archive was found but the host CLI entry is not in it",
            context.note,
          );
          return failed(
            `app.asar does not contain the DSH host CLI entry: ${entry.error.message}`,
            `the archive at ${found.asarPath} contains ${found.cliJs}`,
            entry.error.message,
            "reinstall DSH; a desktop install without its host CLI entry cannot run an instance",
            evidence,
          );
        }
        const evidence = await recordEvidence(
          context.evidence,
          "dsh-runtime",
          {
            found: true,
            exe: found.exe,
            asarPath: found.asarPath,
            source: found.source,
            installRoot: found.installRoot,
            cliEntry: {
              path: entry.value.path,
              size: entry.value.size,
              offset: entry.value.offset,
              integritySha256: entry.value.integritySha256,
            },
            tried: found.tried,
          },
          "the DSH install and its archive entry",
          context.note,
        );
        const location = found.installRoot ?? found.exe;
        const named = found.installRoot === null ? location : `${location} (executable ${found.exe})`;
        return passed(
          `found DSH at ${named}; app.asar contains ${entry.value.path} (${entry.value.size} bytes)`,
          evidence,
        );
      }

      const cliStats = await fs.stat(found.cliJs);
      const evidence = await recordEvidence(
        context.evidence,
        "dsh-runtime",
        {
          found: true,
          exe: found.exe,
          asarPath: null,
          cliJs: found.cliJs,
          source: found.source,
          installRoot: found.installRoot,
          cliKind: cliStats.ok ? cliStats.value.kind : null,
        },
        "the unpacked DSH install",
        context.note,
      );
      if (!cliStats.ok || cliStats.value.kind !== "file") {
        const actual = cliStats.ok ? `found a ${cliStats.value.kind}` : cliStats.error.message;
        return failed(
          `the DSH CLI entry is not a regular file: ${found.cliJs}`,
          "the DSH host CLI is a regular file",
          actual,
          "reinstall DSH, or pass --dsh-cli-js pointing at the real cli.js",
          evidence,
        );
      }
      return passed(
        `found DSH at ${found.installRoot ?? found.exe} (unpacked CLI ${found.cliJs})`,
        evidence,
      );
    },
  };
}
