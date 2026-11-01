/**
 * Freeze tests: a scripted git/npm machine, no real build, no network, no home.
 *
 * Every case drives the command layer the same way the CLI will, so the tests
 * cover flags, exit codes and the single-JSON stdout rule as well as the
 * manifest itself. The fixture's `npm pack` writes a real gzip/ustar tarball
 * into the fake filesystem, which means the reader is exercised on the same
 * bytes a candidate would carry.
 */
import { describe, expect, it } from "vitest";

import { parseArgs } from "../cli/args";
import { runFreezeCommand } from "../cli/commands/freeze";
import {
  parseCandidateManifest,
  type CandidateManifest,
} from "../contracts/candidate-rules";
import { digestOfFiles, sha256Bytes } from "../contracts/identity";
import { ok } from "../contracts/result";
import { joinFsPath, parentPath, toPosixPath } from "../runtime/paths";
import { captureIo } from "./support/fake-capture";
import { FIXTURE_HEAD, FakeFreezeWorld, type FakeFreezeOptions } from "./support/fake-freeze";

const SECOND_HEAD = "fedcba9876543210fedcba9876543210fedcba98";

interface FreezeJson {
  readonly schemaVersion: number;
  readonly command: string;
  readonly ok: boolean;
  readonly candidate?: CandidateManifest;
  readonly candidatePath?: string;
  readonly candidateSha256?: string;
  readonly entry?: CandidateManifest["entry"];
  readonly notes?: readonly string[];
  readonly changes?: {
    readonly previous: { readonly path: string; readonly sha256: string; readonly dir: string };
    readonly added: readonly string[];
    readonly changed: readonly { readonly path: string; readonly previousSha256: string; readonly sha256: string }[];
    readonly removed: readonly string[];
  } | null;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly hint?: string;
    readonly stage: string;
  };
}

interface RunResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly json: FreezeJson | null;
}

async function runFreeze(world: FakeFreezeWorld, argv: readonly string[] = []): Promise<RunResult> {
  const capture = captureIo();
  const args = parseArgs(["freeze", ...argv]);
  const code = await runFreezeCommand(args, {
    ports: world.ports,
    io: capture.io,
    runtime: { nodeVersion: "22.6.0" },
    loadDeclaration: async () => ok(world.declaration),
  });
  const out = capture.stdout();
  let json: FreezeJson | null = null;
  if (out.trim().length > 0) {
    try {
      json = JSON.parse(out) as FreezeJson;
    } catch {
      json = null;
    }
  }
  return { code, out, err: capture.stderr(), json };
}

function expectOneJson(result: RunResult): FreezeJson {
  expect(result.out.trim().length).toBeGreaterThan(0);
  expect(result.out.trim().split("\n")).toHaveLength(1);
  expect(result.json).not.toBeNull();
  return result.json as FreezeJson;
}

function candidatePathOf(json: FreezeJson): string {
  const path = json.candidatePath;
  expect(path).toBeDefined();
  return path as string;
}

function candidateDirOf(json: FreezeJson): string {
  const dir = parentPath(candidatePathOf(json));
  expect(dir).not.toBeNull();
  return dir as string;
}

function defaultPack(world: FakeFreezeWorld, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "package.json": `${JSON.stringify({ name: world.packageName, version: world.version }, null, 2)}\n`,
    [world.clientEntry]: `/*! ${world.packageName} v${world.version} */\nmodule.exports = {};\n`,
    ...extra,
  };
}

function worldWith(options: FakeFreezeOptions = {}): FakeFreezeWorld {
  return new FakeFreezeWorld(options);
}

describe("dsh-verify freeze", () => {
  it("freezes a clean tree into a complete, canonical candidate", async () => {
    const world = worldWith();
    const longPath = `dist/${"a".repeat(120)}.js`;
    const buildLine = `export const DSW_BUILD_COMMIT = "${FIXTURE_HEAD}";`;
    world.packFiles = defaultPack(world, {
      "dist/old.js": "old\n",
      [longPath]: "long\n",
      [world.clientEntry]: `/*! ${world.packageName} v${world.version} */\n${buildLine}\n`,
    });

    const result = await runFreeze(world, ["--json"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    expect(json.schemaVersion).toBe(1);
    expect(json.command).toBe("freeze");
    expect(json.ok).toBe(true);
    const candidate = json.candidate as CandidateManifest;
    expect(candidate.schemaVersion).toBe(2);
    expect(candidate.tool).toBeTruthy();
    expect(candidate.version).toBe(world.version);
    expect(candidate.validity).toBe("release");
    expect(candidate.sourceStable).toBe(true);
    expect(candidate.git.commit).toBe(FIXTURE_HEAD);
    expect(candidate.git.branch).toBe("feat/fixture");
    expect(candidate.git.dirty).toBe(false);
    expect(candidate.git.dirtyFiles).toEqual([]);
    expect(candidate.package.buildCommit).toBe(FIXTURE_HEAD);
    expect(candidate.entry).toEqual({
      clientEntry: world.clientEntry,
      foundPackageName: world.packageName,
      foundVersion: world.version,
      status: "ok",
      sha256: sha256Bytes(Buffer.from(world.packFiles[world.clientEntry] as string)),
    });

    expect(candidate.package.fileCount).toBe(candidate.package.files.length);
    const expectedDigest = digestOfFiles(candidate.package.files);
    expect(expectedDigest.ok).toBe(true);
    if (expectedDigest.ok) expect(candidate.package.fileDigest).toBe(expectedDigest.value);
    expect(candidate.package.files.map((file) => file.path)).toContain(longPath);
    expect(candidate.package.files.map((file) => file.path)).toEqual(
      [...candidate.package.files.map((file) => file.path)].sort(),
    );
    expect(candidate.package.manifestDigest).toMatch(/^[0-9a-f]{64}$/);

    const dir = candidateDirOf(json);
    expect(parentPath(candidate.package.tgzPath)).toBe(dir);
    expect(candidate.package.filename).toBe(`${world.packageName}-${world.version}.tgz`);
    const bytes = await world.fs.readBytes(candidate.package.tgzPath);
    expect(bytes.ok).toBe(true);
    if (bytes.ok) {
      expect(candidate.package.tgzBytes).toBe(bytes.value.byteLength);
      expect(candidate.package.tgzSha256).toBe(sha256Bytes(bytes.value));
    }
    expect(json.candidateSha256).toBe(await world.fs.hashFile(candidatePathOf(json)).then((r) => (r.ok ? r.value : "")));

    const written = world.fs.readJsonSync(joinFsPath(dir, "candidate.json"));
    const parsed = parseCandidateManifest(written);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.package.files).toEqual(candidate.package.files);

    expect(dir).toMatch(new RegExp(`^${world.cwd.replace(/\\/g, "/")}/\.scratch/verify/candidates/${FIXTURE_HEAD.slice(0, 12)}-\\d{8}T\\d{6}$`));

    const build = world.command.requests.find((request) =>
      request.argv.some((argument) => argument.includes("npm run build")),
    );
    expect(build).toBeDefined();
    expect(build?.env?.DSW_BUILD_COMMIT).toBe(FIXTURE_HEAD);
  });

  it("rejects a dirty tree without --allow-dirty and writes nothing", async () => {
    const world = worldWith({ dirtyFiles: ["src/dirty.ts"] });
    const result = await runFreeze(world, ["--json"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("git");
    expect(json.error?.hint).toContain("--allow-dirty");
    expect(await world.fs.exists(joinFsPath(world.cwd, ".scratch", "verify", "candidates"))).toBe(false);
  });

  it("marks a dirty tree with --allow-dirty as development", async () => {
    const world = worldWith({ dirtyFiles: ["src/dirty.ts"] });
    const result = await runFreeze(world, ["--json", "--allow-dirty"]);
    expect(result.code).toBe(0);
    const json = expectOneJson(result);
    expect(json.ok).toBe(true);
    const candidate = json.candidate as CandidateManifest;
    expect(candidate.validity).toBe("development");
    expect(candidate.sourceStable).toBe(true);
    expect(candidate.git.dirty).toBe(true);
    expect(candidate.git.dirtyFiles).toEqual(["src/dirty.ts"]);
  });

  it("refuses when HEAD changes while the package is built", async () => {
    const world = worldWith();
    world.headSequence = [FIXTURE_HEAD, SECOND_HEAD];
    const result = await runFreeze(world, ["--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("git");
    expect(json.error?.message).toContain("候选说不清从哪份源码做出来的");
    const root = joinFsPath(world.cwd, ".scratch", "verify", "candidates");
    expect(await world.fs.exists(root)).toBe(true);
    expect(world.fs.children(root)).toEqual([]);
  });

  it("records sourceStable=false when the dirty set changes mid-freeze", async () => {
    const world = worldWith();
    world.dirtySequence = [[], ["src/late.ts"]];
    const result = await runFreeze(world, ["--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("git");
    const candidate = json.candidate as CandidateManifest;
    expect(candidate.sourceStable).toBe(false);
    expect(await world.fs.exists(candidatePathOf(json))).toBe(true);
  });

  it("lists added, changed and removed files on a repeat freeze", async () => {
    const world = worldWith();
    world.packFiles = defaultPack(world, { "dist/old.js": "old\n" });
    const first = await runFreeze(world, ["--json"]);
    expect(first.code).toBe(0);
    const firstJson = expectOneJson(first);
    const firstCandidate = firstJson.candidate as CandidateManifest;

    world.clock.advance(1_000);
    world.packFiles = {
      "package.json": `${JSON.stringify({ name: world.packageName, version: world.version }, null, 2)}\n`,
      [world.clientEntry]: `/*! ${world.packageName} v${world.version} */\nmodule.exports = { changed: true };\n`,
      "dist/new.js": "new\n",
    };
    const second = await runFreeze(world, ["--json"]);
    expect(second.code).toBe(0);
    const secondJson = expectOneJson(second);
    expect(secondJson.changes).not.toBeNull();
    expect(secondJson.changes?.previous.path).toBe(candidatePathOf(firstJson));
    expect(toPosixPath(secondJson.changes?.previous.dir ?? "")).toBe(toPosixPath(candidateDirOf(firstJson)));
    expect(secondJson.changes?.added).toEqual(["dist/new.js"]);
    expect(secondJson.changes?.removed).toEqual(["dist/old.js"]);
    expect(secondJson.changes?.changed.map((item) => item.path)).toEqual([world.clientEntry]);
    expect(secondJson.changes?.changed[0]?.previousSha256).toBe(
      firstCandidate.package.files.find((file) => file.path === world.clientEntry)?.sha256,
    );

    const human = await runFreeze(world, []);
    expect(human.code).toBe(0);
    expect(toPosixPath(human.out)).toContain(toPosixPath(candidateDirOf(secondJson)));
  });

  it("blocks, with a note, when the packaged client entry is missing", async () => {
    const world = worldWith();
    world.packFiles = {
      "package.json": `${JSON.stringify({ name: world.packageName, version: world.version }, null, 2)}\n`,
      "README.md": "no client entry here\n",
    };
    const result = await runFreeze(world, ["--json"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("entry");
    expect(json.candidate?.entry?.status).toBe("blocked");
    expect(json.candidate?.entry?.foundPackageName).toBeNull();
    expect(json.candidate?.entry?.foundVersion).toBeNull();
    expect(json.candidate?.entry?.sha256).toBeNull();
    expect(json.notes?.join("\n")).toContain(world.clientEntry);
  });

  it("rejects a client entry whose name or version disagrees with the package", async () => {
    const world = worldWith();
    world.packFiles = defaultPack(world, {
      [world.clientEntry]: `/*! other-plugin v${world.version} */\nmodule.exports = {};\n`,
    });
    const result = await runFreeze(world, ["--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.code).toBe("identity-mismatch");
    expect(json.error?.stage).toBe("entry");
    const root = joinFsPath(world.cwd, ".scratch", "verify", "candidates");
    expect(world.fs.children(root)).toEqual([]);
  });

  it("rejects a build commit that is not the frozen commit", async () => {
    const world = worldWith();
    world.packFiles = defaultPack(world, {
      [world.clientEntry]:
        `/*! ${world.packageName} v${world.version} */\nexport const DSW_BUILD_COMMIT = "${SECOND_HEAD}";\n`,
    });
    const result = await runFreeze(world, ["--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("entry");
    expect(json.error?.message).toContain(SECOND_HEAD);
  });

  it("rejects npm pack output that is not exactly one package", async () => {
    const world = worldWith();
    world.packNames = ["one.tgz", "two.tgz"];
    const result = await runFreeze(world, ["--json"]);
    expect(result.code).toBe(1);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("pack");
    expect(json.error?.message).toContain("exactly one");
    const root = joinFsPath(world.cwd, ".scratch", "verify", "candidates");
    expect(world.fs.children(root)).toEqual([]);
  });

  it("honours --out and keeps the human summary on stdout", async () => {
    const world = worldWith();
    const human = await runFreeze(world, ["--out", "frozen-candidates"]);
    expect(human.code).toBe(0);
    expect(human.out).toContain("candidate 1.2.3 @ " + FIXTURE_HEAD);
    expect(human.out).toContain("sourceStable=true");
    expect(human.out).not.toContain("{");
    const expectedRoot = joinFsPath(world.cwd, "frozen-candidates");
    expect(human.out).toContain(expectedRoot);
    expect(world.fs.children(expectedRoot)).toHaveLength(1);
  });

  it("reports a usage error for a flag freeze does not implement", async () => {
    const world = worldWith();
    const result = await runFreeze(world, ["--json", "--keep"]);
    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("usage");
    expect(json.error?.message).toContain("--keep");
  });
});

describe("freeze --dry-run", () => {
  it("prints the same candidate plan without writing, building or packing", async () => {
    const world = worldWith();
    const result = await runFreeze(world, ["--dry-run", "--json"]);

    expect(result.code).toBe(0);
    const json = expectOneJson(result) as FreezeJson & {
      readonly dryRun?: boolean;
      readonly plan?: {
        readonly outDir: string;
        readonly candidateName: string;
        readonly candidateDir: string;
        readonly rootPackage: { readonly name: string; readonly version: string };
        readonly git: { readonly commit: string; readonly branch: string; readonly dirty: boolean };
        readonly build: { readonly argv: readonly string[] } | null;
        readonly pack: { readonly argv: readonly string[] };
        readonly previous: unknown;
      };
    };
    expect(json.dryRun).toBe(true);
    expect(json.plan?.rootPackage).toEqual({ name: world.packageName, version: world.version });
    expect(json.plan?.git.commit).toBe(FIXTURE_HEAD);
    expect(json.plan?.candidateName.startsWith(FIXTURE_HEAD.slice(0, 12))).toBe(true);
    expect(json.plan?.candidateDir.startsWith(json.plan.outDir)).toBe(true);
    expect(json.plan?.build?.argv.join(" ")).toContain("npm run build");
    expect(json.plan?.pack.argv).toContain("pack");
    expect(json.plan?.previous).toBeNull();

    expect(world.fs.writes).toEqual([]);
    expect(await world.fs.exists(json.plan?.outDir ?? "")).toBe(false);
    const sideEffects = world.command.requests.filter((request) => {
      const argv = request.argv.join(" ");
      return argv.includes(" pack ") || argv.includes("npm run build");
    });
    expect(sideEffects).toEqual([]);
  });

  it("refuses a dirty tree before writing anything", async () => {
    const world = worldWith({ dirtyFiles: ["src/changed.ts"] });
    const result = await runFreeze(world, ["--dry-run", "--json"]);

    expect(result.code).toBe(2);
    const json = expectOneJson(result);
    expect(json.ok).toBe(false);
    expect(json.error?.stage).toBe("git");
    expect(world.fs.writes).toEqual([]);
  });
});