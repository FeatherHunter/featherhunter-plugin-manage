/**
 * `profile-declaration` — the declaration exists, loaded, and validated.
 *
 * The heavy lifting (discovery, import, normalization) happens before planning,
 * because the profile is the input to the plan. This check records the fact in
 * the report and evidence, so a green self-check states *which* declaration it
 * trusted instead of leaving the reader to infer it.
 */
import type { SelfCheckContext } from "../self-check";
import type { CheckModule } from "../types";
import { checkId, passed } from "../types";
import { recordEvidence } from "./shared";

export function createProfileDeclarationCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("profile-declaration"),
    title: "the plugin declares and loads its verification profile",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const { declaration, profile } = context;
      const evidence = await recordEvidence(
        context.evidence,
        "profile-declaration",
        {
          path: declaration.path,
          kind: declaration.kind,
          exportName: declaration.exportName,
          requiredNode: declaration.requiredNode,
          profile: {
            id: profile.id,
            packageName: profile.packageName,
            defaultProfile: profile.defaultProfile,
            clientEntry: profile.clientEntry,
          },
        },
        "the declaration this run trusted",
        context.note,
      );
      return passed(
        `loaded ${declaration.kind} declaration ${declaration.path} (export ${declaration.exportName})`,
        evidence,
      );
    },
  };
}
