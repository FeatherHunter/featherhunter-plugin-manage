/**
 * The evidence manifest is the part a later auditor reads instead of the run.
 * Three properties are load-bearing and easy to lose:
 *
 * - `candidate` comes from the command layer (the batch record), never from a
 *   free-form extra field. It is written last and reserved keys are skipped.
 * - items are append-only: a path already recorded keeps its hash forever, so a
 *   second add cannot silently replace evidence.
 * - the file is written atomically and is not replaced unless the caller says so;
 *   a half-written or hand-edited manifest fails at the boundary.
 */
import { describe, expect, it } from "vitest";

import { asEvidencePath, parseBatchName } from "../contracts/branding";
import type { EvidenceManifestItem } from "../contracts/evidence-contract";
import { sha256Text } from "../contracts/identity";
import {
  EVIDENCE_MANIFEST_FILENAME,
  buildEvidenceManifest,
  loadEvidenceManifest,
  mergeEvidenceManifest,
  validateEvidenceManifest,
  writeEvidenceManifest,
  type BuildEvidenceManifestInput,
  type EvidenceCheckLine,
} from "../evidence/manifest";
import { FakeFs } from "./support/fake-fs";

const ROOT = "C:/Temp/verify-work/batches/batch-1/evidence";
const ISO = "2026-11-01T21:00:00.000+08:00";
const MANIFEST_PATH = ROOT + "/" + EVIDENCE_MANIFEST_FILENAME;

function batchName(value: string) {
  const parsed = parseBatchName(value);
  if (!parsed.ok) throw new Error("unexpected invalid batch name: " + value);
  return parsed.value;
}

function evidenceItem(path: string, content: string): EvidenceManifestItem {
  return {
    kind: "file",
    path: asEvidencePath(path),
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256Text(content),
    capturedAt: ISO,
  };
}

function checkLine(name: string, ok: boolean): EvidenceCheckLine {
  return { name, ok, detail: "recorded by dsh-verify evidence add", recordedAt: ISO };
}

function baseInput(overrides: Partial<BuildEvidenceManifestInput> = {}): BuildEvidenceManifestInput {
  return {
    generatedAt: ISO,
    batch: {
      name: batchName("batch-1"),
      dir: "C:/Temp/verify-work/batches/batch-1",
      root: "C:/Temp/verify-work",
    },
    meta: {},
    summary: {},
    checks: [],
    items: [],
    ...overrides,
  };
}

describe("evidence manifest", () => {
  it("writes the injected candidate last and never lets extra shadow a reserved field", () => {
    const input = baseInput({
      items: [evidenceItem("files/alpha.txt", "alpha")],
      checks: [checkLine("environment", true)],
      candidate: { commit: "abc1234" },
      extra: {
        candidate: { commit: "deadbeef" },
        items: "hijacked",
        checks: ["hijacked"],
        custom: { note: "kept" },
      },
    });

    const manifest = buildEvidenceManifest(input);
    expect(manifest.candidate).toEqual({ commit: "abc1234" });
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]?.path).toBe("files/alpha.txt");
    expect(manifest.checks).toEqual([checkLine("environment", true)]);

    const record = manifest as unknown as Record<string, unknown>;
    expect(record.custom).toEqual({ note: "kept" });
    const keys = Object.keys(record);
    expect(keys[keys.length - 1]).toBe("candidate");
  });

  it("validates a built manifest and rejects corrupt fields", () => {
    const manifest = buildEvidenceManifest(
      baseInput({
        items: [evidenceItem("files/alpha.txt", "alpha")],
        candidate: { commit: "abc1234" },
      }),
    );

    const valid = validateEvidenceManifest(manifest);
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value.items).toHaveLength(1);

    const badSchema = validateEvidenceManifest({ ...manifest, schemaVersion: 2 });
    expect(badSchema.ok).toBe(false);
    if (!badSchema.ok) expect(badSchema.error.code).toBe("invalid-input");

    const badPath = validateEvidenceManifest({
      ...manifest,
      items: [{ ...manifest.items[0], path: "../escape" }],
    });
    expect(badPath.ok).toBe(false);

    const badCandidate = validateEvidenceManifest({ ...manifest, candidate: "abc1234" });
    expect(badCandidate.ok).toBe(false);
  });

  it("writes exactly once, then refuses to replace unless asked", async () => {
    const fs = new FakeFs("C:/fake/repo");
    const manifest = buildEvidenceManifest(baseInput({ items: [evidenceItem("files/alpha.txt", "alpha")] }));

    const first = await writeEvidenceManifest({ fs, evidenceRoot: ROOT, manifest });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.content.endsWith("\n")).toBe(true);
    expect(first.value.manifestSha256).toBe(sha256Text(first.value.content));
    expect(fs.readFileSync(MANIFEST_PATH)).toBe(first.value.content);
    expect(fs.readJsonSync(MANIFEST_PATH)).toEqual(manifest);

    const second = await writeEvidenceManifest({ fs, evidenceRoot: ROOT, manifest });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("conflict");

    const replacement = buildEvidenceManifest(baseInput({ generatedAt: "2026-11-01T22:00:00.000+08:00" }));
    const replaced = await writeEvidenceManifest({ fs, evidenceRoot: ROOT, manifest: replacement, replace: true });
    expect(replaced.ok).toBe(true);
    if (replaced.ok) expect(fs.readJsonSync(MANIFEST_PATH)).toEqual(replacement);
  });

  it("loads null before the first write and rejects a hand-edited manifest", async () => {
    const fs = new FakeFs("C:/fake/repo");

    const missing = await loadEvidenceManifest(fs, ROOT);
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.value).toBeNull();

    const manifest = buildEvidenceManifest(baseInput({ items: [evidenceItem("files/alpha.txt", "alpha")] }));
    const written = await writeEvidenceManifest({ fs, evidenceRoot: ROOT, manifest });
    expect(written.ok).toBe(true);

    const loaded = await loadEvidenceManifest(fs, ROOT);
    expect(loaded.ok).toBe(true);
    if (loaded.ok && loaded.value !== null) {
      expect(loaded.value.manifest).toEqual(manifest);
      expect(loaded.value.manifestSha256).toBe(sha256Text(loaded.value.content));
    }

    fs.seedFile(MANIFEST_PATH, '{"schemaVersion":1}');
    const corrupt = await loadEvidenceManifest(fs, ROOT);
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.code).toBe("invalid-input");
  });

  it("merges new items and checks without replacing what was already recorded", () => {
    const existing = buildEvidenceManifest(
      baseInput({
        items: [evidenceItem("files/alpha.txt", "alpha")],
        checks: [checkLine("environment", true)],
        candidate: { commit: "abc1234" },
        meta: { stage: "first" },
      }),
    );

    const merged = mergeEvidenceManifest(
      existing,
      baseInput({
        generatedAt: "2026-11-01T22:00:00.000+08:00",
        items: [evidenceItem("files/beta.txt", "beta"), evidenceItem("files/alpha.txt", "alpha")],
        checks: [checkLine("screenshot", false)],
        candidate: { commit: "abc1234" },
        meta: { stage: "second" },
        extra: { custom: { note: "kept" } },
      }),
    );

    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.items.map((item) => item.path)).toEqual(["files/alpha.txt", "files/beta.txt"]);
    expect(merged.value.checks).toHaveLength(2);
    expect(merged.value.meta.stage).toBe("second");
    expect(merged.value.generatedAt).toBe("2026-11-01T22:00:00.000+08:00");
    expect(merged.value.candidate).toEqual({ commit: "abc1234" });
    expect((merged.value as unknown as Record<string, unknown>).custom).toEqual({ note: "kept" });
  });

  it("refuses a second, different payload for a path already recorded", () => {
    const existing = buildEvidenceManifest(baseInput({ items: [evidenceItem("files/alpha.txt", "alpha")] }));

    const conflict = mergeEvidenceManifest(
      existing,
      baseInput({ items: [evidenceItem("files/alpha.txt", "ALPHA")] }),
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe("conflict");
      expect(conflict.error.details?.path).toBe("files/alpha.txt");
    }
  });

  it("cannot change an already recorded candidate", () => {
    const existing = buildEvidenceManifest(baseInput({ candidate: { commit: "abc1234" } }));

    const same = mergeEvidenceManifest(existing, baseInput({ candidate: { commit: "abc1234" } }));
    expect(same.ok).toBe(true);

    const changed = mergeEvidenceManifest(existing, baseInput({ candidate: { commit: "deadbeef" } }));
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.error.code).toBe("identity-mismatch");
  });

  it("refuses to merge evidence from another batch", () => {
    const existing = buildEvidenceManifest(baseInput());

    const otherName = mergeEvidenceManifest(
      existing,
      baseInput({
        batch: {
          name: batchName("batch-2"),
          dir: "C:/Temp/verify-work/batches/batch-2",
          root: "C:/Temp/verify-work",
        },
      }),
    );
    expect(otherName.ok).toBe(false);
    if (!otherName.ok) expect(otherName.error.code).toBe("invalid-input");

    const otherDir = mergeEvidenceManifest(
      existing,
      baseInput({
        batch: {
          name: batchName("batch-1"),
          dir: "C:/Temp/elsewhere/batch-1",
          root: "C:/Temp/verify-work",
        },
      }),
    );
    expect(otherDir.ok).toBe(false);
  });
});
