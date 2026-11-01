/**
 * skills-set - the package ships exactly the declared skill set.
 *
 * The declared set lives in the plugin repository (the declaration names the
 * directory and the count). The host registers that set from two places: the
 * directory bundled inside the installed package, and the per-user/per-project
 * root table. A package can "ship 27 skills" and register 26 because one
 * SKILL.md's frontmatter name disagrees with its directory; the host then
 * drops it without an error. So this check compares name *sets*, never counts
 * from a model-facing surface, and it fails only when it can name the skill
 * that is missing or misplaced.
 *
 * Blocked vs fail: a repository that no longer has the directory, or a missing
 * skill in either copy, is a real defect (fail). An installed package that does
 * not contain the skills directory at all cannot be judged read-only (blocked) -
 * it may be a package that simply does not ship skills, in which case the
 * declaration should say bundledSkills: false.
 */
import type { ShippedSkillSet } from "../../contracts/skills-rules";
import {
  compareSkillSets,
  describeComparison,
  inspectShippedSkills,
  MODEL_CATALOG_CAVEAT,
} from "../../contracts/skills-rules";
import { joinFsPath } from "../../runtime/paths";
import type { SelfCheckContext } from "../self-check";
import { blocked, checkId, failed, passed, skipped } from "../types";
import type { CheckModule } from "../types";
import { recordEvidence } from "./shared";
import {
  discoverShippedSkills,
  findInstalledSkillsDir,
  mergeSkillObservations,
  observeSkillRoots,
  skillObservationsFromRoots,
} from "./skills-observation";

/** Name each entry the host would silently skip. */
function describeDefects(shipped: ShippedSkillSet): readonly string[] {
  const defects: string[] = [];
  for (const mismatch of shipped.mismatches) {
    const declared = mismatch.declared === null ? "(missing)" : JSON.stringify(mismatch.declared);
    defects.push(mismatch.dirName + ": frontmatter name is " + declared);
  }
  for (const dirName of shipped.missingFrontmatter) {
    defects.push(dirName + ": SKILL.md has no readable frontmatter name");
  }
  return defects;
}

/** Compose the skill-set check. */
export function createSkillsSetCheck(): CheckModule<SelfCheckContext> {
  return {
    id: checkId("skills-set"),
    title: "the package ships exactly the declared skill set, in the repository and in the installed copy",
    hard: true,
    requires: [],
    onMissing: "skip",
    async run(context) {
      const declaration = context.profile.bundledSkills;
      if (declaration === false) {
        return skipped(
          "the profile declares no bundled skills",
          "set bundledSkills: { dir, expected } in verify/profile.ts to verify the shipped skill set",
        );
      }
      const { fs } = context.ports;
      const repoPath = joinFsPath(context.cwd, ...declaration.dir.split("/"));

      const repoShipped = await discoverShippedSkills(fs, repoPath);
      if (!repoShipped.ok) {
        const evidence = await recordEvidence(
          context.evidence,
          "skills-set",
          { dir: declaration.dir, repo: { path: repoPath, readable: false, error: repoShipped.error.message } },
          "the repository skill directory is not readable",
          context.note,
        );
        return failed(
          "could not read the repository skill directory " + repoPath + ": " + repoShipped.error.message,
          "a readable " + repoPath + " holding " + declaration.expected + " skill(s)",
          repoShipped.error.message,
          "check bundledSkills.dir in verify/profile.ts and that the package is built with its bundled skills directory",
          evidence,
        );
      }

      const repoDiscovery = repoShipped.value;
      const repoInspected = await inspectShippedSkills(repoDiscovery.skills);
      if (!repoInspected.ok) {
        const evidence = await recordEvidence(
          context.evidence,
          "skills-set",
          {
            dir: declaration.dir,
            repo: { path: repoPath, readable: true, names: [], ignored: [...repoDiscovery.ignored] },
          },
          "the repository skill directory holds no skills",
          context.note,
        );
        return failed(
          "the repository ships no readable skills under " + repoPath,
          "a " + repoPath + " holding " + declaration.expected + " skill(s)",
          "no <name>/SKILL.md directory or flat <name>.md file was found",
          "build the bundled skills directory or fix bundledSkills.dir in verify/profile.ts",
          evidence,
        );
      }
      const repo = repoInspected.value;
      const repoDefects = describeDefects(repo);
      if (repoDefects.length > 0) {
        const evidence = await recordEvidence(
          context.evidence,
          "skills-set",
          {
            dir: declaration.dir,
            repo: {
              path: repoPath,
              names: [...repo.names],
              mismatches: repo.mismatches,
              missingFrontmatter: repo.missingFrontmatter,
              ignored: [...repoDiscovery.ignored],
            },
          },
          "the repository ships skills the host would skip",
          context.note,
        );
        return failed(
          "the repository ships skills the host would skip: " + repoDefects.join("; "),
          "every SKILL.md under " + repoPath + " has a frontmatter name equal to its directory name",
          repoDefects.join("; "),
          "rename the directory or fix the frontmatter name; the host drops a skill whose name and directory disagree without reporting an error",
          evidence,
        );
      }

      const packageName = context.profile.packageName;
      const packageDir = joinFsPath(context.profileDir, "node_modules", ...packageName.split("/"));
      const lookup = await findInstalledSkillsDir(fs, packageDir, declaration.dir);
      const installedDir = lookup.path;
      if (installedDir === null) {
        const evidence = await recordEvidence(
          context.evidence,
          "skills-set",
          {
            dir: declaration.dir,
            repo: { path: repoPath, names: [...repo.names] },
            installed: { path: null, resolution: lookup.resolution, tried: lookup.tried, names: [], count: 0 },
          },
          "the installed package has no bundled skills directory",
          context.note,
        );
        return blocked(
          "the installed " + packageName + " at " + packageDir + " has no " + declaration.dir +
            " skills directory (tried: " + lookup.tried.join(", ") + ")",
          "reinstall/rebuild " + packageName + " so it ships " + declaration.dir +
            ", or set bundledSkills: false in verify/profile.ts if this package does not ship skills",
          evidence,
        );
      }

      const installedShipped = await discoverShippedSkills(fs, installedDir);
      if (!installedShipped.ok) {
        const evidence = await recordEvidence(
          context.evidence,
          "skills-set",
          { dir: declaration.dir, installed: { path: installedDir, resolution: lookup.resolution, readable: false } },
          "the installed skills directory is not readable",
          context.note,
        );
        return failed(
          "could not read the installed skills directory " + installedDir + ": " + installedShipped.error.message,
          "a readable " + installedDir + " holding " + declaration.expected + " skill(s)",
          installedShipped.error.message,
          "rebuild the package and reinstall it into the profile, then rerun self-check",
          evidence,
        );
      }

      const installedDiscovery = installedShipped.value;
      const installedInspected = await inspectShippedSkills(installedDiscovery.skills);
      if (!installedInspected.ok) {
        const evidence = await recordEvidence(
          context.evidence,
          "skills-set",
          {
            dir: declaration.dir,
            installed: {
              path: installedDir,
              resolution: lookup.resolution,
              names: [],
              ignored: [...installedDiscovery.ignored],
            },
          },
          "the installed skills directory holds no skills",
          context.note,
        );
        return failed(
          "the installed " + packageName + " ships no readable skills under " + installedDir,
          declaration.expected + " skill(s) under " + installedDir,
          "no <name>/SKILL.md directory or flat <name>.md file was found",
          "rebuild the package and reinstall it into the profile, then rerun self-check",
          evidence,
        );
      }
      const installed = installedInspected.value;
      const installedDefects = describeDefects(installed);
      if (installedDefects.length > 0) {
        const evidence = await recordEvidence(
          context.evidence,
          "skills-set",
          {
            dir: declaration.dir,
            installed: {
              path: installedDir,
              resolution: lookup.resolution,
              names: [...installed.names],
              mismatches: installed.mismatches,
              missingFrontmatter: installed.missingFrontmatter,
              ignored: [...installedDiscovery.ignored],
            },
          },
          "the installed package ships skills the host would skip",
          context.note,
        );
        return failed(
          "the installed " + packageName + " ships skills the host would skip: " + installedDefects.join("; "),
          "every SKILL.md under " + installedDir + " has a frontmatter name equal to its directory name",
          installedDefects.join("; "),
          "rebuild the package so its bundled skills have matching directory and frontmatter names, then reinstall it",
          evidence,
        );
      }

      const roots = await observeSkillRoots(fs, {
        cwd: context.cwd,
        dshHome: context.dshHome,
        homeDir: context.ports.env.homeDir(),
        agentsHome: context.ports.env.get("DSH_AGENTS_HOME"),
        bundledSkillDir: context.ports.env.get("DSH_BUNDLED_SKILL_DIR"),
      });
      const installedObservations = installed.names.map((name) => ({
        name,
        source: "bundled",
        rank: 600,
        dir: joinFsPath(installedDir, name),
      }));
      const merged = mergeSkillObservations([
        ...installedObservations,
        ...skillObservationsFromRoots(roots),
      ]);
      const expectation = { names: repo.names, expectedCount: declaration.expected };
      const compared = compareSkillSets(expectation, merged.observations);
      const installedLeftovers = installed.names.filter((name) => !repo.names.includes(name));
      const rootSummary = roots.filter((root) => root.exists).length === 0
        ? "none present"
        : roots.filter((root) => root.exists).map((root) => root.source + "=" + root.count).join(", ");
      const evidence = await recordEvidence(
        context.evidence,
        "skills-set",
        {
          dir: declaration.dir,
          expected: declaration.expected,
          repo: {
            path: repoPath,
            names: [...repo.names],
            count: repo.names.length,
            mismatches: repo.mismatches,
            missingFrontmatter: repo.missingFrontmatter,
            ignored: [...repoDiscovery.ignored],
          },
          installed: {
            path: installedDir,
            resolution: lookup.resolution,
            tried: lookup.tried,
            names: [...installed.names],
            count: installed.names.length,
            ignored: [...installedDiscovery.ignored],
          },
          roots: roots.map((root) => ({
            source: root.source,
            rank: root.rank,
            path: root.path,
            exists: root.exists,
            count: root.count,
            names: [...root.names],
            problems: [...root.problems],
          })),
          merged: {
            observations: merged.observations.map((observation) => ({
              name: observation.name,
              source: observation.source,
              rank: observation.rank ?? null,
            })),
            conflicts: merged.conflicts,
          },
          comparison: compared.ok ? compared.value : null,
          comparisonError: compared.ok ? null : compared.error.message,
          unexpectedInstalled: installedLeftovers,
          modelCatalogUsed: false,
          caveat: MODEL_CATALOG_CAVEAT,
        },
        "the skill set observed in the repository, the installed package and the host roots",
        context.note,
      );

      if (!compared.ok) {
        const leftover = installedLeftovers.length === 0
          ? ""
          : "; the installed copy still declares " + installedLeftovers.join(", ") + ", which the repository no longer ships";
        return failed(
          "the declared skill count and the repository's skill set disagree" + leftover,
          "bundledSkills.expected = " + declaration.expected + " skill(s) in " + repoPath,
          repo.names.length + " skill(s) with a valid frontmatter name" + leftover,
          "restore the missing skill under " + repoPath +
            " or change bundledSkills.expected in verify/profile.ts to " + repo.names.length,
          evidence,
        );
      }

      const comparison = compared.value;
      if (!comparison.ok) {
        return failed(
          "the observed skill registry does not match the declaration: " + describeComparison(comparison),
          "the declared set (" + comparison.expectedCount + "): " + repo.names.join(", "),
          "observed " + comparison.observedCount + " across the installed copy (" + installed.names.length +
            ") and host roots (" + rootSummary + ")",
          "reinstall/rebuild the package or fix bundledSkills in verify/profile.ts; a skill dropped on either side changes the set",
          evidence,
        );
      }

      const ignoredDocs = [...repoDiscovery.ignored, ...installedDiscovery.ignored];
      const ignoredSummary = ignoredDocs.length === 0
        ? ""
        : "; ignored non-skill markdown without frontmatter: " + ignoredDocs.map((entry) => entry.name).join(", ");
      return passed(
        "the repository ships " + repo.names.length + " skill(s) and the installed package ships " +
          installed.names.length + "; the merged registry contains exactly the declared " +
          comparison.expectedCount + "; host roots: " + rootSummary + ignoredSummary +
          "; judged from the file tree and frontmatter, not from a model-facing skill catalog",
        evidence,
      );
    },
  };
}
