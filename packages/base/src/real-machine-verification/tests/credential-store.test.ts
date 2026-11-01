/**
 * Credential reference parsing and resolution order.
 *
 * The value is a secret, so every case here asserts on *behavior* (which source
 * won, whether a value was returned) and never prints or persists the value.
 */
import { describe, expect, it } from "vitest";

import { ok, type Result } from "../contracts/result";
import {
  parseCredentialRefs,
  resolveModelCredential,
  type ResolveModelCredentialOptions,
} from "../runtime/dsh/credential-store";

const CANARY = "sk-canary-must-not-appear-7f3a";

describe("parseCredentialRefs", () => {
  it("reads only the top-level refs block, including quoted values", () => {
    const text = [
      "version: 1",
      "records:",
      "  DEEPSEEK_API_KEY:",
      "    secret: never-read-this",
      "refs:",
      "  DEEPSEEK_API_KEY: plain-value",
      `  MINIMAX_CN_API_KEY: "${CANARY}"`,
      "  QUOTED_SINGLE: 'single'",
      "",
      "other:",
      "  NESTED_REF: nope",
    ].join("\n");
    const refs = parseCredentialRefs(text);

    expect(refs.get("DEEPSEEK_API_KEY")).toBe("plain-value");
    expect(refs.get("MINIMAX_CN_API_KEY")).toBe(CANARY);
    expect(refs.get("QUOTED_SINGLE")).toBe("single");
    // The nested entry after the next top-level key is not a ref.
    expect(refs.has("NESTED_REF")).toBe(false);
  });

  it("handles CRLF, blank lines and comments", () => {
    const text = [
      "version: 1",
      "refs:",
      "  # a comment",
      "",
      "  A_KEY: one",
      "  B_KEY: two",
      "next:",
    ].join("\r\n");
    const refs = parseCredentialRefs(text);
    expect([...refs.keys()]).toEqual(["A_KEY", "B_KEY"]);
    expect(refs.get("B_KEY")).toBe("two");
  });

  it("returns an empty map when there is no refs block", () => {
    expect(parseCredentialRefs("version: 1\nrecords:\n  A: b\n").size).toBe(0);
    expect(parseCredentialRefs("").size).toBe(0);
  });

  it("ignores lines deeper than one indent level", () => {
    const refs = parseCredentialRefs(["refs:", "  A_KEY: one", "    NESTED: two"].join("\n"));
    expect(refs.get("A_KEY")).toBe("one");
    expect(refs.has("NESTED")).toBe(false);
  });
});

interface LookupState {
  readonly files: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
}

function lookup(options: {
  readonly files?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly apiKeyEnv?: string;
}): Promise<Awaited<ReturnType<typeof resolveModelCredential>>> {
  const state: LookupState = { files: options.files ?? {}, env: options.env ?? {} };
  const deps: ResolveModelCredentialOptions = {
    apiKeyEnv: options.apiKeyEnv ?? "MINIMAX_CN_API_KEY",
    batchHome: "C:\\batch\\home",
    realHome: "C:\\real\\home",
    readText: async (path): Promise<Result<string>> => {
      const text = state.files[path];
      if (text === undefined) {
        return { ok: false, error: { code: "not-found", message: `no file at ${path}` } };
      }
      return ok(text);
    },
    envGet: (name) => state.env[name],
  };
  return resolveModelCredential(deps);
}

const BATCH_FILE = `C:\\batch\\home\\${".credentials.yaml"}`;
const REAL_FILE = `C:\\real\\home\\${".credentials.yaml"}`;

describe("resolveModelCredential", () => {
  it("prefers the batch home store over the real home", async () => {
    const result = await lookup({
      files: {
        [BATCH_FILE]: `refs:\n  MINIMAX_CN_API_KEY: batch-secret\n`,
        [REAL_FILE]: `refs:\n  MINIMAX_CN_API_KEY: real-secret\n`,
      },
      env: { MINIMAX_CN_API_KEY: "env-secret" },
    });
    expect(result.credential).toEqual({
      name: "MINIMAX_CN_API_KEY",
      value: "batch-secret",
      source: "batch-home-store",
    });
  });

  it("falls back to the real home store and then to the process environment", async () => {
    const real = await lookup({
      files: { [REAL_FILE]: `refs:\n  MINIMAX_CN_API_KEY: real-secret\n` },
      env: { MINIMAX_CN_API_KEY: "env-secret" },
    });
    expect(real.credential?.source).toBe("real-home-store");
    expect(real.credential?.value).toBe("real-secret");

    const fromEnv = await lookup({ env: { MINIMAX_CN_API_KEY: "env-secret" } });
    expect(fromEnv.credential?.source).toBe("process-env");
    expect(fromEnv.credential?.value).toBe("env-secret");
  });

  it("returns null, not an error, when no source has the reference", async () => {
    const result = await lookup({ files: { [REAL_FILE]: "refs:\n  OTHER_KEY: x\n" } });
    expect(result.credential).toBeNull();
    // Notes mention only names and sources, never values.
    expect(result.notes.join(" ")).toContain("MINIMAX_CN_API_KEY");
    expect(result.notes.join(" ")).not.toContain("x");
  });

  it("never leaks a value into the notes", async () => {
    const result = await lookup({
      files: {
        [BATCH_FILE]: `refs:\n  MINIMAX_CN_API_KEY: ${CANARY}\n`,
      },
    });
    expect(result.credential?.value).toBe(CANARY);
    expect(JSON.stringify(result.notes)).not.toContain(CANARY);
  });
});
