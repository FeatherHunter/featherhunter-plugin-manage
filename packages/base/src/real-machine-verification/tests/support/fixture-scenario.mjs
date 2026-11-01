/**
 * A plugin-repository scenario in the shape the public runner accepts.
 *
 * It intentionally has no imports: this fixture is loaded by the real dynamic
 * import path in tests, so it must be valid plain ESM in the test process. A
 * plugin's own scenario imports `defineScenario` from the capability's public
 * entry; the loader accepts both that export and this plain definition shape.
 */
export default {
  id: "fixture-plugin-smoke",
  title: "a plugin repository scenario runs through the public runner",
  steps: [
    {
      id: "launch-host",
      title: "the isolated host starts",
      kind: "launch",
    },
    {
      id: "plugin-custom",
      title: "the plugin checks its own invariant",
      kind: "custom",
      run: () => [
        {
          checkId: "plugin-custom",
          title: "the plugin's own check",
          ok: true,
          detail: "the plugin's scenario body ran",
          source: "custom",
        },
      ],
    },
    {
      id: "stop-host",
      title: "the isolated host stops",
      kind: "stop",
    },
  ],
};
