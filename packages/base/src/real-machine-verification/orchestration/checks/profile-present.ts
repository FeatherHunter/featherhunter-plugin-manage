/**
 * `profile-present` — the developer's DSH home has the profile to verify.
 *
 * A missing profile is a prerequisite (`blocked`, exit 2), not a product failure:
 * the plugin may be perfect on a machine where the profile was never created.
 * A profile directory that exists but whose manifest is corrupt is a different
 * story — the run can see the file and the file is wrong — so that is a failure.
 *
 * The real DSH home is only read, never written: this check opens a path and
 * reports it, and the evidence contains no file contents beyond the manifest's
 * name and version.
 */
import type { SelfCheckContext } from "../self-check";
import type { CheckModule } from "../types";
import { blocked, checkId, failed, passed } from "../types";
import { readJsonRecord, recordEvidence, stringField } from "./shared";

export function createProfilePresentCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("profile-present"),
    title: "the DSH home contains the profile under verification",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const { fs } = context.ports;
      const { profileName, profileDir, dshHome } = context;
      const directory = await fs.stat(profileDir);
      if (!directory.ok || directory.value.kind !== "directory") {
        const actual = directory.ok ? `found a ${directory.value.kind}` : directory.error.message;
        const evidence = await recordEvidence(
          context.evidence,
          "profile-present",
          { dshHome, profileName, profileDir, present: false, actual },
          "the profile directory was not found",
          context.note,
        );
        return blocked(
          `profile "${profileName}" was not found under ${dshHome}`,
          `open DSH once with the "${profileName}" profile (or pass --profile with an existing one); expected ${profileDir}`,
          evidence,
        );
      }

      const manifestPath = `${profileDir}/package.json`;
      const manifest = await readJsonRecord(fs, manifestPath);
      if (!manifest.ok) {
        const exists = await fs.exists(manifestPath);
        const evidence = await recordEvidence(
          context.evidence,
          "profile-present",
          { dshHome, profileName, profileDir, manifestPath, manifestReadable: false },
          "the profile directory exists but its manifest could not be read",
          context.note,
        );
        if (!exists) {
          return blocked(
            `profile "${profileName}" has no package.json`,
            `open DSH once with this profile so it writes ${manifestPath}, or reinstall the profile`,
            evidence,
          );
        }
        return failed(
          `the profile manifest is not readable JSON: ${manifestPath}`,
          "a readable JSON profile manifest",
          manifest.error.message,
          "repair or reinstall the profile; DSH will not load a corrupt one either",
          evidence,
        );
      }

      const evidence = await recordEvidence(
        context.evidence,
        "profile-present",
        {
          dshHome,
          profileName,
          profileDir,
          manifestPath,
          manifestName: stringField(manifest.value, "name"),
          manifestVersion: stringField(manifest.value, "version"),
        },
        "the profile that will be verified",
        context.note,
      );
      const version = stringField(manifest.value, "version");
      return passed(
        `profile "${profileName}" is present under ${dshHome}${version === null ? "" : ` (manifest ${version})`}`,
        evidence,
      );
    },
  };
}
