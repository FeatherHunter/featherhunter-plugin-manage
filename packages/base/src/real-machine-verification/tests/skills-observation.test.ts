/**
 * Skill discovery and registry merging: what the host could register, read from
 * the file tree.
 *
 * These tests pin the observation half of skills-set: the six-root table and its
 * ranks, first-level enumeration of <name>/SKILL.md directories and flat
 * <name>.md files, broken-frontmatter handling (a note, never a failure for
 * roots that are not this package), installed-copy path fallback, and the
 * merge rule (lowest rank wins across sources, duplicates inside one source are
 * preserved so the comparison reports them).
 */
import { describe, expect, it } from "vitest";

import { compareSkillSets, inspectShippedSkills } from "../contracts/skills-rules";
import {
  discoverShippedSkills,
  enumerateSkillDirectory,
  findInstalledSkillsDir,
  findProjectRoot,
  mergeSkillObservations,
  observeSkillRoots,
  planSkillRoots,
} from "../orchestration/checks/skills-observation";
import { FakeFs } from "./support/fake-fs";

const REPO = "C:\\repo";
const PROJECT_SKILLS = "C:\\repo\\.dsh\\skills";

function skillMarkdown(name: string, hidden = false): string {
  const lines = ["---", "name: " + name, "description: fixture skill " + name];
  if (hidden) lines.push("disable-model-invocation: true");
  lines.push("---", "", "# " + name, "");
  return lines.join("\n");
}

function seedSkill(fs: FakeFs, base: string, dirName: string, declared = dirName, hidden = false): void {
  fs.seedFile(base + "\\" + dirName + "\\SKILL.md", skillMarkdown(declared, hidden));
}

function skillNames(count: number): string[] {
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    names.push("skill-" + String(index + 1).padStart(2, "0"));
  }
  return names;
}

describe("enumerateSkillDirectory", () => {
  it("enumerates skill directories and flat markdown files, sorted by name", async () => {
    const fs = new FakeFs(REPO);
    seedSkill(fs, PROJECT_SKILLS, "beta");
    seedSkill(fs, PROJECT_SKILLS, "alpha");
    fs.seedFile(PROJECT_SKILLS + "\\flat.md", skillMarkdown("flat"));
    fs.seedFile(PROJECT_SKILLS + "\\notes.txt", "not a skill");
    fs.seedDir(PROJECT_SKILLS + "\\no-skill-md");
    const listed = await enumerateSkillDirectory(fs, PROJECT_SKILLS);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((skill) => skill.dirName)).toEqual(["alpha", "beta", "flat"]);
  });

  it("returns the filesystem error for a root that does not exist", async () => {
    const fs = new FakeFs(REPO);
    const listed = await enumerateSkillDirectory(fs, PROJECT_SKILLS);
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.error.code).toBe("not-found");
  });
});

describe("findProjectRoot", () => {
  it("walks up to the nearest ancestor holding .git", async () => {
    const fs = new FakeFs(REPO);
    fs.seedDir("C:\\repo\\.git");
    expect(await findProjectRoot(fs, "C:\\repo\\packages\\base")).toBe("C:\\repo");
  });

  it("falls back to cwd outside a git checkout", async () => {
    const fs = new FakeFs("C:\\scratch");
    expect(await findProjectRoot(fs, "C:\\scratch\\verify")).toBe("C:\\scratch\\verify");
  });
});

describe("planSkillRoots", () => {
  it("lists the host roots in registry order with their ranks", () => {
    const roots = planSkillRoots("C:\\repo", {
      cwd: "C:\\repo",
      dshHome: "C:\\dsh",
      homeDir: "C:\\Users\\fixture",
    });
    expect(roots.map((root) => [root.source, root.rank])).toEqual([
      ["project-dsh", 100],
      ["project-agents", 200],
      ["custom", 300],
      ["user-dsh", 400],
      ["user-agents", 500],
    ]);
    expect(roots[2].path).toBeNull();
    expect(roots[2].note).toContain("cannot be observed read-only");
    expect(roots[4].path).toBe("C:\\Users\\fixture\\.agents\\skills");
  });

  it("honors DSH_AGENTS_HOME and adds the bundled-env root when set", () => {
    const roots = planSkillRoots("C:\\repo", {
      cwd: "C:\\repo",
      dshHome: "C:\\dsh",
      homeDir: "C:\\Users\\fixture",
      agentsHome: "C:\\agents-home",
      bundledSkillDir: "C:\\bundled",
    });
    expect(roots.map((root) => root.source)).toContain("user-agents");
    expect(roots.find((root) => root.source === "user-agents")?.path).toBe("C:\\agents-home\\skills");
    expect(roots.map((root) => [root.source, root.rank])).toContainEqual(["bundled-env", 600]);
  });
});

describe("observeSkillRoots", () => {
  it("records registrable names per root and downgrades broken frontmatter to notes", async () => {
    const fs = new FakeFs("C:\\repo\\packages\\base");
    fs.seedDir("C:\\repo\\.git");
    seedSkill(fs, PROJECT_SKILLS, "alpha");
    seedSkill(fs, PROJECT_SKILLS, "beta", "gamma");
    fs.seedFile(PROJECT_SKILLS + "\\flat.md", "no frontmatter here at all");
    seedSkill(fs, "C:\\dsh\\skills", "user-one");
    fs.seedFile("C:\\dsh\\skills\\.system\\SKILL.md", skillMarkdown(".system"));

    const roots = await observeSkillRoots(fs, {
      cwd: "C:\\repo\\packages\\base",
      dshHome: "C:\\dsh",
      homeDir: "C:\\Users\\fixture",
    });

    const project = roots.find((root) => root.source === "project-dsh");
    expect(project?.exists).toBe(true);
    expect(project?.names).toEqual(["alpha"]);
    expect(project?.count).toBe(1);
    expect((project?.problems ?? []).join("\n")).toContain("beta");
    expect((project?.problems ?? []).join("\n")).toContain("flat");

    const user = roots.find((root) => root.source === "user-dsh");
    expect(user?.names).toEqual(["user-one"]);

    const absent = roots.find((root) => root.source === "project-agents");
    expect(absent?.exists).toBe(false);
    expect(absent?.count).toBe(0);

    const custom = roots.find((root) => root.source === "custom");
    expect(custom?.path).toBeNull();
    expect(custom?.note).toContain("cannot be observed read-only");
  });
});

describe("shipped skills and model visibility", () => {
  it("counts 27 skills when 16 of them are hidden from the model", async () => {
    const fs = new FakeFs(REPO);
    const names = skillNames(27);
    names.forEach((name, index) => seedSkill(fs, PROJECT_SKILLS, name, name, index < 16));
    const discovered = await discoverShippedSkills(fs, PROJECT_SKILLS);
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) return;
    const inspected = inspectShippedSkills(discovered.value.skills);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.value.names).toEqual(names);
    expect(inspected.value.mismatches).toEqual([]);
    expect(inspected.value.missingFrontmatter).toEqual([]);
    expect(discovered.value.ignored).toEqual([]);
  });

  it("treats flat markdown without a frontmatter name as documentation, not a skill", async () => {
    const fs = new FakeFs(REPO);
    seedSkill(fs, PROJECT_SKILLS, "alpha");
    fs.seedFile(PROJECT_SKILLS + "\\flat.md", skillMarkdown("flat"));
    fs.seedFile(PROJECT_SKILLS + "\\README.md", "# bundled skills\n\nHuman documentation, no frontmatter.\n");
    fs.seedFile(PROJECT_SKILLS + "\\LICENSE.md", "MIT license text, not a skill\n");

    const discovered = await discoverShippedSkills(fs, PROJECT_SKILLS);
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) return;
    expect(discovered.value.skills.map((skill) => skill.dirName)).toEqual(["alpha", "flat"]);
    expect(discovered.value.ignored.map((entry) => entry.name)).toEqual(["LICENSE", "README"]);
    expect(JSON.stringify(discovered.value.ignored)).toContain("documentation, not a skill");
  });
});

describe("findInstalledSkillsDir", () => {
  const PACKAGE_DIR = "C:\\pkg";

  it("finds the declared path first", async () => {
    const fs = new FakeFs(REPO);
    seedSkill(fs, PACKAGE_DIR + "\\nested\\bundled-skills", "alpha");
    const lookup = await findInstalledSkillsDir(fs, PACKAGE_DIR, "nested/bundled-skills");
    expect(lookup.path).toBe("C:\\pkg\\nested\\bundled-skills");
    expect(lookup.resolution).toBe("declared-path");
    expect(lookup.tried).toEqual(["C:\\pkg\\nested\\bundled-skills"]);
  });

  it("falls back to the basename at the package root", async () => {
    const fs = new FakeFs(REPO);
    seedSkill(fs, PACKAGE_DIR + "\\bundled-skills", "alpha");
    const lookup = await findInstalledSkillsDir(fs, PACKAGE_DIR, "nested/bundled-skills");
    expect(lookup.path).toBe("C:\\pkg\\bundled-skills");
    expect(lookup.resolution).toBe("basename-at-package-root");
    expect(lookup.tried).toEqual(["C:\\pkg\\nested\\bundled-skills", "C:\\pkg\\bundled-skills"]);
  });

  it("reports missing after both candidates", async () => {
    const fs = new FakeFs(REPO);
    const lookup = await findInstalledSkillsDir(fs, PACKAGE_DIR, "bundled-skills");
    expect(lookup.path).toBeNull();
    expect(lookup.resolution).toBe("missing");
    expect(lookup.tried).toEqual(["C:\\pkg\\bundled-skills"]);
  });
});

describe("mergeSkillObservations", () => {
  it("keeps the lowest-rank source and records the conflict", () => {
    const merged = mergeSkillObservations([
      { name: "shared", source: "bundled", rank: 600 },
      { name: "shared", source: "project-dsh", rank: 100 },
      { name: "only-bundled", source: "bundled", rank: 600 },
    ]);
    expect(merged.observations.map((observation) => observation.name)).toEqual(["shared", "only-bundled"]);
    expect(merged.observations[0].source).toBe("project-dsh");
    expect(merged.conflicts).toEqual([
      { name: "shared", kept: { source: "project-dsh", rank: 100 }, ignored: [{ source: "bundled", rank: 600 }] },
    ]);
  });

  it("keeps duplicates inside one source so the comparison reports them", () => {
    const merged = mergeSkillObservations([
      { name: "x", source: "bundled", rank: 600 },
      { name: "x", source: "bundled", rank: 600 },
    ]);
    expect(merged.conflicts).toEqual([]);
    const compared = compareSkillSets({ names: ["x"], expectedCount: 1 }, merged.observations);
    expect(compared.ok).toBe(true);
    if (!compared.ok) return;
    expect(compared.value.duplicated).toEqual(["x"]);
  });
});
