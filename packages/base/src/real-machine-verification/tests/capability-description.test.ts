/**
 * The capability description is a contract, not documentation.
 *
 * Three readers consume it: an agent calling `describe --json`, a human reading
 * `--help`, and the generated markdown that later becomes README/AGENTS-USAGE.
 * These tests pin the parts a caller can rely on — the fifteen command names, the
 * layer each one lives in, the built-in check ids and the exit codes — and prove
 * each of those three outputs is derived from the one description object rather
 * than from a second hand-written list.
 *
 * The check-id list is cross-checked against the source tree in both directions:
 * every advertised id must appear somewhere under this directory, and every
 * literal `checkId("…")` in the orchestration must be advertised. A list that
 * drifts from the code is how a ghost id reached `describe` once already.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { parseCheckId } from "../contracts/branding";
import { BUILT_IN_CHECK_IDS, EXIT_CODES, PROFILE_FIELDS, describeCapability } from "../capability-description";
import { IMPLEMENTED, main } from "../cli/main";

/**
 * The layer split fixed by the spec's "命令表面与可选择性" section. This list is
 * deliberately a literal: it is the contract the description has to match, so it
 * must not be computed from the description (that would make the test tautological).
 */
const SPEC_LAYERS: Readonly<Record<1 | 2, readonly string[]>> = {
  1: ["self-check", "single-instance", "concurrent", "freeze", "batch", "evidence", "run", "cleanup", "describe"],
  2: ["launch", "stop", "isolation", "model", "install", "skills"],
};

/** Capture stdout/stderr while `main()` runs, the way the doctor tests do. */
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
  try {
    const code = await main(argv);
    return { code, stdout: out.join(""), stderr: err.join("") };
  } finally {
    vi.restoreAllMocks();
  }
}

describe("describe --json", () => {
  it("prints exactly one JSON document on stdout and exits 0", async () => {
    const { code, stdout, stderr } = await run(["describe", "--json"]);

    expect(code).toBe(EXIT_CODES.ok);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).toBeTypeOf("object");
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "builtInCheckIds",
        "capability",
        "commands",
        "docs",
        "exitCodes",
        "globalFlags",
        "layers",
        "profileFields",
        "schemaVersion",
        "summary",
      ].sort(),
    );
    expect(parsed["capability"]).toBe("real-machine-verification");
    expect(parsed["schemaVersion"]).toBe(1);
    expect(typeof parsed["summary"]).toBe("string");
    expect((parsed["summary"] as string).length).toBeGreaterThan(0);
    expect(parsed["exitCodes"]).toEqual(EXIT_CODES);
    expect(parsed["builtInCheckIds"]).toEqual([...BUILT_IN_CHECK_IDS]);
    expect(parsed["profileFields"]).toEqual([...PROFILE_FIELDS]);
    expect(Array.isArray(parsed["commands"])).toBe(true);
    expect(Array.isArray(parsed["globalFlags"])).toBe(true);
    expect(parsed["docs"]).toEqual({ readme: "README.md", agentUsage: "AGENTS-USAGE.md" });
  });

  it("serialises exactly the description object: nothing added, nothing lost", async () => {
    // `describe --json` is `JSON.stringify(describeCapability())`; deep equality is
    // what makes "one source of truth" checkable instead of aspirational.
    const { stdout } = await run(["describe", "--json"]);
    expect(JSON.parse(stdout)).toEqual(JSON.parse(JSON.stringify(describeCapability())));
  });
});

describe("commands", () => {
  it("names each command once and gives every one a non-empty usage and summary", () => {
    const commands = describeCapability().commands;

    const names = commands.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    expect(commands).toHaveLength(15);
    for (const command of commands) {
      expect(command.usage.trim(), command.name).not.toBe("");
      expect(command.usage.startsWith(`dsh-verify ${command.name}`), command.name).toBe(true);
      expect(command.summary.trim(), command.name).not.toBe("");
      expect(command.writes.trim(), command.name).not.toBe("");
    }
  });

  it("contains exactly the fifteen commands the spec fixes", () => {
    const described = describeCapability()
      .commands.map((command) => command.name)
      .sort();
    expect(described).toEqual([...SPEC_LAYERS[1], ...SPEC_LAYERS[2]].sort());
  });

  it("puts each command in the layer the spec assigns it", () => {
    const byName = new Map(describeCapability().commands.map((command) => [command.name, command]));

    for (const [layer, names] of Object.entries(SPEC_LAYERS)) {
      for (const name of names) {
        const command = byName.get(name);
        expect(command, name).toBeDefined();
        expect(command?.layer, name).toBe(Number(layer));
      }
    }
    // Layers 1 and 2 are the documented model; layer 3 is the escape hatch.
    expect(describeCapability().layers.map((layer) => layer.layer)).toEqual([1, 2, 3]);
    for (const layer of describeCapability().layers) {
      expect(layer.audience.trim()).not.toBe("");
      expect(layer.use.trim()).not.toBe("");
    }
  });
});

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface SourceFile {
  readonly path: string;
  readonly source: string;
}

/** Every .ts file under the capability, minus its own tests. */
function sourceFiles(dir: string = SRC_ROOT): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === resolve(SRC_ROOT, "tests")) continue;
      out.push(...sourceFiles(path));
      continue;
    }
    if (entry.name.endsWith(".ts")) out.push({ path, source: readFileSync(path, "utf8") });
  }
  return out;
}

describe("built-in checks", () => {
  it("declares unique ids that all satisfy the check-id contract", () => {
    expect(BUILT_IN_CHECK_IDS).toHaveLength(22);
    expect(new Set(BUILT_IN_CHECK_IDS).size).toBe(BUILT_IN_CHECK_IDS.length);
    for (const id of BUILT_IN_CHECK_IDS) {
      const parsed = parseCheckId(id);
      expect(parsed.ok, id).toBe(true);
    }
  });

  it("advertises only ids the orchestration actually emits", () => {
    const files = sourceFiles().filter((file) => !file.path.endsWith("capability-description.ts"));
    expect(files.length).toBeGreaterThan(20);
    for (const id of BUILT_IN_CHECK_IDS) {
      const emitted = files.some((file) => file.source.includes(`"${id}"`));
      expect(emitted, `describe advertises ${id} but no source file emits it`).toBe(true);
    }
  });

  it("advertises every literal checkId() the orchestration constructs", () => {
    const files = sourceFiles().filter((file) => !file.path.endsWith("capability-description.ts"));
    const emitted = new Set<string>();
    for (const file of files) {
      for (const match of file.source.matchAll(/checkId\("([a-z0-9-]+)"\)/g)) {
        const id = match[1];
        if (id !== undefined) emitted.add(id);
      }
    }
    expect(emitted.size).toBeGreaterThan(10);
    for (const id of emitted) {
      expect(BUILT_IN_CHECK_IDS, `${id} is emitted but not advertised`).toContain(id);
    }
  });
});

describe("implemented commands", () => {
  it("implements exactly the commands the description owns, once every ticket has landed", () => {
    const described = describeCapability()
      .commands.map((command) => command.name)
      .sort();
    // The description is the contract and IMPLEMENTED is the truth; they must not
    // drift. A described command that is missing here exits 2 rather than pretend
    // to work, so this assertion is what keeps "documented" and "reachable" the
    // same set (spec: command surface).
    expect([...IMPLEMENTED].sort()).toEqual(described);
    expect(IMPLEMENTED.has("describe")).toBe(true);
    expect(IMPLEMENTED.has("self-check")).toBe(true);
  });
});
