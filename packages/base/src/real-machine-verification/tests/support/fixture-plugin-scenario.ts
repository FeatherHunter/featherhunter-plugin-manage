/**
 * A plugin-repository scenario written in TypeScript. It imports only the
 * capability's public entry, which is the constraint a real plugin repository
 * has: no core file and no private module is reachable from here.
 */
import { defineScenario } from "../../index";

export default defineScenario({
  id: "fixture-ts-scenario",
  title: "a TypeScript plugin scenario imports only the public entry",
  steps: [
    {
      id: "plugin-ts-check",
      title: "the plugin's TypeScript scenario runs",
      kind: "custom",
      run: () => [
        {
          checkId: "plugin-ts-check",
          ok: true,
          detail: "the public defineScenario entry loaded the TypeScript scenario",
        },
      ],
    },
  ],
});
