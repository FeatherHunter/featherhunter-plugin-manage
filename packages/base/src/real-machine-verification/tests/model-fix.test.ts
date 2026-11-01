/**
 * In-process tests for `dsh-verify model` and its `--fix` path.
 *
 * Every case runs the real command module over a fake machine: the patch layer is
 * FakeFs text, the credential is a canary in FakeEnv, and no process, network or
 * real home is touched. The assertions are about what a caller can observe —
 * exit code, stdout/stderr split, the exact bytes on disk, and the JSON document.
 */
import { describe, expect, it } from "vitest";

import { parseArgs } from "../cli/args";
import { runModelCommand } from "../cli/commands/model";
import { ok } from "../contracts/result";
import {
  MODEL_ID,
  MODEL_KEY_ENV,
  MODEL_PATCH_PATH,
  MODEL_PROVIDER,
  MODEL_SECRET_CANARY,
  conformingPatch,
  createModelFixture,
  mismatchedPatch,
  missingApiKeyEnvPatch,
  missingDefaultEntryPatch,
  missingProviderEntryPatch,
  type ModelFixture,
} from "./support/fake-model";
import { captureIo } from "./support/fake-capture";

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function runModel(fixture: ModelFixture, argv: readonly string[]): Promise<Run> {
  const capture = captureIo();
  const code = await runModelCommand(parseArgs(["model", ...argv]), {
    ports: fixture.ports,
    io: capture.io,
    runtime: fixture.runtime,
    loadDeclaration: fixture.loadDeclaration,
  });
  return { code, out: capture.stdout(), err: capture.stderr() };
}

interface ProblemJson {
  readonly code: string;
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly entryId?: string;
}

interface StateJson {
  readonly configured: boolean;
  readonly defaultProvider: string | null;
  readonly defaultModel: string | null;
  readonly apiKeyEnv: string | null;
  readonly declaredModels: readonly string[];
  readonly problems: readonly ProblemJson[];
}

interface CheckJson {
  readonly id: string;
  readonly status: "ok" | "fail" | "skip" | "blocked";
  readonly detail: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly hint?: string;
}

interface ModelJson {
  readonly schemaVersion: number;
  readonly command: string;
  readonly ok: boolean;
  readonly profile: string;
  readonly patchPath: string;
  readonly selection: { readonly provider: string; readonly model: string; readonly apiKeyEnv: string };
  readonly before: StateJson | null;
  readonly after: StateJson | null;
  readonly checks: readonly CheckJson[];
  readonly credential: {
    readonly ref: string;
    readonly available: boolean;
    readonly source: string | null;
    readonly storePath: string;
    readonly note?: string;
  } | null;
  readonly fix: {
    readonly requested: boolean;
    readonly changed: boolean;
    readonly written: boolean;
    readonly notes: readonly string[];
    readonly error: unknown;
  };
}

function oneJson<T>(out: string): T {
  const lines = out.split("\n").filter((line) => line.length > 0);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] ?? "") as T;
}

function check(doc: ModelJson, id: string): CheckJson | undefined {
  return doc.checks.find((item) => item.id === id);
}

/** Line indexes that differ between two equal-length texts. */
function differingLines(before: string, after: string): number[] {
  const left = before.split("\n");
  const right = after.split("\n");
  expect(right).toHaveLength(left.length);
  const changed: number[] = [];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) changed.push(index);
  }
  return changed;
}

describe("model command, read-only", () => {
  it("reports each mismatch and writes nothing", async () => {
    const patch = mismatchedPatch();
    const fixture = createModelFixture({ patch });
    const beforeStat = await fixture.fs.stat(MODEL_PATCH_PATH);

    const result = await runModel(fixture, []);

    expect(result.code).toBe(1);
    expect(fixture.fs.writes).toEqual([]);
    expect(fixture.fs.readFileSync(MODEL_PATCH_PATH)).toBe(patch);
    const afterStat = await fixture.fs.stat(MODEL_PATCH_PATH);
    expect(afterStat.ok && beforeStat.ok ? afterStat.value.mtimeMs : -1).toBe(
      beforeStat.ok ? beforeStat.value.mtimeMs : -2,
    );

    expect(result.out).toContain("ok model-default-provider");
    expect(result.out).toContain("fail model-default-model");
    expect(result.out).toContain("fail model-credential-ref");
    expect(result.out).toContain("ok model-declared-models");
    expect(result.out).toContain("fail model-reference-model");
    expect(result.out).toContain("expected " + MODEL_ID);
    expect(result.out).toContain("actual M3.1-Flash");
    expect(result.err).toContain("dsh-verify model: profile desktop");
    expect(result.err).toContain("patch " + MODEL_PATCH_PATH);
  });

  it("emits one JSON document and keeps the human lines on stderr", async () => {
    const fixture = createModelFixture({ patch: mismatchedPatch() });

    const result = await runModel(fixture, ["--json"]);

    expect(result.code).toBe(1);
    const doc = oneJson<ModelJson>(result.out);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.command).toBe("model");
    expect(doc.ok).toBe(false);
    expect(doc.profile).toBe("desktop");
    expect(doc.patchPath).toBe(MODEL_PATCH_PATH);
    expect(doc.selection).toEqual({
      provider: MODEL_PROVIDER,
      model: MODEL_ID,
      apiKeyEnv: MODEL_KEY_ENV,
    });
    expect(doc.before?.configured).toBe(false);
    expect(doc.before?.problems.map((problem) => problem.code)).toEqual(
      expect.arrayContaining(["model-mismatch", "api-key-env-mismatch", "reference-model-mismatch"]),
    );
    expect(doc.after).toBeNull();
    expect(doc.fix.requested).toBe(false);
    expect(doc.fix.written).toBe(false);
    expect(doc.credential?.available).toBe(true);
    expect(doc.credential?.source).toBe("env");
    expect(doc.credential?.ref).toBe(MODEL_KEY_ENV);

    // Exactly one JSON document on stdout; the ok/fail lines are stderr-only here.
    expect(result.err).toContain("fail model-default-model");
    expect(result.err).toContain("ok model-default-provider");
    expect(result.out).not.toContain("fail model-default-model");
    expect(result.out).not.toContain(MODEL_SECRET_CANARY);
    expect(result.err).not.toContain(MODEL_SECRET_CANARY);
    expect(doc.credential?.note ?? "").not.toContain(MODEL_SECRET_CANARY);
  });

  it("blocks an unreadable patch layer without creating it", async () => {
    const fixture = createModelFixture({ patch: null });

    const result = await runModel(fixture, ["--json"]);

    expect(result.code).toBe(2);
    expect(fixture.fs.writes).toEqual([]);
    expect(await fixture.fs.exists(MODEL_PATCH_PATH)).toBe(false);
    const doc = oneJson<ModelJson>(result.out);
    expect(doc.ok).toBe(false);
    expect(doc.before).toBeNull();
    expect(doc.checks[0]?.id).toBe("model-patch");
    expect(doc.checks[0]?.status).toBe("blocked");
    expect(doc.checks[0]?.hint).toContain("open the profile once");
  });
});

describe("model command, --fix", () => {
  it("writes nothing when the patch already conforms", async () => {
    const patch = conformingPatch();
    const fixture = createModelFixture({ patch });
    const before = await fixture.fs.stat(MODEL_PATCH_PATH);

    const result = await runModel(fixture, ["--fix", "--json"]);

    expect(result.code).toBe(0);
    expect(fixture.fs.writes).toEqual([]);
    expect(fixture.fs.readFileSync(MODEL_PATCH_PATH)).toBe(patch);
    const after = await fixture.fs.stat(MODEL_PATCH_PATH);
    expect(after.ok ? after.value.mtimeMs : -1).toBe(before.ok ? before.value.mtimeMs : -2);

    const doc = oneJson<ModelJson>(result.out);
    expect(doc.ok).toBe(true);
    expect(doc.fix.requested).toBe(true);
    expect(doc.fix.changed).toBe(false);
    expect(doc.fix.written).toBe(false);
    expect(doc.fix.notes).toEqual(["already conforming; nothing written"]);
    expect(check(doc, "model-fix")?.status).toBe("ok");
    expect(result.err).toContain("ok model-fix already conforming; nothing written");
  });

  it("adds a missing apiKeyEnv and leaves every other line byte-identical", async () => {
    const patch = missingApiKeyEnvPatch();
    const fixture = createModelFixture({ patch });

    const result = await runModel(fixture, ["--fix", "--json"]);

    expect(result.code).toBe(0);
    expect(fixture.fs.writes).toHaveLength(1);
    expect(fixture.fs.writes[0]?.op).toBe("writeText");
    const after = fixture.fs.readFileSync(MODEL_PATCH_PATH);

    const beforeLines = patch.split("\n");
    const afterLines = after.split("\n");
    expect(afterLines).toHaveLength(beforeLines.length + 1);
    const inserted = afterLines.findIndex((line, index) => line !== beforeLines[index]);
    expect(inserted).toBeGreaterThanOrEqual(0);
    expect(afterLines[inserted]).toBe(`        apiKeyEnv: ${MODEL_KEY_ENV}`);
    const restored = [...afterLines];
    restored.splice(inserted, 1);
    expect(restored).toEqual(beforeLines);

    // Comments and the unrelated entry survive verbatim.
    expect(after).toContain("# hand-written patch — comments must survive edits");
    expect(after).toContain("# reference parties repeat the id verbatim");
    expect(after).toContain('  name: "@fixture/theme-pack"');

    const doc = oneJson<ModelJson>(result.out);
    expect(doc.ok).toBe(true);
    expect(doc.fix.changed).toBe(true);
    expect(doc.fix.written).toBe(true);
    expect(doc.fix.notes.join(" ")).toContain("added apiKeyEnv");
    expect(doc.after?.configured).toBe(true);
    expect(check(doc, "model-credential-ref")?.status).toBe("ok");
    expect(check(doc, "model-recheck")?.status).toBe("ok");
  });

  it("aligns the default model id and the reference party, keeping comments", async () => {
    const patch = mismatchedPatch();
    const fixture = createModelFixture({ patch });

    const result = await runModel(fixture, ["--fix", "--json"]);

    expect(result.code).toBe(0);
    const after = fixture.fs.readFileSync(MODEL_PATCH_PATH);
    expect(after).toContain(`    model: ${MODEL_ID}`);
    expect(after).toContain(`        model: ${MODEL_ID} # keep this comment`);
    expect(after).not.toContain("model: M3.1-Flash");
    expect(after).toContain("apiKeyEnv: " + MODEL_KEY_ENV);
    expect(after).toContain("# hand-written patch — comments must survive edits");

    // Only the three wrong lines changed; the unrelated entry is untouched.
    const changed = differingLines(patch, after);
    expect(changed).toHaveLength(3);
    expect(after.split("\n")[changed[0] ?? -1]).toContain(MODEL_ID);

    const doc = oneJson<ModelJson>(result.out);
    expect(doc.ok).toBe(true);
    expect(doc.after?.configured).toBe(true);
    expect(doc.after?.problems).toEqual([]);
    expect(doc.fix.notes.join("; ")).toContain("aligned vision-router reference model id");
    expect(check(doc, "model-reference-model")?.status).toBe("ok");
  });

  it("refuses to invent a missing llm-pi-ai entry", async () => {
    const patch = missingProviderEntryPatch();
    const fixture = createModelFixture({ patch });

    const result = await runModel(fixture, ["--fix"]);

    expect(result.code).toBe(2);
    expect(fixture.fs.writes).toEqual([]);
    expect(fixture.fs.readFileSync(MODEL_PATCH_PATH)).toBe(patch);
    expect(result.out).toContain("blocked model-provider-entry");
    expect(result.out).toContain("blocked model-fix");
    expect(result.out).toContain("enable the pi-ai provider");
  });

  it("refuses to invent a missing agent-default-model entry", async () => {
    const patch = missingDefaultEntryPatch();
    const fixture = createModelFixture({ patch });

    const result = await runModel(fixture, ["--fix"]);

    expect(result.code).toBe(2);
    expect(fixture.fs.writes).toEqual([]);
    expect(result.out).toContain("blocked model-default-entry");
    expect(result.out).toContain("open the profile once");
    expect(result.out).toContain("blocked model-fix");
  });

  it("exits 1 and names the item when re-inspection still fails", async () => {
    const fixture = createModelFixture({ patch: mismatchedPatch() });
    // The write "succeeds" but leaves the old bytes: the only way to exercise the
    // changed-but-not-fixed branch without a flaky filesystem.
    fixture.fs.writeText = async (path) => {
      fixture.fs.writes.push({ op: "writeText", path: fixture.fs.resolve(path) });
      return ok(undefined);
    };

    const result = await runModel(fixture, ["--fix", "--json"]);

    expect(result.code).toBe(1);
    expect(fixture.fs.writes).toHaveLength(1);
    expect(fixture.fs.readFileSync(MODEL_PATCH_PATH)).toBe(mismatchedPatch());
    const doc = oneJson<ModelJson>(result.out);
    expect(doc.ok).toBe(false);
    expect(doc.fix.changed).toBe(true);
    expect(doc.fix.written).toBe(true);
    const recheck = check(doc, "model-recheck");
    expect(recheck?.status).toBe("fail");
    expect(recheck?.detail).toContain("model-default-model");
    expect(recheck?.detail).toContain("model-credential-ref");
    expect(recheck?.expected).toBeDefined();
    expect(recheck?.actual).toBeDefined();
    expect(recheck?.hint).toBeDefined();
    expect(result.err).toContain("fail model-recheck");
  });

  it("blocks on a missing credential value and still writes nothing", async () => {
    const patch = conformingPatch();
    const fixture = createModelFixture({ patch, envValues: { [MODEL_KEY_ENV]: "" } });

    const result = await runModel(fixture, ["--fix", "--json"]);

    expect(result.code).toBe(2);
    expect(fixture.fs.writes).toEqual([]);
    const doc = oneJson<ModelJson>(result.out);
    expect(doc.ok).toBe(false);
    expect(doc.credential?.available).toBe(false);
    const credential = check(doc, "model-credential-value");
    expect(credential?.status).toBe("blocked");
    expect(credential?.hint).toContain(fixture.paths.dshHome);
    expect(result.err).toContain("blocked model-credential-value");
  });

  it("reads the credential ref only from the batch home store", async () => {
    const fixture = createModelFixture({
      patch: conformingPatch(),
      envValues: { [MODEL_KEY_ENV]: "" },
      credentials: `refs:\n  ${MODEL_KEY_ENV}: ${MODEL_SECRET_CANARY}\n`,
    });

    const result = await runModel(fixture, ["--json"]);

    expect(result.code).toBe(0);
    const doc = oneJson<ModelJson>(result.out);
    expect(doc.credential?.available).toBe(true);
    expect(doc.credential?.source).toBe("dsh-home");
    expect(result.out).not.toContain(MODEL_SECRET_CANARY);
  });
});

describe("model command, selection and usage", () => {
  it("takes the whole selection from flags when the declaration declares model: false", async () => {
    const fixture = createModelFixture({ patch: conformingPatch(), model: false });

    const missing = await runModel(fixture, ["--json"]);
    expect(missing.code).toBe(2);
    const failure = oneJson<{ ok: boolean; error: { code: string; stage: string; message: string } }>(missing.out);
    expect(failure.ok).toBe(false);
    expect(failure.error.stage).toBe("selection");
    expect(failure.error.message).toContain("--provider");

    const supplied = await runModel(fixture, [
      "--provider",
      MODEL_PROVIDER,
      "--model",
      MODEL_ID,
      "--api-key-env",
      MODEL_KEY_ENV,
      "--json",
    ]);
    expect(supplied.code).toBe(0);
    const doc = oneJson<ModelJson>(supplied.out);
    expect(doc.selection.provider).toBe(MODEL_PROVIDER);
    expect(doc.ok).toBe(true);
  });

  it("honours --profile and reports the patch path it actually read", async () => {
    const fixture = createModelFixture();
    const webPatch = missingApiKeyEnvPatch();
    fixture.fs.seedFile("C:\\fake-dsh-home\\profiles\\web\\cordis.patch.yml", webPatch);

    const result = await runModel(fixture, ["--profile", "web", "--json"]);

    expect(result.code).toBe(1);
    const doc = oneJson<ModelJson>(result.out);
    expect(doc.profile).toBe("web");
    expect(doc.patchPath).toBe("C:\\fake-dsh-home\\profiles\\web\\cordis.patch.yml");
    expect(doc.before?.apiKeyEnv).toBeNull();
  });

  it("rejects a flag that belongs to another command before reading anything", async () => {
    const fixture = createModelFixture();

    const result = await runModel(fixture, ["--fix", "--port", "53211", "--json"]);

    expect(result.code).toBe(2);
    expect(fixture.fs.writes).toEqual([]);
    expect(result.err).toContain("--port");
    const failure = oneJson<{ ok: boolean; error: { stage: string } }>(result.out);
    expect(failure.ok).toBe(false);
    expect(failure.error.stage).toBe("usage");
  });
});

describe("model --dry-run", () => {
  it("plans the --fix edit without touching the patch file", async () => {
    const fixture = createModelFixture({ patch: mismatchedPatch() });
    const before = fixture.fs.readFileSync(MODEL_PATCH_PATH);

    const result = await runModel(fixture, ["--dry-run", "--json", "--fix"]);

    expect(result.code).toBe(0);
    expect(result.err).toContain("dsh-verify model:");
    const doc = JSON.parse(result.out) as {
      readonly schemaVersion: number;
      readonly command: string;
      readonly dryRun?: boolean;
      readonly plan?: {
        readonly patchPath: string;
        readonly fixRequested: boolean;
        readonly wouldWrite: boolean;
        readonly current: { readonly configured: boolean; readonly problems: readonly unknown[] };
        readonly edit: { readonly changed: boolean; readonly notes: readonly string[]; readonly error: unknown };
        readonly credential: { readonly ref: string; readonly available: boolean };
        readonly checks: readonly { readonly id: string; readonly status: string }[];
      };
    };
    expect(doc.schemaVersion).toBe(1);
    expect(doc.command).toBe("model");
    expect(doc.dryRun).toBe(true);
    expect(doc.plan?.patchPath).toBe(MODEL_PATCH_PATH);
    expect(doc.plan?.fixRequested).toBe(true);
    expect(doc.plan?.current.configured).toBe(false);
    expect(doc.plan?.edit.changed).toBe(true);
    expect(doc.plan?.edit.error).toBeNull();
    expect(doc.plan?.edit.notes.length).toBeGreaterThan(0);
    expect(doc.plan?.wouldWrite).toBe(true);
    expect(doc.plan?.credential.ref).toBe(MODEL_KEY_ENV);
    expect(doc.plan?.credential.available).toBe(true);
    expect(doc.plan?.checks.find((check) => check.id === "model-default-model")?.status).toBe("fail");

    expect(fixture.fs.writes).toEqual([]);
    expect(fixture.fs.readFileSync(MODEL_PATCH_PATH)).toBe(before);
  });
});
