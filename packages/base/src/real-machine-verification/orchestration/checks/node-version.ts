/**
 * `node-version` — the runtime can actually perform what the declaration needs.
 *
 * The floor is not a constant: a TypeScript declaration needs Node 22.6's native
 * type stripping, while a precompiled JavaScript declaration only needs the
 * package's own engines floor. Hard-coding 22.6 would fail a perfectly valid
 * Node 18 setup that ships a compiled declaration.
 */
import { compareNodeVersions, NODE_MIN_FOR_JAVASCRIPT, NODE_MIN_FOR_TYPESCRIPT } from "../../declaration/loader";
import type { SelfCheckContext } from "../self-check";
import type { CheckModule } from "../types";
import { checkId, failed, passed } from "../types";
import { recordEvidence } from "./shared";

export function createNodeVersionCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("node-version"),
    title: "the running Node satisfies the declaration's floor",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const { nodeVersion, declaration } = context;
      const required = declaration.requiredNode;
      const satisfied = compareNodeVersions(nodeVersion, required) >= 0;
      const evidence = await recordEvidence(
        context.evidence,
        "node-version",
        {
          nodeVersion,
          requiredNode: required,
          declarationKind: declaration.kind,
          satisfied,
          floors: { typescript: NODE_MIN_FOR_TYPESCRIPT, javascript: NODE_MIN_FOR_JAVASCRIPT },
        },
        "the Node version and the floor it was compared with",
        context.note,
      );
      if (satisfied) {
        return passed(
          `Node ${nodeVersion} satisfies the ${required} floor for ${declaration.kind} declarations`,
          evidence,
        );
      }
      return failed(
        `Node ${nodeVersion} is older than the ${required} floor for ${declaration.kind} declarations`,
        `Node ${required} or newer`,
        `Node ${nodeVersion}`,
        declaration.kind === "ts"
          ? `upgrade Node to ${required}+ (native type stripping), or compile the declaration with tsc and pass the .js file via --declaration`
          : `upgrade Node to ${required}+, the base package's engines floor`,
        evidence,
      );
    },
  };
}
