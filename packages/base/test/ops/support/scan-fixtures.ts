/**
 * Fixtures for the gate source-scan tests (ticket 02).
 *
 * Builds a throwaway "repo" under os.tmpdir() that looks enough like this
 * checkout for base-verify: the ops toolkit is copied in, packages/base has a
 * package.json plus stub npm scripts, and vitest is stubbed on disk so the
 * tests step never downloads or runs anything real.
 *
 * The frozen helpers in ./ops-fixtures.ts are reused as-is (ticket 01 froze
 * that file); this module only adds scan-specific scaffolding.
 */
import { copyOpsToolkit, makeTempDir, writeFiles } from "./ops-fixtures";

/** Fast, side-effect-free npm script target. */
export const STUB_SCRIPT = `process.stdout.write("stub-ok\\n");\n`;

/** Minimal vitest replacement so the tests step spawns node and exits 0. */
export const VITEST_STUB = [
  'process.stdout.write("Test Files 1 passed (1)\\n");',
  'process.stdout.write("     Tests 1 passed (1)\\n");',
  "",
].join("\n");

const FIXTURE_PACKAGE_JSON = {
  name: "fh-ops-scan-fixture",
  version: "0.0.0",
  private: true,
  scripts: {
    typecheck: "node scripts/stub.mjs",
    "docs:check": "node scripts/stub.mjs",
    build: "node scripts/stub.mjs",
  },
};

/**
 * Create a fixture repo root. Additional repo-relative files (string or
 * Buffer) are written after the baseline; Buffers make NUL / invalid UTF-8
 * fixtures explicit. The caller owns cleanup (see removeTempDir).
 */
export function makeScanFixture(files: Record<string, string | Buffer> = {}): string {
  const root = makeTempDir("fh-ops-scan-");
  copyOpsToolkit(root);
  writeFiles(root, {
    "packages/base/package.json": JSON.stringify(FIXTURE_PACKAGE_JSON, null, 2) + "\n",
    "packages/base/scripts/stub.mjs": STUB_SCRIPT,
    "packages/base/node_modules/vitest/vitest.mjs": VITEST_STUB,
    "packages/base/src/index.ts": "export const fixture = true;\n",
    "docs/README.md": "# fixture docs\n",
  });
  if (Object.keys(files).length) writeFiles(root, files);
  return root;
}
