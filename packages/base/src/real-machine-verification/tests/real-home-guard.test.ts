/**
 * The real DSH home is a read-only target for every command.
 *
 * `install` and `model --fix` have their own refusal for the real profile; this
 * suite covers the other write paths (a work root, a freeze output directory, an
 * archive root) so a typo cannot quietly point a run at `~/.dsh`. A dry run
 * writes nothing, so it is allowed to plan and warn instead of refusing.
 */
import { describe, expect, it } from "vitest";

import { main } from "../cli/main";
import { captureIo } from "./support/fake-capture";
import { createFixture } from "./support/fake-machine";

/** Inside the Fixture's real home: `resolveRealHome` reads `USERPROFILE\\.dsh`. */
const REAL_HOME_WORK_ROOT = "C:\\Users\\fixture\\.dsh\\verify-work";
const REAL_HOME_FREEZE_OUT = "C:\\Users\\fixture\\.dsh\\freeze";

async function run(argv: readonly string[]) {
  const fixture = createFixture();
  const capture = captureIo();
  const code = await main(argv, { ports: fixture.ports, io: capture.io, runtime: fixture.runtime });
  return { code, stdout: capture.stdout(), stderr: capture.stderr(), fixture };
}

describe("real DSH home write guard", () => {
  it("refuses a --work-root inside the real home before the command runs", async () => {
    const result = await run(["self-check", "--work-root", REAL_HOME_WORK_ROOT, "--json"]);

    expect(result.code).toBe(2);
    const document = JSON.parse(result.stdout) as { ok: boolean; error: { stage: string; message: string; hint: string } };
    expect(document.ok).toBe(false);
    expect(document.error.stage).toBe("prerequisite");
    expect(document.error.message).toContain("refusing to write under the real DSH home");
    expect(document.error.message).toContain(REAL_HOME_WORK_ROOT);
    expect(document.error.hint).toContain("--work-root");
    // Nothing was created: the refusal happens before the command builds a plan.
    expect(result.fixture.fs.writes).toHaveLength(0);
  });

  it("refuses a freeze --out inside the real home", async () => {
    const result = await run(["freeze", "--out", REAL_HOME_FREEZE_OUT, "--json"]);

    expect(result.code).toBe(2);
    const document = JSON.parse(result.stdout) as { error: { message: string; hint: string } };
    expect(document.error.message).toContain(REAL_HOME_FREEZE_OUT);
    expect(document.error.message).toContain("--out");
    expect(document.error.hint).toContain("--out");
  });

  it("only warns for a dry run, which writes nothing", async () => {
    const result = await run(["cleanup", "--work-root", REAL_HOME_WORK_ROOT, "--dry-run", "--json"]);

    expect(result.stderr).toContain("warning: refusing to write under the real DSH home");
    expect(result.code).toBe(0);
  });
});
