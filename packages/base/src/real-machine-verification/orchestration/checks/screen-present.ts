/**
 * `screen-present` — a display exists, when the run asks for one.
 *
 * Only planned when `--screen` is given, so a headless CI self-check never sees
 * this check at all. When it is planned, a probe failure is `blocked`: screen
 * probing is best-effort by design (Windows goes through PowerShell, other
 * platforms through system_profiler/xrandr) and "could not enumerate displays"
 * says nothing about the plugin.
 */
import type { SelfCheckContext } from "../self-check";
import type { CheckModule } from "../types";
import { blocked, checkId, passed } from "../types";
import { recordEvidence } from "./shared";

export function createScreenPresentCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("screen-present"),
    title: "the machine exposes at least one display",
    hard: false,
    requires: ["screen"],
    onMissing: "blocked",
    missingHint:
      "inject a ScreenPort (runtime/platform/screen.ts creates the Node one) so this check can enumerate displays",
    async run(context) {
      const screens = await context.ports.screen.screens();
      if (!screens.ok) {
        const evidence = await recordEvidence(
          context.evidence,
          "screen-present",
          { probed: true, ok: false, message: screens.error.message },
          "the screen probe failed",
          context.note,
        );
        return blocked(
          `the screen probe could not report displays: ${screens.error.message}`,
          screens.error.hint ??
            "provide a working ScreenPort (runtime/platform/screen.ts creates the Node one) or omit --screen to skip it",
          evidence,
          {
            code: "prerequisite-missing",
            message: "the screen probe failed",
            hint: screens.error.hint ?? "provide a working ScreenPort, or omit --screen",
          },
        );
      }
      const list = screens.value;
      if (list.length === 0) {
        const evidence = await recordEvidence(
          context.evidence,
          "screen-present",
          { probed: true, ok: true, screens: [] },
          "the screen probe reported no displays",
          context.note,
        );
        return blocked(
          "the screen probe reported no displays (headless session?)",
          "run on a machine with a display, or omit --screen",
          evidence,
          {
            code: "platform-unsupported",
            message: "the host exposes no display",
            hint: "run on a machine with a display, or omit --screen",
          },
        );
      }
      const primary = list.find((screen) => screen.primary) ?? list[0];
      const evidence = await recordEvidence(
        context.evidence,
        "screen-present",
        {
          probed: true,
          ok: true,
          screens: list.map((screen) => ({ id: screen.id, primary: screen.primary, width: screen.width, height: screen.height })),
        },
        "the displays the probe reported",
        context.note,
      );
      return passed(
        list.length === 1
          ? `one display: ${primary.width}x${primary.height}`
          : `${list.length} displays; primary ${primary.width}x${primary.height}`,
        evidence,
      );
    },
  };
}
