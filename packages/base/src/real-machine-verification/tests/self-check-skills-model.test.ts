/**
 * Self-check: the skill-set, model-configuration and credential checks end to end.
 *
 * Every case runs the real CLI in-process against the fake machine: a fake DSH
 * home, a fake profile patch layer, a fake installed package and a fake
 * repository. Nothing reads the real home, a real credential or the network, so
 * the assertions are about the check logic, not one machine's state.
 *
 * The 27-skill fixture hides 16 skills with disable-model-invocation: counting
 * from a model-facing surface would report 11 and miss the other 16, which is
 * exactly why these checks count the file tree instead.
 */
import { describe, expect, it } from "vitest";

import { main } from "../cli/main";
import { ok } from "../contracts/result";
import type { RunReport } from "../contracts/run-state";
import type { VerificationProfileInput } from "../contracts/verification-profile";
import { planSelfCheck } from "../orchestration/self-check";
import { captureIo } from "./support/fake-capture";
import {
  buildProfile,
  createFixture,
  declarationLoader,
  fixtureDeclaration,
  readRunDirectory,
  type Fixture,
} from "./support/fake-machine";

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly report: RunReport;
}

const SKILL_NAMES: readonly string[] = Array.from({ length: 27 }, (_unused, index) =>
  "skill-" + String(index + 1).padStart(2, "0"),
);
const HIDDEN_NAMES = new Set(SKILL_NAMES.slice(0, 16));

function skillMarkdown(name: string, hidden: boolean): string {
  const lines = ["---", "name: " + name, "description: fixture skill " + name];
  if (hidden) lines.push("disable-model-invocation: true");
  lines.push("---", "", "# " + name, "");
  return lines.join("\n");
}

function repoSkillsDir(fixture: Fixture): string {
  return fixture.paths.cwd + "\\bundled-skills";
}

function installedSkillsDir(fixture: Fixture): string {
  return fixture.paths.packageDir + "\\bundled-skills";
}

function seedSkill(fixture: Fixture, base: string, dirName: string, declared = dirName): void {
  const hidden = HIDDEN_NAMES.has(declared);
  fixture.fs.seedFile(base + "\\" + dirName + "\\SKILL.md", skillMarkdown(declared, hidden));
}

function seedSkillTree(fixture: Fixture, base: string, names: readonly string[]): void {
  for (const name of names) seedSkill(fixture, base, name);
}

function greenFixture(overrides: Partial<VerificationProfileInput> = {}): Fixture {
  const fixture = createFixture({
    profileOverrides: { bundledSkills: { dir: "bundled-skills", expected: 27 }, ...overrides },
  });
  seedSkillTree(fixture, repoSkillsDir(fixture), SKILL_NAMES);
  seedSkillTree(fixture, installedSkillsDir(fixture), SKILL_NAMES);
  // The real matt package ships README.md/LICENSE/VERSION next to its 27 skills;
  // a flat markdown file without frontmatter is docs, not a skill. Seeding one
  // keeps the green case faithful to the package this check runs against.
  const docs = "# bundled skills\n\nHuman documentation, not a skill.\n";
  fixture.fs.seedFile(repoSkillsDir(fixture) + "\\README.md", docs);
  fixture.fs.seedFile(installedSkillsDir(fixture) + "\\README.md", docs);
  return fixture;
}

function seedModelPatch(fixture: Fixture, provider: string, model: string, apiKeyEnv: string): void {
  fixture.fs.seedFile(
    fixture.paths.profileDir + "\\cordis.patch.yml",
    [
      "- id: agent-default-model",
      "  config:",
      "    provider: " + provider,
      "    model: " + model,
      "- id: llm-pi-ai",
      "  config:",
      "    providers:",
      "      " + provider + ":",
      "        apiKeyEnv: " + apiKeyEnv,
      "        models:",
      "          - id: " + model,
      "",
    ].join("\n"),
  );
}

function seedCredentialStore(fixture: Fixture, refs: readonly string[]): void {
  const lines = ["version: 1", "refs:"];
  for (const ref of refs) lines.push("  " + ref + ": placeholder-value-must-never-leak");
  fixture.fs.seedFile(fixture.paths.dshHome + "\\.credentials.yaml", lines.join("\n"));
}

async function runSelfCheck(fixture: Fixture): Promise<RunResult> {
  const capture = captureIo();
  const code = await main(["self-check", "--work-root", fixture.paths.workRoot, "--json"], {
    ports: fixture.ports,
    io: capture.io,
    runtime: fixture.runtime,
    loadDeclaration: declarationLoader(ok(fixtureDeclaration(fixture))),
  });
  const stdout = capture.stdout();
  return { code, stdout, stderr: capture.stderr(), report: JSON.parse(stdout) as RunReport };
}

function checkOf(report: RunReport, id: string) {
  return report.checks.find((check) => check.id === id);
}

function statusOf(report: RunReport, id: string): string | undefined {
  return checkOf(report, id)?.status;
}

describe("self-check skill and model checks", () => {
  it("plans the three checks after package-installed", () => {
    const plan = planSelfCheck({
      profile: buildProfile({
        bundledSkills: { dir: "bundled-skills", expected: 27 },
        model: { provider: "minimax-cn", model: "MiniMax-cn", apiKeyEnv: "MINIMAX_CN_API_KEY" },
      }),
      screenRequested: false,
    });
    expect(plan.checks.map((check) => check.id)).toEqual([
      "profile-declaration",
      "dsh-runtime",
      "node-version",
      "profile-present",
      "package-installed",
      "skills-set",
      "model-configured",
      "model-credential",
    ]);
  });

  it("passes all three checks on a green machine and records file-tree evidence", async () => {
    const fixture = greenFixture({
      model: { provider: "minimax-cn", model: "MiniMax-cn", apiKeyEnv: "MINIMAX_CN_API_KEY" },
    });
    seedModelPatch(fixture, "minimax-cn", "MiniMax-cn", "MINIMAX_CN_API_KEY");
    seedCredentialStore(fixture, ["MINIMAX_CN_API_KEY"]);

    const result = await runSelfCheck(fixture);
    expect(result.code).toBe(0);
    expect(result.report.state).toBe("passed");
    expect(statusOf(result.report, "skills-set")).toBe("pass");
    expect(statusOf(result.report, "model-configured")).toBe("pass");
    expect(statusOf(result.report, "model-credential")).toBe("pass");
    expect(checkOf(result.report, "skills-set")?.detail).toContain("not from a model-facing skill catalog");
    expect(checkOf(result.report, "skills-set")?.detail).toContain("ignored non-skill markdown");
    expect(checkOf(result.report, "skills-set")?.detail).toContain("README");

    const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    const skillsFile = run.evidenceFiles.find((file) => file.includes("skills-set"));
    expect(skillsFile).toBeDefined();
    if (skillsFile === undefined) return;
    const skills = JSON.parse(fixture.fs.readFileSync(skillsFile)) as {
      modelCatalogUsed: boolean;
      caveat: string;
      comparison: { ok: boolean; expectedCount: number; observedCount: number };
      installed: { names: string[]; ignored: { name: string }[] };
      repo: { names: string[]; ignored: { name: string }[] };
    };
    expect(skills.modelCatalogUsed).toBe(false);
    expect(skills.caveat).toContain("model-facing catalog");
    expect(skills.comparison.ok).toBe(true);
    expect(skills.comparison.expectedCount).toBe(27);
    expect(skills.comparison.observedCount).toBe(27);
    expect(skills.repo.names).toHaveLength(27);
    expect(skills.installed.names).toHaveLength(27);
    expect(skills.repo.ignored.map((entry) => entry.name)).toEqual(["README"]);
    expect(skills.installed.ignored.map((entry) => entry.name)).toEqual(["README"]);

    const credentialFile = run.evidenceFiles.find((file) => file.includes("model-credential"));
    expect(credentialFile).toBeDefined();
    if (credentialFile === undefined) return;
    const credential = JSON.parse(fixture.fs.readFileSync(credentialFile)) as {
      valueRead: boolean;
      sources: { source: string; available: boolean }[];
    };
    expect(credential.valueRead).toBe(false);
    expect(credential.sources.find((source) => source.source === "real-home-store")?.available).toBe(true);
  });

  it("fails the skill set when the repository drops a skill and names the installed leftover", async () => {
    const fixture = createFixture({ profileOverrides: { bundledSkills: { dir: "bundled-skills", expected: 27 } } });
    seedSkillTree(fixture, repoSkillsDir(fixture), SKILL_NAMES.slice(0, 26));
    seedSkillTree(fixture, installedSkillsDir(fixture), SKILL_NAMES);

    const result = await runSelfCheck(fixture);
    expect(result.code).toBe(1);
    expect(result.report.state).toBe("failed");
    const check = checkOf(result.report, "skills-set");
    expect(check?.status).toBe("fail");
    const combined = JSON.stringify(check);
    expect(combined).toContain("skill-27");
    expect(combined).toContain("still declares");
    expect(combined).toContain("26");
    expect(combined).toContain("27");
  });

  it("fails when a skill directory and its frontmatter name disagree, naming the directory", async () => {
    const fixture = createFixture({ profileOverrides: { bundledSkills: { dir: "bundled-skills", expected: 27 } } });
    seedSkillTree(fixture, repoSkillsDir(fixture), SKILL_NAMES.filter((name) => name !== "skill-17"));
    seedSkill(fixture, repoSkillsDir(fixture), "renamed-skill", "skill-17");
    seedSkillTree(fixture, installedSkillsDir(fixture), SKILL_NAMES);

    const result = await runSelfCheck(fixture);
    expect(result.code).toBe(1);
    const check = checkOf(result.report, "skills-set");
    expect(check?.status).toBe("fail");
    const combined = JSON.stringify(check);
    expect(combined).toContain("renamed-skill");
    expect(combined).toContain("skill-17");
    expect(check?.hint).toContain("host drops a skill");
  });

  it("fails model-configured with both literal model ids when the patch layer differs", async () => {
    const fixture = createFixture({
      profileOverrides: {
        model: { provider: "minimax-cn", model: "MiniMax-cn", apiKeyEnv: "MINIMAX_CN_API_KEY" },
      },
    });
    seedModelPatch(fixture, "minimax-cn", "MiniMax-cn-old", "MINIMAX_CN_API_KEY");
    seedCredentialStore(fixture, ["MINIMAX_CN_API_KEY"]);

    const result = await runSelfCheck(fixture);
    expect(result.code).toBe(1);
    expect(result.report.state).toBe("failed");
    expect(statusOf(result.report, "model-configured")).toBe("fail");
    expect(statusOf(result.report, "skills-set")).toBe("skip");
    expect(statusOf(result.report, "model-credential")).toBe("pass");
    const check = checkOf(result.report, "model-configured");
    expect(check?.expected).toContain("model=MiniMax-cn ");
    expect(check?.actual).toContain("model=MiniMax-cn-old");
    const combined = JSON.stringify(check);
    expect(combined).toContain("MiniMax-cn-old");
    expect(combined).toContain("MiniMax-cn");
  });

  it("blocks the credential check and exits 2 when the reference resolves nowhere", async () => {
    const fixture = createFixture({
      profileOverrides: {
        model: { provider: "minimax-cn", model: "MiniMax-cn", apiKeyEnv: "MISSING_CREDENTIAL_REF" },
      },
    });
    seedModelPatch(fixture, "minimax-cn", "MiniMax-cn", "MISSING_CREDENTIAL_REF");

    const result = await runSelfCheck(fixture);
    expect(result.code).toBe(2);
    expect(result.report.state).toBe("blocked");
    const check = checkOf(result.report, "model-credential");
    expect(check?.status).toBe("blocked");
    expect(check?.detail).toContain("MISSING_CREDENTIAL_REF");
    expect(check?.hint).toContain("MISSING_CREDENTIAL_REF");
    expect(statusOf(result.report, "model-configured")).toBe("pass");
    expect(statusOf(result.report, "skills-set")).toBe("skip");
  });

  it("never writes a credential value into the run directory or the report", async () => {
    const canary = "sk-canary-9f3d2b7a1c5e";
    const fixture = createFixture({
      profileOverrides: {
        model: { provider: "minimax-cn", model: "MiniMax-cn", apiKeyEnv: "CANARY_API_KEY" },
      },
      envValues: { CANARY_API_KEY: canary },
    });
    seedModelPatch(fixture, "minimax-cn", "MiniMax-cn", "CANARY_API_KEY");

    const result = await runSelfCheck(fixture);
    expect(result.code).toBe(0);
    expect(statusOf(result.report, "model-credential")).toBe("pass");
    expect(result.stdout).not.toContain(canary);
    expect(result.stderr).not.toContain(canary);
    expect(JSON.stringify(result.report)).not.toContain(canary);

    const run = readRunDirectory(fixture.fs, fixture.paths.workRoot);
    expect(run.content).not.toContain(canary);
    for (const file of run.evidenceFiles) {
      expect(fixture.fs.readFileSync(file), file).not.toContain(canary);
    }

    const credentialFile = run.evidenceFiles.find((file) => file.includes("model-credential"));
    expect(credentialFile).toBeDefined();
    if (credentialFile === undefined) return;
    const credential = JSON.parse(fixture.fs.readFileSync(credentialFile)) as {
      apiKeyEnv: string;
      sources: { source: string; available: boolean; reason?: string }[];
    };
    expect(credential.apiKeyEnv).toBe("CANARY_API_KEY");
    expect(credential.sources.find((source) => source.source === "process-env")?.available).toBe(true);
    expect(JSON.stringify(credential)).not.toContain(canary);
  });

  it("skips all three checks when the profile declares neither skills nor a model", async () => {
    const fixture = createFixture();
    const result = await runSelfCheck(fixture);
    expect(result.code).toBe(0);
    expect(statusOf(result.report, "skills-set")).toBe("skip");
    expect(statusOf(result.report, "model-configured")).toBe("skip");
    expect(statusOf(result.report, "model-credential")).toBe("skip");
    expect(checkOf(result.report, "skills-set")?.detail).toContain("declares no bundled skills");
    expect(checkOf(result.report, "model-configured")?.detail).toContain("declares no model");
    expect(checkOf(result.report, "model-credential")?.detail).toContain("declares no model");
  });
});
