/**
 * Evidence is the part of the report a person can audit later. Two properties
 * matter here and are easy to lose: an item's digest must describe the bytes that
 * were actually written, and a second item under the same name must never replace
 * the first — a run that quietly overwrote its own evidence would make a failure
 * disappear.
 */
import { describe, expect, it } from "vitest";

import { sha256Bytes, sha256Text } from "../contracts/identity";
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

  it("adopts a file that already exists under the root, hashing the bytes on disk", async () => {
    const { fs, case: store } = storeFor();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const absolute = `${ROOT}\\screenshots\\instance-pages.png`;
    fs.seedFile(absolute, bytes);

    const adopted = await store.recordFile(absolute, { note: "the adapter wrote this PNG" });
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) return;
    expect(adopted.value.kind).toBe("screenshot");
    expect(adopted.value.path).toBe("screenshots/instance-pages.png");
    expect(adopted.value.bytes).toBe(bytes.byteLength);
    expect(adopted.value.sha256).toBe(sha256Bytes(bytes));
    expect(adopted.value.capturedAt).toBe("2026-11-01T21:00:00.000+08:00");
    expect(adopted.value.note).toBe("the adapter wrote this PNG");
    expect(store.items()).toHaveLength(1);
  });

  it("names the kind from the extension but lets the caller override it", async () => {
    const { fs, case: store } = storeFor();
    fs.seedFile(`${ROOT}\\snapshot.json`, "{}");
    fs.seedFile(`${ROOT}\\trace.bin`, new Uint8Array([1, 2, 3]));

    const json = await store.recordFile(`${ROOT}\\snapshot.json`);
    const binary = await store.recordFile(`${ROOT}\\trace.bin`, { kind: "command" });
    expect(json.ok && binary.ok).toBe(true);
    if (!json.ok || !binary.ok) return;
    expect(json.value.kind).toBe("json");
    expect(binary.value.kind).toBe("command");
  });

  it("refuses a file outside the evidence root and a directory", async () => {
    const { fs, case: store } = storeFor();
    fs.seedFile("C:\\Temp\\elsewhere\\shot.png", new Uint8Array([1]));
    fs.seedDir(`${ROOT}\\shots`);

    const outside = await store.recordFile("C:\\Temp\\elsewhere\\shot.png");
    const escape = await store.recordFile(`${ROOT}\\..\\escape.png`);
    const directory = await store.recordFile(`${ROOT}\\shots`);
    expect(outside.ok).toBe(false);
    expect(escape.ok).toBe(false);
    expect(directory.ok).toBe(false);
    expect(store.items()).toHaveLength(0);
  });

  it("refuses a missing file and an empty file instead of inventing an item", async () => {
    const { fs, case: store } = storeFor();
    fs.seedFile(`${ROOT}\\empty.png`, new Uint8Array(0));

    const missing = await store.recordFile(`${ROOT}\\missing.png`);
    const empty = await store.recordFile(`${ROOT}\\empty.png`);
    expect(missing.ok).toBe(false);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.message).toContain("empty");
    expect(store.items()).toHaveLength(0);
  });

  it("keeps adoption idempotent for the same bytes and rejects a changed file", async () => {
    const { fs, case: store } = storeFor();
    const absolute = `${ROOT}\\shot.png`;
    fs.seedFile(absolute, new Uint8Array([9, 9, 9]));

    const first = await store.recordFile(absolute);
    const second = await store.recordFile(absolute);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.sha256).toBe(first.value.sha256);
    expect(store.items()).toHaveLength(1);

    fs.seedFile(absolute, new Uint8Array([9, 9, 9, 9]));
    const changed = await store.recordFile(absolute);
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.error.message).toContain("changed after it was recorded");
    expect(store.items()).toHaveLength(1);
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
