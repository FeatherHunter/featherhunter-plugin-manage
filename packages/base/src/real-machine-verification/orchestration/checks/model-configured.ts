/**
 * model-configured - the profile's patch layer declares the selected model.
 *
 * The declaration says which provider, model id and credential reference the
 * run is about. The host reads that wiring from the profile's patch layer
 * (cordis.patch.yml), where agent-default-model names the default and
 * llm-pi-ai declares the provider (its apiKeyEnv reference and its models
 * list). This check compares those literals, because the host treats a near-miss
 * model id or a different credential reference as a different model - it fails
 * at request time, not at boot.
 *
 * Two absences are not mismatches: a patch layer without the entries at all
 * means the wiring may come from the bundle layer, which a read-only check
 * cannot see. That is blocked, with a hint that separates "this profile is not
 * a pi-ai profile" from "add the entry". A mismatch is a fail, and both literal
 * values are named.
 */
import { inspectModelConfig } from "../../contracts/profile-rules";
import { joinFsPath } from "../../runtime/paths";
import type { SelfCheckContext } from "../self-check";
import { blocked, checkId, failed, passed, skipped } from "../types";
import type { CheckModule } from "../types";
import { recordEvidence } from "./shared";

/** Problems that mean "the entry is not in the patch layer", not "the value is wrong". */
const ABSENCE_CODES: ReadonlySet<string> = new Set(["missing-default-model-entry", "missing-provider-entry"]);

/** Compose the model-configuration check. */
export function createModelConfiguredCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("model-configured"),
    title: "the profile's patch layer declares the selected provider, model and credential reference",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const selection = context.profile.model;
      if (selection === false) {
        return skipped(
          "the profile declares no model",
          "set model: { provider, model, apiKeyEnv } in verify/profile.ts to verify the profile's model configuration",
        );
      }
      const patchPath = joinFsPath(context.profileDir, "cordis.patch.yml");
      const patch = await context.ports.fs.readText(patchPath);
      if (!patch.ok) {
        const evidence = await recordEvidence(
          context.evidence,
          "model-config",
          {
            profileName: context.profileName,
            patchPath,
            readable: false,
            error: patch.error.message,
            provider: selection.provider,
            model: selection.model,
            apiKeyEnv: selection.apiKeyEnv,
            problemCodes: [],
          },
          "the profile patch layer could not be read",
          context.note,
        );
        return blocked(
          "the profile patch layer " + patchPath + " is missing or unreadable: " + patch.error.message,
          "open this profile once (or launch DSH with --profile <name>) so its patch layer is written, then rerun; this check is read-only and never invents a patch entry",
          evidence,
        );
      }

      const state = inspectModelConfig(patch.value, selection);
      const mismatch = state.problems.filter((problem) => !ABSENCE_CODES.has(problem.code));
      const absence = state.problems.filter((problem) => ABSENCE_CODES.has(problem.code));
      const evidence = await recordEvidence(
        context.evidence,
        "model-config",
        {
          profileName: context.profileName,
          patchPath,
          provider: selection.provider,
          model: selection.model,
          apiKeyEnv: selection.apiKeyEnv,
          defaultProvider: state.defaultProvider,
          defaultModel: state.defaultModel,
          declaredModels: [...state.declaredModels],
          problemCodes: state.problems.map((problem) => problem.code),
        },
        "the model facts read from the profile patch layer (no patch text recorded)",
        context.note,
      );

      if (mismatch.length > 0) {
        return failed(
          "the profile patch layer disagrees with the declaration: " +
            mismatch.map((problem) => problem.message).join("; "),
          "provider=" + selection.provider + " model=" + selection.model + " apiKeyEnv=" + selection.apiKeyEnv,
          "provider=" + (state.defaultProvider ?? "(none)") +
            " model=" + (state.defaultModel ?? "(none)") +
            " apiKeyEnv=" + (state.apiKeyEnv ?? "(none)") +
            " models=[" + state.declaredModels.join(", ") + "]",
          "run dsh-verify model --fix (ticket 10) or edit the patch entry by hand; model ids and credential references are compared verbatim",
          evidence,
        );
      }

      if (absence.length > 0) {
        return blocked(
          "the profile patch layer has no " + absence.map((problem) => problem.code).join(" / ") +
            " entry, so the declared model cannot be confirmed: " +
            absence.map((problem) => problem.message).join("; ") +
            "; only the patch layer is readable, so whether the bundle layer supplies a provider cannot be judged",
          "if this profile should not use the declared pi-ai provider, set model: false in verify/profile.ts; otherwise add the entry to the patch layer (model --fix only edits existing entries, it does not create them)",
          evidence,
        );
      }

      return passed(
        "profile " + JSON.stringify(context.profileName) + " declares provider " + selection.provider +
          ", model " + selection.model + " and apiKeyEnv " + selection.apiKeyEnv + " verbatim in " + patchPath +
          "; the provider's models list contains " + selection.model,
        evidence,
      );
    },
  };
}
