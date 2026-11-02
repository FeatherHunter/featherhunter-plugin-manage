/**
 * `package-installed` — the plugin under test is what the profile actually loads.
 *
 * The claim has four parts, and they are checked in the order that produces the
 * most useful failure:
 *
 * 1. the profile declares the package as a dependency;
 * 2. the installed manifest is readable (the package is really in `node_modules`);
 * 3. the installed version matches the checked-out repository when the working
 *    directory *is* that repository — and when it is not, the report says so
 *    instead of pretending the comparison happened (a green check on a skipped
 *    comparison is exactly the false green this capability exists to prevent);
 * 4. the declared `clientEntry` exists inside the installed package, and its
 *    sha256 is recorded so a later run can tell whether the bytes changed.
 */
import type { SelfCheckContext } from "../self-check";
import type { CheckModule } from "../types";
import { blocked, checkId, failed, passed } from "../types";
import { asRecord, readJsonRecord, recordEvidence, stringField } from "./shared";
import { joinFsPath } from "../../runtime/paths";

/**
 * The command a reader can run to fix an install, without guessing the profile.
 *
 * The wording matters: a plain "run npm install inside <profileDir>" teaches
 * people to write their real user-home profile, which is exactly what the
 * isolation discipline forbids. The isolated copy is the default instruction;
 * writing the profile in place is only offered for a profile that already is a
 * copy.
 */
function installHint(packageName: string, profileDir: string, version?: string): string {
  const spec = version === undefined ? packageName : `${packageName}@${version}`;
  return (
    `copy ${profileDir} into an isolated home, set DSH_HOME to it, run \`npm install ${spec}\` inside the copy, ` +
    "then rerun self-check; writing the real user-home profile is not isolated evidence"
  );
}

export function createPackageInstalledCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("package-installed"),
    title: "the profile loads the package under verification and its client entry",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const { fs } = context.ports;
      const { profile, profileName, profileDir, cwd } = context;
      const packageName = profile.packageName;
      // A missing profile is an environment prerequisite, not a plugin defect:
      // saying "package-installed failed" here would blame the package for a
      // profile that was never there. profile-present already reports the
      // profile state, so this check only repeats the reason as blocked.
      const directory = await fs.stat(profileDir);
      if (!directory.ok || directory.value.kind !== "directory") {
        const actual = directory.ok ? `found a ${directory.value.kind}` : directory.error.message;
        return blocked(
          `profile "${profileName}" has no directory at ${profileDir} (${actual}), so ${packageName} cannot be installed there`,
          `pass --profile with an existing profile under the DSH home (or create the isolated copy first); ` +
            "profile-present reports whether the profile exists",
        );
      }
      const manifestPath = joinFsPath(profileDir, "package.json");
      const profileManifest = await readJsonRecord(fs, manifestPath);
      if (!profileManifest.ok) {
        return failed(
          `could not read the profile manifest: ${manifestPath}`,
          `a readable JSON manifest at ${manifestPath}`,
          profileManifest.error.message,
          "reinstall the profile, or run profile-present to see the profile state",
        );
      }

      const dependencies = asRecord(profileManifest.value["dependencies"]) ?? {};
      const declared = stringField(dependencies, packageName);
      if (declared === null) {
        const evidence = await recordEvidence(
          context.evidence,
          "package-installed",
          { profileName, profileDir, packageName, declared: false, manifestPath },
          "the package is not declared by the profile",
          context.note,
        );
        return failed(
          `profile "${profileName}" does not declare ${packageName} as a dependency`,
          `dependencies["${packageName}"] in ${manifestPath}`,
          "not declared",
          installHint(packageName, profileDir),
          evidence,
        );
      }

      const packageDir = joinFsPath(profileDir, "node_modules", ...packageName.split("/"));
      const installedManifestPath = joinFsPath(packageDir, "package.json");
      const installedManifest = await readJsonRecord(fs, installedManifestPath);
      if (!installedManifest.ok) {
        const evidence = await recordEvidence(
          context.evidence,
          "package-installed",
          {
            profileName,
            profileDir,
            packageName,
            declaredVersion: declared,
            packageDir,
            installedManifestPath,
            installed: false,
          },
          "the declared package is not installed",
          context.note,
        );
        return failed(
          `${packageName} is declared by the profile but not installed at ${packageDir}`,
          `a readable ${installedManifestPath}`,
          installedManifest.error.message,
          installHint(packageName, profileDir),
          evidence,
        );
      }

      const installedVersion = stringField(installedManifest.value, "version");
      if (installedVersion === null) {
        const evidence = await recordEvidence(
          context.evidence,
          "package-installed",
          { packageName, installedManifestPath, installedVersion: null },
          "the installed manifest has no version",
          context.note,
        );
        return failed(
          `the installed ${packageName} has no version in ${installedManifestPath}`,
          "the installed manifest declares a version",
          "no version field",
          installHint(packageName, profileDir),
          evidence,
        );
      }

      const clientEntry = profile.clientEntry;
      const clientEntryPath = joinFsPath(packageDir, clientEntry);
      const clientStats = await fs.stat(clientEntryPath);
      if (!clientStats.ok || clientStats.value.kind !== "file") {
        const actual = clientStats.ok ? `found a ${clientStats.value.kind}` : clientStats.error.message;
        const evidence = await recordEvidence(
          context.evidence,
          "package-installed",
          {
            profileName,
            packageName,
            installedVersion,
            packageDir,
            clientEntry,
            clientEntryPath,
            clientEntryPresent: false,
            actual,
          },
          "the installed package has no client entry",
          context.note,
        );
        return failed(
          `the installed ${packageName} has no client entry ${clientEntry}`,
          `${clientEntryPath} exists as a regular file inside the installed package`,
          actual,
          `rebuild the package (npm run build) and reinstall it: ${installHint(packageName, profileDir)}`,
          evidence,
        );
      }

      const clientHash = await fs.hashFile(clientEntryPath);
      if (!clientHash.ok) {
        return failed(
          `could not hash the installed client entry: ${clientEntryPath}`,
          "a readable client entry file",
          clientHash.error.message,
          "check file permissions, then rerun self-check",
          [],
        );
      }

      // Is the working directory the plugin repository itself? Only then can the
      // installed bytes be compared with the checked-out version.
      const localManifestPath = joinFsPath(cwd, "package.json");
      const localManifest = await fs.readJson(localManifestPath);
      const localRecord = localManifest.ok ? asRecord(localManifest.value) : null;
      const localName = localRecord === null ? null : stringField(localRecord, "name");
      const localVersion = localRecord === null ? null : stringField(localRecord, "version");
      const localMatches = localName === packageName && localVersion !== null;

      const evidence = await recordEvidence(
        context.evidence,
        "package-installed",
        {
          profileName,
          profileDir,
          packageName,
          declaredVersion: declared,
          packageDir,
          installedManifestPath,
          installedVersion,
          clientEntry,
          clientEntryPath,
          clientEntryBytes: clientStats.value.size,
          clientEntrySha256: clientHash.value,
          local: localMatches
            ? { name: localName, version: localVersion, manifestPath: localManifestPath }
            : { name: localName, version: localVersion, manifestPath: localManifestPath, notThePackage: true },
          versionComparison: localMatches ? "compared" : "skipped",
        },
        "the installed package, its version and its client entry hash",
        context.note,
      );

      if (localMatches) {
        if (localVersion !== installedVersion) {
          return failed(
            `the installed ${packageName} is ${installedVersion} but the checked-out repository is ${localVersion}`,
            localVersion,
            installedVersion,
            `the profile is running an older/newer build; reinstall it: ${installHint(packageName, profileDir, localVersion)}`,
            evidence,
          );
        }
        return passed(
          `${packageName} ${installedVersion} is installed in profile ${profileName} and matches the checked-out repository; clientEntry ${clientEntry} sha256 ${clientHash.value}`,
          evidence,
        );
      }

      const basis = localManifestPath === null
        ? "the working directory has no package.json"
        : `the working directory's package.json ${localName === null ? "has no name" : `is ${localName}`}`;
      return passed(
        `${packageName} ${installedVersion} is installed in profile ${profileName}; clientEntry ${clientEntry} sha256 ${clientHash.value}; version comparison skipped because ${basis}, not ${packageName}`,
        evidence,
      );
    },
  };
}
