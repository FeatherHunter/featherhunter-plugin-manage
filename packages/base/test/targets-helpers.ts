import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest } from "../src/core/types";
import { updateReadmeTargets } from "../src/node/readme-sync";
import { expandReadmeTargets, readPackagedManifest } from "../src/node/targets";
import { fixtureDoc, loadThanksData, makeTempDir, thanksDatasetOf } from "./readme-helpers";

/** Version the fake repositories pin (matches the packaged manifest). */
export const DEP_VERSION = "0.0.1";

/** Inlined-bundle banner esbuild prepends to the built client entry. */
export const INLINE_BANNER = "/*! dsh-featherhunter-plugin-base v" + DEP_VERSION + " */";

/** Workflow body that mounts the README sync step (and, for ilife, a schedule). */
function workflowYaml(scheduled: boolean): string {
  const trigger = scheduled ? "on:\n  schedule:\n    - cron: \"0 0 * * *\"\n  push:\n    branches: [main]\n" : "on:\n  push:\n    branches: [main]\n";
  return (
    "name: readme sync\n" +
    trigger +
    "jobs:\n" +
    "  sync:\n" +
    "    runs-on: ubuntu-latest\n" +
    "    steps:\n" +
    "      - uses: actions/checkout@v4\n" +
    "      - run: npx dsh-featherhunter-plugin-base@" +
    DEP_VERSION +
    " readme:sync --all\n"
  );
}

/** A throwaway copy of the five repositories, built from the ticket-07 fixture. */
export interface FakeRepos {
  /** Parent directory that contains the five repository directories. */
  dir: string;
  cleanup: () => void;
  manifest: Manifest;
}

/**
 * Build a fake five-repository tree from the extracted README fixture.
 *
 * Every repository gets its READMEs (legacy blocks, as they were before the
 * migration), the thanks data its generator keeps, an exact dependency on the
 * base package and a workflow that mounts `readme:sync`. Deck additionally gets
 * an inlined client bundle with the current banner; ilife's workflow carries a
 * schedule trigger, matching the handover requirement.
 */
export function buildFakeRepos(): FakeRepos {
  const { dir, cleanup } = makeTempDir("dsh-base-repos-");
  const manifest = readPackagedManifest();
  const thanksWritten = new Set<string>();
  const packageWritten = new Set<string>();
  const workflowWritten = new Set<string>();
  const starWritten = new Set<string>();

  for (const file of fixtureDoc().files) {
    const repoRoot = join(dir, file.repo);
    const readmePath = join(repoRoot, file.repoPath);
    mkdirSync(dirname(readmePath), { recursive: true });

    const parts = ["# " + file.id + " demo README", "", "Intro paragraph before the managed blocks."];
    const blocks = file.blocks as Record<string, { raw: string | null }>;
    for (const block of file.order) {
      const raw = blocks[block]?.raw ?? null;
      // The real im README carries a stray ">>>>>>>> origin/master" residue
      // inside its contact block; the owner has to remove it before the
      // migration can touch that file, so the fake tree simulates the fixed
      // README while the damage tests inject the residue on purpose.
      if (raw !== null) parts.push("", raw.replace(/>>>>>>>[^\n]*/g, ""));
    }
    writeFileSync(readmePath, parts.join("\n") + "\n", "utf8");

    if (!thanksWritten.has(file.repo)) {
      thanksWritten.add(file.repo);
      const thanks = loadThanksData(thanksDatasetOf(file.id));
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      writeFileSync(join(repoRoot, "docs", "thanks-data.json"), JSON.stringify({ authors: thanks.authors }, null, 2), "utf8");
    }

    if (!packageWritten.has(file.repo)) {
      packageWritten.add(file.repo);
      writeFileSync(
        join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: file.repo,
            version: "1.0.0",
            private: true,
            dependencies: { "dsh-featherhunter-plugin-base": DEP_VERSION },
          },
          null,
          2,
        ),
        "utf8",
      );
    }

    if (!starWritten.has(file.repo)) {
      starWritten.add(file.repo);
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      // deck / im / ilife publish a light/dark pair; palette and prompt publish
      // one theme-neutral chart that both colour schemes reuse.
      const charts =
        file.repo === "dsh-opencode-palette" || file.repo === "dsh-prompt"
          ? ["star-history.svg"]
          : ["star-history-dark.svg", "star-history-light.svg"];
      for (const chart of charts) {
        writeFileSync(join(repoRoot, "docs", chart), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n', "utf8");
      }
    }

    if (!workflowWritten.has(file.repo)) {
      workflowWritten.add(file.repo);
      mkdirSync(join(repoRoot, ".github", "workflows"), { recursive: true });
      const name = file.repo === "ilife" ? "ci.yml" : "star-history.yml";
      writeFileSync(join(repoRoot, ".github", "workflows", name), workflowYaml(file.repo === "ilife"), "utf8");
    }
  }

  // Deck inlines the client bundle, so the doctor can verify the banner version.
  mkdirSync(join(dir, "dsh-mattpocock-skills-deck", "src"), { recursive: true });
  writeFileSync(
    join(dir, "dsh-mattpocock-skills-deck", "src", "base-client.ts"),
    INLINE_BANNER + "\nexport const baseClient = true;\n",
    "utf8",
  );

  return { dir, cleanup, manifest };
}

/** Run `readme:init` over every fake repository and assert it succeeded. */
export function initFakeRepos(repos: FakeRepos): void {
  const targets = expandReadmeTargets([repos.dir], { manifest: repos.manifest });
  const result = updateReadmeTargets(targets, { command: "init" });
  if (!result.ok) {
    const errors = result.files.flatMap((file) => file.errors);
    throw new Error("fake repo init failed:\n" + errors.join("\n"));
  }
}

/** Absolute path of one fixture README inside the fake tree. */
export function fakeReadmePath(repos: FakeRepos, repo: string, readme = "README.md"): string {
  return join(repos.dir, repo, readme);
}