/**
 * The declaration loader is where "the plugin states its profile" meets "the tool
 * can actually read it". Two outcomes must stay apart: a missing or unimportable
 * declaration is `blocked` (the run proves nothing), a wrong declaration is
 * `failed` (the plugin author must fix it). These tests pin that split and the
 * discovery order (TypeScript first), because both leak into the exit code.
 */
import { describe, expect, it } from "vitest";

import {
  DECLARATION_RELATIVE_PATH,
  DECLARATION_TEMPLATE,
  NODE_MIN_FOR_JAVASCRIPT,
  NODE_MIN_FOR_TYPESCRIPT,
  compareNodeVersions,
  loadVerificationDeclaration,
  meetsNodeVersion,
  nodeRequirementFor,
} from "../declaration/loader";
import { defineVerificationProfile } from "../contracts/verification-profile";
import { buildProfileInput, fakeDeclarationImport } from "./support/fake-machine";
import { FakeFs } from "./support/fake-fs";

const PROFILE_MODULE = defineVerificationProfile(buildProfileInput());

function loaderFor(fs: FakeFs, options: { nodeVersion?: string; importModule?: (specifier: string) => Promise<unknown>; declarationPath?: string } = {}) {
  return loadVerificationDeclaration({
    fs,
    cwd: "C:\\fixture-repo",
    nodeVersion: options.nodeVersion ?? "24.19.0",
    importModule: options.importModule ?? fakeDeclarationImport({ default: PROFILE_MODULE }),
    ...(options.declarationPath === undefined ? {} : { declarationPath: options.declarationPath }),
  });
}

describe("declaration template", () => {
  it("is a copy-pasteable file that imports the published package", () => {
    expect(DECLARATION_RELATIVE_PATH).toBe("verify/profile.ts");
    expect(DECLARATION_TEMPLATE).toContain('from "dsh-featherhunter-plugin-base/real-machine-verification"');
    expect(DECLARATION_TEMPLATE).toContain("defineVerificationProfile");
    expect(DECLARATION_TEMPLATE).toContain("packageName");
    expect(DECLARATION_TEMPLATE.trim().split("\n").length).toBeLessThanOrEqual(12);
  });
});

describe("node floors", () => {
  it("requires Node 22.6 for TypeScript declarations and 18 for JavaScript ones", () => {
    expect(NODE_MIN_FOR_TYPESCRIPT).toBe("22.6.0");
    expect(NODE_MIN_FOR_JAVASCRIPT).toBe("18.0.0");
    expect(nodeRequirementFor("ts")).toBe(NODE_MIN_FOR_TYPESCRIPT);
    expect(nodeRequirementFor("js")).toBe(NODE_MIN_FOR_JAVASCRIPT);
  });

  it("compares versions numerically, not lexicographically", () => {
    expect(compareNodeVersions("24.19.0", "22.6.0")).toBeGreaterThan(0);
    expect(compareNodeVersions("22.6.0", "22.6.0")).toBe(0);
    expect(compareNodeVersions("22.5.0", "22.6.0")).toBeLessThan(0);
    expect(compareNodeVersions("9.0.0", "18.0.0")).toBeLessThan(0);
    expect(meetsNodeVersion("24.19.0", "22.6.0")).toBe(true);
    expect(meetsNodeVersion("20.11.0", "22.6.0")).toBe(false);
  });
});

describe("discovery", () => {
  it("reports a missing declaration as blocked, with the template in the hint", async () => {
    const result = await loaderFor(new FakeFs("C:\\fixture-repo"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("blocked");
    expect(result.error.code).toBe("prerequisite");
    expect(result.error.hint).toContain("verify/profile.ts");
    expect(result.error.hint).toContain("dsh-featherhunter-plugin-base/real-machine-verification");
  });

  it("prefers verify/profile.ts over verify/profile.js", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.js", "export default {};\n");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default {};\n");

    const result = await loaderFor(fs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("ts");
    expect(result.value.path.replace(/\\\\/g, "/")).toContain("verify/profile.ts");
  });

  it("accepts a JavaScript declaration when no TypeScript one exists", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.mjs", "export default {};\n");

    const result = await loaderFor(fs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("js");
    expect(result.value.requiredNode).toBe(NODE_MIN_FOR_JAVASCRIPT);
  });

  it("resolves an explicit --declaration path against the working directory", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\custom\\decl.js", "export default {};\n");

    const result = await loaderFor(fs, { declarationPath: "custom/decl.js" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.path.replace(/\\\\/g, "/")).toContain("custom/decl.js");
  });

  it("blocks on an explicit file that does not exist", async () => {
    const result = await loaderFor(new FakeFs("C:\\fixture-repo"), { declarationPath: "nope.js" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("blocked");
    expect(result.error.message).toContain("nope.js");
  });

  it("blocks on an extension Node cannot import", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.yaml", "id: fixture\n");

    const result = await loaderFor(fs, { declarationPath: "verify/profile.yaml" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("blocked");
    expect(result.error.code).toBe("unsupported");
    expect(result.error.hint).toContain(".js");
  });
});

describe("import and validation", () => {
  it("blocks a TypeScript declaration on a Node older than 22.6, before importing it", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default {};\n");
    let imported = false;

    const result = await loaderFor(fs, {
      nodeVersion: "20.11.0",
      importModule: async () => {
        imported = true;
        return { default: PROFILE_MODULE };
      },
    });

    expect(imported).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("blocked");
    expect(result.error.message).toContain("22.6.0");
    expect(result.error.hint).toContain("tsc");
  });

  it("loads a default export and normalizes the profile", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default {};\n");

    const result = await loaderFor(fs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exportName).toBe("default");
    expect(result.value.profile.packageName).toBe("fixture-plugin");
    expect(result.value.profile.defaultProfile).toBe("web");
    expect(result.value.requiredNode).toBe(NODE_MIN_FOR_TYPESCRIPT);
  });

  it("accepts a named profile export and a plain configuration object", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export const profile = {};\n");

    const named = await loaderFor(fs, { importModule: fakeDeclarationImport({ profile: buildProfileInput() }) });
    expect(named.ok).toBe(true);
    if (named.ok) expect(named.value.exportName).toBe("profile");

    const plain = await loaderFor(fs, { importModule: fakeDeclarationImport({ default: buildProfileInput() }) });
    expect(plain.ok).toBe(true);
    if (plain.ok) expect(plain.value.profile.clientEntry).toBe("lib/client.js");
  });

  it("fails when two profile-like exports make the choice ambiguous", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export const a = {};\n export const b = {};\n");

    const result = await loaderFor(fs, {
      importModule: fakeDeclarationImport({
        alpha: buildProfileInput({ id: "alpha" }),
        beta: buildProfileInput({ id: "beta" }),
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("failed");
    expect(result.error.message).toContain("more than one");
  });

  it("fails when the module exports no profile at all", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export const x = 1;\n");

    const result = await loaderFor(fs, { importModule: fakeDeclarationImport({ somethingElse: 1 }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("failed");
    expect(result.error.message).toContain("does not export");
  });

  it("fails on an invalid profile field, naming the field", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default {};\n");

    const result = await loaderFor(fs, {
      importModule: fakeDeclarationImport({ default: { ...buildProfileInput(), id: "Not Kebab" } }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("failed");
    expect(result.error.code).toBe("invalid-input");
    expect(result.error.message).toContain("kebab-case");
  });

  it("classifies an older-Node import failure as blocked and a syntax error as failed", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default {};\n");

    const unknownExtension = await loaderFor(fs, {
      importModule: async () => {
        throw Object.assign(new Error("unknown extension .ts"), { code: "ERR_UNKNOWN_FILE_EXTENSION" });
      },
    });
    expect(unknownExtension.ok).toBe(false);
    if (!unknownExtension.ok) {
      expect(unknownExtension.error.kind).toBe("blocked");
      expect(unknownExtension.error.hint).toContain("tsc");
    }

    const syntax = await loaderFor(fs, {
      importModule: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    expect(syntax.ok).toBe(false);
    if (!syntax.ok) expect(syntax.error.kind).toBe("failed");
  });

  it("blocks when the declaration imports a package the repository has not installed", async () => {
    // The declaration is correct; the repository's node_modules is not. Telling
    // the reader to edit the declaration would be the wrong repair.
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default {};\n");

    const result = await loaderFor(fs, {
      importModule: async () => {
        throw Object.assign(
          new Error(
            "Cannot find package 'dsh-featherhunter-plugin-base' imported from C:\\fixture-repo\\verify\\profile.ts",
          ),
          { code: "ERR_MODULE_NOT_FOUND" },
        );
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("blocked");
    expect(result.error.code).toBe("prerequisite");
    expect(result.error.message).toContain("dsh-featherhunter-plugin-base");
    expect(result.error.hint).toContain("install dsh-featherhunter-plugin-base");
  });

  it("still fails when the declaration imports a relative file that does not exist", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default {};\n");

    const result = await loaderFor(fs, {
      importModule: async () => {
        throw Object.assign(
          new Error("Cannot find module 'C:\\fixture-repo\\verify\\helper.js' imported from C:\\fixture-repo\\verify\\profile.ts"),
          { code: "ERR_MODULE_NOT_FOUND" },
        );
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("failed");
    expect(result.error.hint).toContain("specifier");
  });

  it("fails when the module does not load as an object", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default 1;\n");

    const result = await loaderFor(fs, { importModule: fakeDeclarationImport(42) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("failed");
    expect(result.error.message).toContain("did not load as a module");
  });
});

describe("invalid profile fields", () => {
  it("points at the missing field instead of blaming top-level side effects", async () => {
    const fs = new FakeFs("C:\\fixture-repo");
    fs.seedFile("C:\\fixture-repo\\verify\\profile.ts", "export default {};\n");

    const result = await loaderFor(fs, {
      importModule: async () => {
        throw new Error(
          "verification profile is invalid: profile defaultProfile is required — no implicit default is applied",
        );
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("failed");
    expect(result.error.code).toBe("invalid-input");
    expect(result.error.message).toContain("defaultProfile is required");
    expect(result.error.hint).toContain("defaultProfile");
    expect(result.error.hint).not.toContain("side effects");
  });
});
