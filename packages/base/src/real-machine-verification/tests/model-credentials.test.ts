/**
 * Credential-store observation: reference names only, never values.
 *
 * The host's credential store is <DSH_HOME>/.credentials.yaml. These tests pin
 * the two halves of the safety property: the scanner returns names (in order,
 * deduplicated) and can never return a value, and a missing or malformed store
 * is an observation, not an exception.
 */
import { describe, expect, it } from "vitest";

import { FakeFs } from "./support/fake-fs";
import { credentialStorePath, probeCredentialStore, scanCredentialRefs } from "../runtime/dsh/credentials";

const STORE_TEXT = [
  "version: 1",
  "refs:",
  "  DEEPSEEK_API_KEY: sk-live-do-not-report",
  "  MINIMAX_CN_API_KEY: another-secret-value",
  "  # comments inside the block are not names",
  "",
  "  NESTED.context-key: value-with-dashes",
  "  BAD KEY: never-a-ref",
  "records:",
  "  owner/id:",
  "    kind: api-key",
  "    payload: payload-not-a-ref",
  "",
].join("\n");

const EXPECTED_REFS = ["DEEPSEEK_API_KEY", "MINIMAX_CN_API_KEY", "NESTED.context-key"];

describe("scanCredentialRefs", () => {
  it("reads reference names and never their values", () => {
    const scan = scanCredentialRefs(STORE_TEXT);
    expect(scan.refs).toEqual(EXPECTED_REFS);
    expect(scan.note).toBeNull();
    expect(JSON.stringify(scan)).not.toContain("sk-live-do-not-report");
    expect(JSON.stringify(scan)).not.toContain("another-secret-value");
    expect(JSON.stringify(scan)).not.toContain("payload-not-a-ref");
  });

  it("handles CRLF stores the same way", () => {
    const scan = scanCredentialRefs(STORE_TEXT.replace(/\n/g, "\r\n"));
    expect(scan.refs).toEqual(EXPECTED_REFS);
  });

  it("reports a missing refs block as a note", () => {
    expect(scanCredentialRefs("version: 1\nrecords:\n  a: b\n")).toEqual({
      refs: [],
      note: "the text has no top-level refs: block",
    });
  });

  it("skips comments, blank lines and keys that are not reference shaped", () => {
    const scan = scanCredentialRefs(
      ["refs:", "  # a comment", "", "  A_KEY: value", "  BAD KEY: value", "  B_KEY: other"].join("\n"),
    );
    expect(scan.refs).toEqual(["A_KEY", "B_KEY"]);
  });

  it("stops at the next top-level key so records are never read as refs", () => {
    const scan = scanCredentialRefs(["refs:", "  A_KEY: value", "records:", "  B_KEY: value"].join("\n"));
    expect(scan.refs).toEqual(["A_KEY"]);
  });

  it("deduplicates repeated names but keeps file order", () => {
    const scan = scanCredentialRefs(["refs:", "  B_KEY: 1", "  A_KEY: 2", "  B_KEY: 3"].join("\n"));
    expect(scan.refs).toEqual(["B_KEY", "A_KEY"]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(scanCredentialRefs("\uFEFFrefs:\n  A_KEY: value").refs).toEqual(["A_KEY"]);
  });

  it("is total on malformed text", () => {
    expect(() => scanCredentialRefs("refs:\n\tA: x\n---\n- not yaml")).not.toThrow();
  });
});

describe("probeCredentialStore", () => {
  const STORE_PATH = "C:\\fake-dsh\\.credentials.yaml";

  it("reports a listed reference without exposing any value", async () => {
    const fs = new FakeFs("C:\\fake-repo");
    fs.seedFile(STORE_PATH, STORE_TEXT);
    const observed = await probeCredentialStore(fs, STORE_PATH, "MINIMAX_CN_API_KEY");
    expect(observed.readable).toBe(true);
    expect(observed.refPresent).toBe(true);
    expect(observed.refCount).toBe(3);
    expect(observed.note).toBeNull();
    expect(JSON.stringify(observed)).not.toContain("another-secret-value");
  });

  it("distinguishes a readable store that does not list the reference", async () => {
    const fs = new FakeFs("C:\\fake-repo");
    fs.seedFile(STORE_PATH, STORE_TEXT);
    const observed = await probeCredentialStore(fs, STORE_PATH, "SOME_OTHER_KEY");
    expect(observed.readable).toBe(true);
    expect(observed.refPresent).toBe(false);
    expect(observed.refCount).toBe(3);
  });

  it("is unavailable when the store does not exist", async () => {
    const fs = new FakeFs("C:\\fake-repo");
    const observed = await probeCredentialStore(fs, STORE_PATH, "DEEPSEEK_API_KEY");
    expect(observed.readable).toBe(false);
    expect(observed.refPresent).toBe(false);
    expect(observed.refCount).toBe(0);
    expect(observed.note).toBeDefined();
  });

  it("names the real-home store under DSH_HOME", () => {
    expect(credentialStorePath("C:\\fake-dsh")).toBe("C:\\fake-dsh\\.credentials.yaml");
  });
});
