/**
 * Evidence is the part of the report a person can audit later. Two properties
 * matter here and are easy to lose: an item's digest must describe the bytes that
 * were actually written, and a second item under the same name must never replace
 * the first — a run that quietly overwrote its own evidence would make a failure
 * disappear.
 */
import { describe, expect, it } from "vitest";

import { sha256Text } from "../contracts/identity";
import { evidenceRefs, createEvidenceStore } from "../evidence/store";
import { FakeClock, FakeFs } from "./support/fake-fs";

const ROOT = "C:\\Temp\\verify-work\\runs\\run-1\\evidence";

function storeFor() {
  const fs = new FakeFs("C:\\fixture-repo");
  const clock = new FakeClock("2026-11-01T21:00:00.000+08:00");
  return { fs, case: createEvidenceStore({ fs, root: ROOT, clock }) };
}

describe("evidence store", () => {
  it("writes text and JSON with bytes, digest and capture time", async () => {
    const { fs, case: store } = storeFor();

    const text = await store.recordText("environment", "node: 24.19.0\n", { note: "environment snapshot" });
    expect(text.ok).toBe(true);
    if (!text.ok) return;
    expect(text.value.kind).toBe("text");
    expect(text.value.path).toBe("environment.txt");
    expect(text.value.bytes).toBe("node: 24.19.0\n".length);
    expect(text.value.sha256).toBe(sha256Text("node: 24.19.0\n"));
    expect(text.value.note).toBe("environment snapshot");
    expect(text.value.capturedAt).toBe("2026-11-01T21:00:00.000+08:00");

    const json = await store.recordJson("declaration", { packageName: "fixture-plugin" });
    expect(json.ok).toBe(true);
    if (!json.ok) return;
    expect(json.value.kind).toBe("json");
    expect(json.value.path).toBe("declaration.json");
    expect(fs.readFileSync(`${ROOT}\\declaration.json`)).toContain("fixture-plugin");
  });

  it("never overwrites a same-named item: it appends -2, then -3", async () => {
    const { fs, case: store } = storeFor();

    const first = await store.recordText("command", "first output");
    const second = await store.recordText("command", "second output");
    const third = await store.recordText("command", "third output");
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;

    expect(first.value.path).toBe("command.txt");
    expect(second.value.path).toBe("command-2.txt");
    expect(third.value.path).toBe("command-3.txt");
    expect(fs.readFileSync(`${ROOT}\\command.txt`)).toBe("first output");
    expect(fs.readFileSync(`${ROOT}\\command-2.txt`)).toBe("second output");
    expect(store.items()).toHaveLength(3);
  });

  it("keeps the two kinds apart even for the same stem", async () => {
    const { case: store } = storeFor();

    const text = await store.recordText("snapshot", "plain text");
    const json = await store.recordJson("snapshot", { a: 1 });
    expect(text.ok && json.ok).toBe(true);
    if (!text.ok || !json.ok) return;
    expect(text.value.path).toBe("snapshot.txt");
    expect(json.value.path).toBe("snapshot.json");
  });

  it("refuses an unsafe stem instead of writing outside the evidence root", async () => {
    const { case: store } = storeFor();

    for (const stem of ["../escape", "with space", "", "a/b"]) {
      const result = await store.recordText(stem, "x");
      expect(result.ok, stem).toBe(false);
    }
    expect(store.items()).toHaveLength(0);
  });

  it("trims the full items to the references a check result carries", async () => {
    const { case: store } = storeFor();

    const item = await store.recordText("environment", "env");
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(evidenceRefs(store.items())).toEqual([
      { path: "environment.txt", sha256: item.value.sha256, kind: "text" },
    ]);
  });

  it("honours a pinned capture time and a custom kind", async () => {
    const { case: store } = storeFor();

    const result = await store.recordText("stdout", "out", { kind: "command", capturedAt: "2026-01-01T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("command");
    expect(result.value.capturedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
