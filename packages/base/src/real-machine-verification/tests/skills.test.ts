/**
 * `skills` is tested through its command entry. The fixture is a repository
 * skill tree plus the installed package copy, because the file tree and
 * frontmatter are the authority; a model-facing catalog is never consulted.
 */
import { describe, expect, it } from "vitest";

import { parseArgs } from "../cli/args";
import { runSkillsCommand, type SkillsCommandDeps } from "../cli/commands/skills";
import { joinFsPath } from "../runtime/paths";
import { captureIo } from "./support/fake-capture";
import {
  createLaunchFixture,
  fixtureLoader,
  type LaunchFixture,
} from "./support/fake-launch";
import { buildProfile, declarationFixture } from "./support/fake-machine";

interface CheckJson {
  readonly id: string;
  readonly status: string;
  readonly detail: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
  readonly source?: string;
}

interface SkillsJson {
  readonly command: string;
  readonly ok: boolean;
  readonly checks: readonly CheckJson[];
  readonly notes?: readonly string[];
}

const REPO_SKILLS = "C:\\fake\\repo\\skills";

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} fixture\n---\n`;
}

function fixture(): LaunchFixture {
  return createLaunchFixture({
    declaration: declarationFixture({
      profile: buildProfile({
        packageName: "fixture-plugin",
        defaultProfile: "web",
        clientEntry: "lib/client.js",
        bundledSkills: { dir: "skills", expected: 2 },
      }),
    }),
  });
}

function seedRepoSkill(fake: LaunchFixture, name: string, declared = name): void {
  fake.fs.seedFile(joinFsPath(REPO_SKILLS, name, "SKILL.md"), skill(declared));
}

function seedInstalledSkill(fake: LaunchFixture, name: string): void {
  const dir = joinFsPath(fake.paths.profileDir, "node_modules", "fixture-plugin", "skills", name);
  fake.fs.seedFile(joinFsPath(dir, "SKILL.md"), skill(name));
}

async function run(
  fake: LaunchFixture,
  argv: readonly string[],
): Promise<{ readonly code: number; readonly out: string; readonly err: string }> {
  const capture = captureIo();
  const deps: SkillsCommandDeps = {
    ports: fake.ports,
    io: capture.io,
    runtime: fake.runtime,
    loadDeclaration: fixtureLoader(fake),
  };
  const code = await runSkillsCommand(parseArgs(argv), deps);
  return { code, out: capture.stdout(), err: capture.stderr() };
}

describe("skills command", () => {
  it("passes when the repository and installed copies carry the declared names, and writes nothing", async () => {
    const fake = fixture();
    seedRepoSkill(fake, "alpha");
    seedRepoSkill(fake, "beta");
    seedInstalledSkill(fake, "alpha");
    seedInstalledSkill(fake, "beta");

    const result = await run(fake, ["skills", "--json"]);

    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out) as SkillsJson;
    expect(payload.command).toBe("skills");
    expect(payload.ok).toBe(true);
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0]?.id).toBe("skills-set");
    expect(payload.checks[0]?.status).toBe("pass");
    expect(payload.checks[0]?.source).toBe("builtin");
    expect(payload.notes?.[0]).toContain("model-facing");
    expect(result.err).toContain("ok skills-set");
    expect(fake.fs.writes).toHaveLength(0);
  });

  it("fails and names the missing installed skill", async () => {
    const fake = fixture();
    seedRepoSkill(fake, "alpha");
    seedRepoSkill(fake, "beta");
    seedInstalledSkill(fake, "alpha");

    const result = await run(fake, ["skills", "--json"]);

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.out) as SkillsJson;
    const check = payload.checks[0];
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("beta");
    expect(check?.expected).toBeTruthy();
    expect(check?.actual).toBeTruthy();
    expect(check?.hint).toBeTruthy();
  });

  it("counts an extra installed (bundled) skill as an error", async () => {
    const fake = fixture();
    seedRepoSkill(fake, "alpha");
    seedRepoSkill(fake, "beta");
    seedInstalledSkill(fake, "alpha");
    seedInstalledSkill(fake, "beta");
    seedInstalledSkill(fake, "gamma");

    const result = await run(fake, ["skills", "--json"]);

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.out) as SkillsJson;
    expect(payload.checks[0]?.status).toBe("fail");
    expect(payload.checks[0]?.detail).toContain("gamma");
  });

  it("does not count an extra project-root skill as an error", async () => {
    const fake = fixture();
    seedRepoSkill(fake, "alpha");
    seedRepoSkill(fake, "beta");
    seedInstalledSkill(fake, "alpha");
    seedInstalledSkill(fake, "beta");
    fake.fs.seedFile(joinFsPath(fake.paths.cwd, ".dsh", "skills", "gamma", "SKILL.md"), skill("gamma"));

    const result = await run(fake, ["skills", "--json"]);

    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out) as SkillsJson;
    expect(payload.checks[0]?.status).toBe("pass");
  });

  it("fails and names the directory whose frontmatter name disagrees", async () => {
    const fake = fixture();
    seedRepoSkill(fake, "alpha");
    seedRepoSkill(fake, "beta", "not-beta");
    seedInstalledSkill(fake, "alpha");
    seedInstalledSkill(fake, "beta");

    const result = await run(fake, ["skills", "--json"]);

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.out) as SkillsJson;
    const check = payload.checks[0];
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("beta");
    expect(check?.actual).toContain("not-beta");
  });
});
