import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/node/cli";
import {
  README_TARGETS,
  STAR_DATA_FILE,
  buildStarHistoryData,
  detectStarMarkdownImage,
  detectStarVersion,
  expandReadmeTargets,
  readmeTargetRepos,
  resolveRepoReadmeTargets,
  starVersionFromDataFile,
  starVersionFromTimestamp,
} from "../src/node/targets";
import { makeTempDir } from "./readme-helpers";
import { buildFakeRepos, fakeReadmePath, initFakeRepos, type FakeRepos } from "./targets-helpers";

const CONTACT_START = "<!-- CONTACT-START -->";
const CONTACT_END = "<!-- CONTACT-END -->";

/** Capture stdout/stderr while main() runs. */
async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  const code = await main(argv);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

/** Snapshot the eleven managed READMEs. */
function snapshot(repos: FakeRepos): Record<string, string> {
  const files: Record<string, string> = {};
  for (const target of expandReadmeTargets([repos.dir], { manifest: repos.manifest })) {
    const path = join(target.root, target.readme);
    if (!existsSync(path)) continue;
    files[path] = readFileSync(path, "utf8");
  }
  return files;
}

/** Every file below a directory (for temp-file assertions). */
function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

/** Damaged README that the sync engine must refuse to touch. */
interface DamageCase {
  name: string;
  mutate: (markdown: string) => string;
  pattern: RegExp;
}

let current: FakeRepos | undefined;

afterEach(() => {
  current?.cleanup();
  current = undefined;
  vi.restoreAllMocks();
});

describe("README target table", () => {
  it("lists the eleven managed READMEs across the five repositories", () => {
    expect(README_TARGETS).toHaveLength(11);
    expect(readmeTargetRepos()).toEqual([
      "dsh-mattpocock-skills-deck",
      "dsh-opencode-palette",
      "dsh-im-companion",
      "dsh-prompt",
      "ilife",
    ]);
    const paths = README_TARGETS.map((target) => target.repo + "/" + target.readme);
    expect(paths).toEqual([
      "dsh-mattpocock-skills-deck/README.md",
      "dsh-mattpocock-skills-deck/package/README.md",
      "dsh-mattpocock-skills-deck/docs/README.en.md",
      "dsh-opencode-palette/README.md",
      "dsh-opencode-palette/package/README.md",
      "dsh-opencode-palette/docs/README.en.md",
      "dsh-im-companion/README.md",
      "dsh-im-companion/docs/README.en.md",
      "dsh-prompt/README.md",
      "dsh-prompt/docs/README.en.md",
      "ilife/README.md",
    ]);
    expect(new Set(README_TARGETS.map((target) => target.lang))).toEqual(new Set(["zh", "en"]));
  });

  it("detects eight- and twelve-digit star-history versions", () => {
    expect(detectStarVersion('<img src="x.svg?v=20261030" />')).toBe("202610300000");
    expect(detectStarVersion('<img src="x.svg?v=202610310130" />')).toBe("202610310130");
    expect(detectStarVersion('<img src="x.svg?v=20261031&theme=dark" />')).toBe("202610310000");
    expect(detectStarVersion("no version here")).toBeUndefined();
    expect(starVersionFromTimestamp("2026-10-23T00:00:00+08:00")).toBe("202610230000");
  });

  it("builds star data from the README version and falls back to the manifest", () => {
    const manifest = { updatedAt: "2026-10-23T00:00:00+08:00" } as never;
    const deck = README_TARGETS.find((target) => target.repo === "dsh-mattpocock-skills-deck" && target.readme === "README.md")!;
    const detected = buildStarHistoryData(deck, '<img src="a.svg?v=20261030" />', manifest);
    expect(detected.version).toBe("202610300000");
    expect(detected.pageUrl).toBe("https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html");
    const fallback = buildStarHistoryData(deck, undefined, manifest);
    expect(fallback.version).toBe("202610230000");
  });

  it("derives the chart version from the repository star data file", () => {
    const { dir, cleanup } = makeTempDir("dsh-base-star-");
    try {
      const manifest = { updatedAt: "2026-10-23T00:00:00+08:00" } as never;
      const prompt = README_TARGETS.find((target) => target.repo === "dsh-prompt" && target.readme === "README.md")!;
      expect(starVersionFromDataFile(dir)).toBeUndefined();
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(
        join(dir, STAR_DATA_FILE),
        JSON.stringify([
          { date: "2026-10-29", total: 80, daily: 1 },
          { date: "2026-10-30", total: 83, daily: 3 },
        ]),
        "utf8",
      );
      expect(starVersionFromDataFile(dir)).toBe("202610300000");
      const markdown =
        "![chart](https://raw.githubusercontent.com/FeatherHunter/dsh-prompt/main/docs/star-history.svg?v=20261029)";
      const detected = buildStarHistoryData(prompt, markdown, manifest, dir);
      // The data file wins over the version already present in the README.
      expect(detected.version).toBe("202610300000");
      expect(detected.markdownImage).toBe(true);
      expect(detectStarMarkdownImage(markdown)).toBe(true);
      expect(detectStarMarkdownImage('<img src="docs/star-history-dark.svg" />')).toBe(false);
      writeFileSync(join(dir, STAR_DATA_FILE), "[]", "utf8");
      expect(starVersionFromDataFile(dir)).toBeUndefined();
      writeFileSync(join(dir, STAR_DATA_FILE), JSON.stringify([{ date: "yesterday" }]), "utf8");
      expect(() => starVersionFromDataFile(dir)).toThrow(/YYYY-MM-DD/);
    } finally {
      cleanup();
    }
  });

  it("resolves the parent directory and rejects unknown repository roots", () => {
    const repos = buildFakeRepos();
    current = repos;
    const targets = expandReadmeTargets([repos.dir], { manifest: repos.manifest });
    expect(targets).toHaveLength(11);

    const prompt = resolveRepoReadmeTargets(join(repos.dir, "dsh-prompt"), { manifest: repos.manifest });
    expect(prompt.map((target) => target.readme)).toEqual(["README.md", "docs/README.en.md"]);
    expect(prompt[0]?.thanks?.repo).toBe("FeatherHunter/dsh-prompt");
    expect(prompt[0]?.thanks?.authors).toBeTypeOf("object");

    expect(() => resolveRepoReadmeTargets(join(repos.dir, "not-a-repo"), { manifest: repos.manifest })).toThrow(
      /is not a managed repository directory/,
    );
  });

  it("loads the thanks data of every repository and skips a missing file", () => {
    const repos = buildFakeRepos();
    current = repos;
    const targets = expandReadmeTargets([repos.dir], { manifest: repos.manifest });
    const ilife = targets.find((target) => target.repo === "ilife")!;
    expect(ilife.thanks?.repo).toBe("FeatherHunter/ilife");

    rmSync(join(repos.dir, "dsh-prompt", "docs", "thanks-data.json"));
    const prompt = resolveRepoReadmeTargets(join(repos.dir, "dsh-prompt"), { manifest: repos.manifest });
    expect(prompt[0]?.thanks).toBeUndefined();
  });
});

describe("readme:init / readme:sync --all --repos", () => {
  it("initializes all eleven READMEs and is idempotent afterwards", async () => {
    current = buildFakeRepos();
    const repos = current;

    const init = await run(["readme:init", "--all", "--repos", repos.dir]);
    expect(init.code).toBe(0);
    expect(init.stderr).toBe("");
    expect(init.stdout.trim().split("\n")).toHaveLength(11);

    const initialized = snapshot(repos);
    for (const [path, markdown] of Object.entries(initialized)) {
      expect(markdown, path).toContain(CONTACT_START);
    }

    const check = await run(["readme:sync", "--check", "--repos", repos.dir]);
    expect(check.code).toBe(0);
    expect(check.stdout.match(/up to date/g)).toHaveLength(11);

    const sync = await run(["readme:sync", "--repos", repos.dir]);
    expect(sync.code).toBe(0);
    expect(snapshot(repos)).toEqual(initialized);

    const again = await run(["readme:init", "--repos", repos.dir]);
    expect(again.code).toBe(0);
    expect(snapshot(repos)).toEqual(initialized);
  });

  it("restores drifted blocks on sync and reports them in check mode", async () => {
    current = buildFakeRepos();
    const repos = current;
    initFakeRepos(repos);
    const before = snapshot(repos);

    const readmePath = fakeReadmePath(repos, "dsh-opencode-palette", "docs/README.en.md");
    writeFileSync(readmePath, readFileSync(readmePath, "utf8").replace(CONTACT_START, CONTACT_START + "\n\nstray note\n"));

    const check = await run(["readme:sync", "--check", "--repos", repos.dir]);
    expect(check.code).toBe(1);
    expect(check.stderr).toMatch(/managed blocks are out of date/);
    expect(readFileSync(readmePath, "utf8")).toContain("stray note");

    const sync = await run(["readme:sync", "--repos", repos.dir]);
    expect(sync.code).toBe(0);
    expect(snapshot(repos)).toEqual(before);
  });

  it("refuses damaged READMEs with a clear message and a non-zero exit", async () => {
    const cases: DamageCase[] = [
      {
        name: "drift",
        mutate: (markdown) => markdown.replace(CONTACT_START, CONTACT_START + "\n\nstray note\n"),
        pattern: /managed blocks are out of date/,
      },
      {
        name: "missing markers",
        mutate: (markdown) => markdown.split(CONTACT_START).join("").split(CONTACT_END).join(""),
        pattern: /markers are missing; run readme:init first/,
      },
      {
        name: "unpaired markers",
        mutate: (markdown) => markdown.split(CONTACT_END).join(""),
        pattern: /unpaired/,
      },
      {
        name: "duplicate markers",
        mutate: (markdown) => markdown.replace(CONTACT_START, CONTACT_START + "\n" + CONTACT_START),
        pattern: /duplicate/,
      },
      {
        name: "merge-conflict residue",
        mutate: (markdown) => ">>>>>>> origin/master\n" + markdown,
        pattern: /suspicious merge-conflict residue/,
      },
    ];

    for (const damage of cases) {
      current = buildFakeRepos();
      const repos = current;
      initFakeRepos(repos);
      const readmePath = fakeReadmePath(repos, "dsh-im-companion", "README.md");
      writeFileSync(readmePath, damage.mutate(readFileSync(readmePath, "utf8")));
      const damaged = readFileSync(readmePath, "utf8");

      const result = await run(["readme:sync", "--check", "--repos", repos.dir]);
      expect(result.code, damage.name).toBe(1);
      expect(result.stderr, damage.name).toMatch(damage.pattern);
      expect(readFileSync(readmePath, "utf8"), damage.name).toBe(damaged);

      current.cleanup();
      current = undefined;
    }
  });

  it("writes the readable targets and leaves no temp file when one README is missing", async () => {
    current = buildFakeRepos();
    const repos = current;
    rmSync(fakeReadmePath(repos, "ilife"));

    const result = await run(["readme:init", "--all", "--repos", repos.dir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/README not found/);

    const initialized = snapshot(repos);
    for (const [path, markdown] of Object.entries(initialized)) {
      if (path.endsWith(join("ilife", "README.md"))) continue;
      expect(markdown, path).toContain(CONTACT_START);
    }
    expect(walkFiles(repos.dir).filter((path) => path.endsWith(".tmp"))).toEqual([]);
  });

  it("skips the star block of a repository without chart assets instead of writing a broken image", async () => {
    current = buildFakeRepos();
    const repos = current;
    rmSync(join(repos.dir, "ilife", "docs", "star-history-dark.svg"));
    rmSync(join(repos.dir, "ilife", "docs", "star-history-light.svg"));

    const result = await run(["readme:init", "--all", "--repos", repos.dir]);
    expect(result.code).toBe(0);
    const ilife = readFileSync(fakeReadmePath(repos, "ilife"), "utf8");
    expect(ilife).toContain(CONTACT_START);
    expect(ilife).not.toContain("STAR-HISTORY-START");
    expect(ilife).not.toContain("star-history-dark.svg");
    // Every repository that does have the assets still gets the block.
    const deck = readFileSync(fakeReadmePath(repos, "dsh-mattpocock-skills-deck"), "utf8");
    expect(deck).toContain("STAR-HISTORY-START");

    const doctor = await run(["doctor", "--repos", repos.dir, "--offline", "--json"]);
    expect(doctor.code).toBe(1);
    const parsed = JSON.parse(doctor.stdout) as { checks: Array<{ name: string; ok: boolean; detail: string }> };
    const starAssets = parsed.checks.find((check) => check.name === "ilife/star-assets");
    expect(starAssets?.ok).toBe(false);
    expect(starAssets?.detail).toMatch(/docs\/handover\/02/);
  });

  it("processes every managed README of one repository with --repo", async () => {
    current = buildFakeRepos();
    const repos = current;
    const promptRoot = join(repos.dir, "dsh-prompt");

    const init = await run(["readme:init", "--repo", promptRoot]);
    expect(init.code).toBe(0);
    expect(init.stderr).toBe("");
    expect(init.stdout.trim().split("\n")).toHaveLength(2);
    expect(readFileSync(fakeReadmePath(repos, "dsh-prompt"), "utf8")).toContain(CONTACT_START);
    expect(readFileSync(fakeReadmePath(repos, "dsh-prompt", "docs/README.en.md"), "utf8")).toContain(
      CONTACT_START,
    );

    const check = await run(["readme:sync", "--check", "--repo", promptRoot]);
    expect(check.code).toBe(0);
    expect(check.stdout.match(/up to date/g)).toHaveLength(2);
  });

  it("rejects an unknown --repo directory and conflicting flags", async () => {
    current = buildFakeRepos();
    const repos = current;

    const unknown = await run(["readme:sync", "--repo", join(repos.dir, "not-a-repo")]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/is not a managed repository directory/);

    const withRoot = await run([
      "readme:sync",
      "--repo",
      join(repos.dir, "dsh-prompt"),
      "--root",
      repos.dir,
    ]);
    expect(withRoot.code).toBe(2);
    expect(withRoot.stderr).toMatch(/cannot be combined with "--root"/);

    const withRepos = await run([
      "readme:sync",
      "--repo",
      join(repos.dir, "dsh-prompt"),
      "--repos",
      repos.dir,
    ]);
    expect(withRepos.code).toBe(2);
    expect(withRepos.stderr).toMatch(/cannot be combined with "--repo"/);
  });

  it("rejects --repos combined with --root or --readme", async () => {
    current = buildFakeRepos();
    const repos = current;
    const both = await run(["readme:sync", "--repos", repos.dir, "--root", repos.dir]);
    expect(both.code).toBe(2);
    expect(both.stderr).toMatch(/cannot be combined with "--root"/);

    const readme = await run(["readme:sync", "--repos", repos.dir, "--readme", "README.md"]);
    expect(readme.code).toBe(2);
    expect(readme.stderr).toMatch(/do not pass --readme\/--self/);
  });
});
