/**
 * The ticket-face seam: validation, dynamic loading, and profile declaration.
 *
 * The loader is tested with an injected import and an in-memory filesystem, so
 * these tests prove the failure classification (blocked vs failed) without
 * installing a real adapter or touching a tracker.
 */
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  loadTicketFaceAdapter,
  missingTicketFaceHint,
} from "../adapters/ticket-face/loader";
import { validateTicketFaceAdapter } from "../contracts/ticket-face";
import {
  hasTicketFaceAdapter,
  parseVerificationProfile,
} from "../contracts/verification-profile";
import { fakeTicketFace } from "./support/fake-ticket-face";
import { FakeFs } from "./support/fake-fs";

// The loader turns the resolved path into a real file URL, so the fake repo root
// must be a path the host (including the Linux CI runner) can convert.
const REPO = process.platform === "win32" ? "C:\\repo" : "/repo";

function brokenAdapter(): Record<string, unknown> {
  return {
    kind: "github",
    async listChecklistIssues() {
      return [];
    },
    async listComments() {
      return [];
    },
    async resolveReleaseCommit() {
      return "";
    },
  };
}

describe("validateTicketFaceAdapter", () => {
  it("accepts every required method and the optional manifest reader", () => {
    const validated = validateTicketFaceAdapter(fakeTicketFace());
    expect(validated.ok).toBe(true);
  });

  it("names the missing isAncestor method", () => {
    const validated = validateTicketFaceAdapter(brokenAdapter());
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.error.message).toContain("isAncestor");
  });

  it("rejects a non-object export", () => {
    const validated = validateTicketFaceAdapter("github");
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.error.message).toContain("not an object");
  });
});

describe("loadTicketFaceAdapter", () => {
  it("resolves a repository-relative module to a file URL and returns the named export", async () => {
    const fs = new FakeFs(REPO);
    fs.seedFile("verify/adapters/github.mjs", "export const createTicketFace = {};");
    const adapter = fakeTicketFace();
    let seen = "";

    const loaded = await loadTicketFaceAdapter({
      fs,
      repoRoot: REPO,
      declaration: { module: "verify/adapters/github.mjs", exportName: "createTicketFace" },
      importModule: async (specifier) => {
        seen = specifier;
        return { createTicketFace: adapter };
      },
    });

    expect(seen).toBe(pathToFileURL(`${REPO.replace(/\\/g, "/")}/verify/adapters/github.mjs`).href);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.adapter).toBe(adapter);
    expect(loaded.value.exportName).toBe("createTicketFace");
    expect(loaded.value.module).toBe("verify/adapters/github.mjs");
  });

  it("falls back to the default export", async () => {
    const fs = new FakeFs(REPO);
    fs.seedFile("verify/ticket-face.mjs", "export default {};");
    const adapter = fakeTicketFace();
    const loaded = await loadTicketFaceAdapter({
      fs,
      repoRoot: REPO,
      declaration: { module: "verify/ticket-face.mjs" },
      importModule: async () => ({ default: adapter }),
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.adapter).toBe(adapter);
    expect(loaded.value.exportName).toBe("default");
  });

  it("blocks before import when the declared module does not exist, and repeats the three-step hint", async () => {
    const fs = new FakeFs(REPO);
    let imports = 0;
    const loaded = await loadTicketFaceAdapter({
      fs,
      repoRoot: REPO,
      declaration: { module: "verify/ticket-face.mjs" },
      importModule: async () => {
        imports += 1;
        return {};
      },
    });

    expect(imports).toBe(0);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.kind).toBe("blocked");
    expect(loaded.error.message).toContain("does not exist");
    expect(loaded.error.hint).toContain("ticketFace: { module:");
    expect(loaded.error.hint).toContain("1. add to verify/profile.ts");
    expect(loaded.error.hint).toContain("2. the module must export");
    expect(loaded.error.hint).toContain("3. GitHub/GitLab adapters");
  });

  it("fails, not blocks, when the module loads but does not export the promised shape", async () => {
    const fs = new FakeFs(REPO);
    fs.seedFile("verify/ticket-face.mjs", "export default {};");
    const loaded = await loadTicketFaceAdapter({
      fs,
      repoRoot: REPO,
      declaration: { module: "verify/ticket-face.mjs" },
      importModule: async () => ({ default: brokenAdapter() }),
    });

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.kind).toBe("failed");
    expect(loaded.error.message).toContain("not a TicketFaceAdapter");
    expect(loaded.error.message).toContain("missing required method(s): isAncestor");
  });

  it("classifies a missing package as blocked prerequisite, naming the package", async () => {
    const fs = new FakeFs(REPO);
    const error = Object.assign(new Error("Cannot find package '@scope/tracker-adapter'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    const loaded = await loadTicketFaceAdapter({
      fs,
      repoRoot: REPO,
      declaration: { module: "@scope/tracker-adapter" },
      importModule: async () => {
        throw error;
      },
    });

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.kind).toBe("blocked");
    expect(loaded.error.code).toBe("prerequisite");
    expect(loaded.error.message).toContain("@scope/tracker-adapter");
  });

  it("classifies any other import throw as failed invalid-input", async () => {
    const fs = new FakeFs(REPO);
    fs.seedFile("verify/ticket-face.mjs", "throw new Error('boom');");
    const loaded = await loadTicketFaceAdapter({
      fs,
      repoRoot: REPO,
      declaration: { module: "verify/ticket-face.mjs" },
      importModule: async () => {
        throw new Error("boom");
      },
    });

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.kind).toBe("failed");
    expect(loaded.error.code).toBe("invalid-input");
  });

  it("keeps the hint self-contained even without a profile", () => {
    const hint = missingTicketFaceHint();
    expect(hint).toContain("without an adapter, release checks report blocked (exit 2), never fail.");
    expect(hint).toContain("isAncestor returns");
  });
});

describe("verification profile ticketFace field", () => {
  const BASE = {
    id: "ticket-face-fixture",
    packageName: "ticket-face-fixture",
    defaultProfile: "web",
    clientEntry: "lib/client.js",
  } as const;

  it("defaults to false and reports no adapter", () => {
    const parsed = parseVerificationProfile(BASE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ticketFace).toBe(false);
    expect(hasTicketFaceAdapter(parsed.value)).toBe(false);
  });

  it("normalizes a module-only declaration and reports an adapter", () => {
    const parsed = parseVerificationProfile({ ...BASE, ticketFace: { module: "verify/ticket-face.mjs" } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ticketFace).toEqual({ module: "verify/ticket-face.mjs" });
    expect(Object.keys(parsed.value.ticketFace)).toEqual(["module"]);
    expect(hasTicketFaceAdapter(parsed.value)).toBe(true);
  });

  it("keeps a package name and a named export", () => {
    const parsed = parseVerificationProfile({
      ...BASE,
      ticketFace: { module: "@scope/tracker-adapter", exportName: "createTicketFace" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ticketFace).toEqual({
      module: "@scope/tracker-adapter",
      exportName: "createTicketFace",
    });
  });

  it("rejects an absolute or escaping module path", () => {
    for (const module of ["C:/ticket-face.mjs", "/opt/ticket-face.mjs", "../ticket-face.mjs"]) {
      const parsed = parseVerificationProfile({ ...BASE, ticketFace: { module } });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error.message).toContain("ticketFace.module");
    }
  });

  it("rejects an exportName that is not a JavaScript identifier", () => {
    const parsed = parseVerificationProfile({
      ...BASE,
      ticketFace: { module: "verify/ticket-face.mjs", exportName: "not-valid" },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain("ticketFace.exportName");
  });
});
