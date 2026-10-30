import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/node/cli";
import { fixtureContactRaw, makeTempDir } from "./readme-helpers";

const START = "<!-- CONTACT-START -->";
const END = "<!-- CONTACT-END -->";

function fakeReadme(contactRaw: string): string {
  return "# Demo plugin\n\nSome intro paragraph.\n\n" + contactRaw + "\n\n## Footer\n\nFooter text.\n";
}

function setup(readmeText: string): { dir: string; readmePath: string; cleanup: () => void } {
  const { dir, cleanup } = makeTempDir();
  const readmePath = join(dir, "README.md");
  writeFileSync(readmePath, readmeText, "utf8");
  return { dir, readmePath, cleanup };
}

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dsh-base CLI wiring", () => {
  it("keeps --help and --version", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    for (const needle of ["readme:init", "readme:sync", "--check", "--all", "--root"]) {
      expect(help.stdout, needle).toContain(needle);
    }

    const version = await run(["--version"]);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects unknown commands and options with exit code 2", async () => {
    expect((await run(["bogus:command"])).code).toBe(2);

    const missingValue = await run(["readme:sync", "--root"]);
    expect(missingValue.code).toBe(2);
    expect(missingValue.stderr).toMatch(/--root/);

    const unknownOption = await run(["readme:sync", "--bogus"]);
    expect(unknownOption.code).toBe(2);
    expect(unknownOption.stderr).toMatch(/--bogus/);

    const strayArgument = await run(["readme:sync", "extra"]);
    expect(strayArgument.code).toBe(2);
  });

  it("initializes a README and then reports it as up to date", async () => {
    const { dir, readmePath, cleanup } = setup(fakeReadme(fixtureContactRaw("deck")));
    try {
      const init = await run(["readme:init", "--root", dir]);
      expect(init.code).toBe(0);
      expect(init.stderr).toBe("");
      const markdown = readFileSync(readmePath, "utf8");
      expect(markdown).toContain(START);
      expect(markdown).toContain(END);
      expect(init.stdout).toContain("inserted");

      const clean = await run(["readme:sync", "--check", "--root", dir]);
      expect(clean.code).toBe(0);
      expect(clean.stdout).toContain("up to date");

      const repeat = await run(["readme:init", "--root", dir]);
      expect(repeat.code).toBe(0);
      expect(repeat.stdout).toContain("up to date");
    } finally {
      cleanup();
    }
  });

  it("returns nonzero for --check drift without writing", async () => {
    const { dir, readmePath, cleanup } = setup(fakeReadme(fixtureContactRaw("deck")));
    try {
      const before = readFileSync(readmePath, "utf8");
      const checked = await run(["readme:init", "--check", "--root", dir]);
      expect(checked.code).toBe(1);
      expect(checked.stderr).toContain("out of date");
      expect(readFileSync(readmePath, "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("returns nonzero with a clear message when the README is missing or unmarked", async () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const missing = await run(["readme:sync", "--root", dir]);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toMatch(/README not found/);

      writeFileSync(join(dir, "README.md"), fakeReadme(fixtureContactRaw("deck")), "utf8");
      const unmarked = await run(["readme:sync", "--root", dir]);
      expect(unmarked.code).toBe(1);
      expect(unmarked.stderr).toMatch(/readme:init/);
    } finally {
      cleanup();
    }
  });

  it("processes every --root with --all and keeps going after an error", async () => {
    const missing = makeTempDir();
    const first = setup(fakeReadme(fixtureContactRaw("deck")));
    const second = setup(fakeReadme(fixtureContactRaw("ilife")));
    try {
      const result = await run([
        "readme:init",
        "--all",
        "--root",
        missing.dir,
        "--root",
        first.dir,
        "--root",
        second.dir,
      ]);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/README not found/);
      expect(readFileSync(first.readmePath, "utf8")).toContain(START);
      expect(readFileSync(second.readmePath, "utf8")).toContain("## 反馈与联系");

      const ok = await run(["readme:sync", "--check", "--all", "--root", first.dir, "--root", second.dir]);
      expect(ok.code).toBe(0);
    } finally {
      missing.cleanup();
      first.cleanup();
      second.cleanup();
    }
  });

  it("defaults to the current directory when --root is omitted", async () => {
    const { dir, readmePath, cleanup } = setup(fakeReadme(fixtureContactRaw("deck")));
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      const result = await run(["readme:init"]);
      expect(result.code).toBe(0);
      expect(readFileSync(readmePath, "utf8")).toContain(START);
    } finally {
      process.chdir(cwd);
      cleanup();
    }
  });
});
