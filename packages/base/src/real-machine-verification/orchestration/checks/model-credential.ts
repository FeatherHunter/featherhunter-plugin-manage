/**
 * model-credential - the declared credential reference resolves somewhere.
 *
 * The declaration names a credential by *reference* (apiKeyEnv), never by value.
 * The host resolves that name from three places, in order: a batch home (not
 * applicable here: self-check launches no instance), the real home's credential
 * store (<DSH_HOME>/.credentials.yaml, its refs block), and the process
 * environment. This check reports which source answered - and nothing else.
 * It never reads, copies or prints the value: reporting a secret would be worse
 * than reporting nothing, because the report is archived as evidence.
 */
import { credentialStorePath, probeCredentialStore } from "../../runtime/dsh/credentials";
import type { SelfCheckContext } from "../self-check";
import { blocked, checkId, passed, skipped } from "../types";
import type { CheckModule } from "../types";
import { recordEvidence } from "./shared";

/** One place the credential reference could resolve from. */
interface CredentialSource {
  readonly source: string;
  readonly path?: string;
  readonly available: boolean;
  readonly refPresent?: boolean;
  readonly reason?: string;
}

/** Compose the credential-resolution check. */
export function createModelCredentialCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("model-credential"),
    title: "the declared credential reference resolves without reading its value",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const selection = context.profile.model;
      if (selection === false) {
        return skipped(
          "the profile declares no model",
          "set model: { provider, model, apiKeyEnv } in verify/profile.ts to verify its credential reference",
        );
      }
      const ref = selection.apiKeyEnv;
      const storePath = credentialStorePath(context.dshHome);
      const store = await probeCredentialStore(context.ports.fs, storePath, ref);
      const envValue = context.ports.env.get(ref);
      const envPresent = envValue !== undefined && envValue.length > 0;

      const sources: CredentialSource[] = [
        {
          source: "batch-home",
          available: false,
          reason: "not applicable: self-check launches no instance, so there is no batch home",
        },
        {
          source: "real-home-store",
          path: storePath,
          available: store.refPresent,
          refPresent: store.refPresent,
          ...(store.readable && store.refPresent ? {} : {
            reason: store.readable
              ? "the refs block does not list " + ref + (store.note === null ? "" : " (" + store.note + ")")
              : "no readable credential store at this path: " + (store.note ?? "unknown error"),
          }),
        },
        {
          source: "process-env",
          available: envPresent,
          ...(envPresent ? {} : { reason: "environment variable " + ref + " is not set" }),
        },
      ];
      const resolved = sources.find((source) => source.available);
      const evidence = await recordEvidence(
        context.evidence,
        "model-credential",
        { apiKeyEnv: ref, sources, valueRead: false },
        "which credential stores list the declared reference name (names only, never values)",
        context.note,
      );

      if (resolved !== undefined) {
        const where = resolved.path === undefined ? resolved.source : resolved.source + " (" + resolved.path + ")";
        return passed(
          "credential ref " + ref + " resolves via " + where + "; the value was not read",
          evidence,
        );
      }
      return blocked(
        "credential ref " + ref + " was not found in the batch home, the real-home store (" +
          storePath + ") or the process environment",
        "set " + ref + " in the environment that runs self-check, or add a credential named " + ref +
          " in DSH settings (it lands under refs in " + storePath + "), then rerun",
        evidence,
      );
    },
  };
}
