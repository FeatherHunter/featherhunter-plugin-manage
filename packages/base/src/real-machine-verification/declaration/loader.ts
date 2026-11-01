/**
 * Loading the plugin repository's verification declaration (`verify/profile.ts`).
 *
 * The declaration is *plugin-supplied code*, so this module treats it as data at
 * the boundary: import it, pick the exported value, then normalize it through
 * `parseVerificationProfile`. Bad fields become a hard failure with the parser's
 * own sentence, never a partially-applied profile.
 *
 * Two failure modes are deliberately not failures:
 *
 * - **No declaration** — the plugin has not adopted the capability yet. That is a
 *   missing prerequisite (`blocked`, exit 2), and the hint carries a copy-paste
 *   template so the next action is obvious.
 * - **A declaration this Node cannot import** — Node gained native TypeScript
 *   type stripping in 22.6 (behind a flag until 22.18/23.6). On an older runtime
 *   the file is fine and the machine is not; calling that a product failure would
 *   be a false red. The hint offers both upgrades: newer Node, or precompile.
 *
 * The actual import goes through an injected function so the tests can load
 * declarations from a fake machine, and the production default uses a `new
 * Function` wrapper around `import()`. That wrapper is not obfuscation: esbuild
 * cannot statically analyze a specifier hidden in a string, so it leaves the
 * dynamic import intact instead of trying to bundle the declaration's module
 * graph into this package.
 */
import { pathToFileURL } from "node:url";

import type { FsPort } from "../contracts/ports";
import { err, failure, type Failure, type Result } from "../contracts/result";
import {
  parseVerificationProfile,
  type VerificationProfile,
  type VerificationProfileInput,
} from "../contracts/verification-profile";
import { isPosixAbsolute, isWindowsAbsolute, joinFsPath, resolveAgainst } from "../runtime/paths";

/** How the declaration is spelled on disk; decides the Node floor. */
export type DeclarationKind = "ts" | "js";

/** First Node with native TypeScript type stripping (flag-gated until 22.18). */
export const NODE_MIN_FOR_TYPESCRIPT = "22.6.0";

/** Floor inherited from the package's own engines field. */
export const NODE_MIN_FOR_JAVASCRIPT = "18.0.0";

/** The file the tool looks for when no `--declaration` is given. */
export const DECLARATION_RELATIVE_PATH = "verify/profile.ts";

/** Auto-discovery order: TypeScript first, because that is what repositories write. */
const DECLARATION_SEARCH_PATHS: readonly string[] = [
  DECLARATION_RELATIVE_PATH,
  "verify/profile.js",
  "verify/profile.mjs",
];

/**
 * Copy-paste declaration template.
 *
 * Ten lines on purpose: a template long enough to need reading is a template an
 * adopting repository will simplify until it no longer validates.
 */
const DECLARATION_TEMPLATE_SPECIFIER = "dsh-featherhunter-plugin-base/real-machine-verification";
const DOUBLE_QUOTE = String.fromCharCode(34);

export const DECLARATION_TEMPLATE = `import { defineVerificationProfile } from ${DOUBLE_QUOTE}${DECLARATION_TEMPLATE_SPECIFIER}${DOUBLE_QUOTE};

export default defineVerificationProfile({
  id: "my-plugin",
  packageName: "my-plugin",
  defaultProfile: "web",
  clientEntry: "lib/client.js",
});
`;

/** A declaration that loaded and validated. */
export interface VerificationDeclaration {
  /** Absolute path of the file that was imported. */
  readonly path: string;
  readonly kind: DeclarationKind;
  /** Which export supplied the value (`default` or a named export). */
  readonly exportName: string;
  readonly profile: VerificationProfile;
  /** Node floor implied by the file kind, already known to be satisfied. */
  readonly requiredNode: string;
}

/**
 * A declaration failure, classified.
 *
 * `blocked` means the run proves nothing (no declaration, or a runtime too old to
 * read it); `failed` means the declaration is wrong and the plugin author must
 * fix it. The distinction is the same one the exit codes expose.
 */
export type DeclarationFailure = Failure & { readonly kind: "blocked" | "failed" };

/** Import one module specifier. Injectable so tests need no real files. */
export type DeclarationImport = (specifier: string) => Promise<unknown>;

export interface LoadDeclarationOptions {
  readonly fs: FsPort;
  /** Repository root the declaration is discovered under. */
  readonly cwd: string;
  /** Running Node version, e.g. `v24.19.0`; decides whether `.ts` is importable. */
  readonly nodeVersion: string;
  /** Explicit `--declaration` path; relative paths resolve against `cwd`. */
  readonly declarationPath?: string;
  /** Defaults to a native dynamic import; tests inject their own. */
  readonly importModule?: DeclarationImport;
}

export type DeclarationLoadResult = Result<VerificationDeclaration, DeclarationFailure>;

/** The production import: native `import()` behind a non-analyzable indirection. */
const nativeImport: DeclarationImport = (specifier) => {
  const load = new Function("specifier", "return import(specifier);") as (value: string) => Promise<unknown>;
  return load(specifier);
};

/** Strip a leading `v` and parse the numeric triple; missing parts count as 0. */
export function parseNodeVersion(value: string): readonly [number, number, number] {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim());
  if (match === null) return [0, 0, 0];
  return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** Negative when `left` is older, positive when newer, 0 when equal. */
export function compareNodeVersions(left: string, right: string): number {
  const a = parseNodeVersion(left);
  const b = parseNodeVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** True when `current` satisfies `minimum`. */
export function meetsNodeVersion(current: string, minimum: string): boolean {
  return compareNodeVersions(current, minimum) >= 0;
}

/** Infer the declaration kind from its extension; `null` when unrecognized. */
export function declarationKindFor(path: string): DeclarationKind | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".mts")) return "ts";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
  return null;
}

/** The Node floor for a declaration kind. */
export function nodeRequirementFor(kind: DeclarationKind): string {
  return kind === "ts" ? NODE_MIN_FOR_TYPESCRIPT : NODE_MIN_FOR_JAVASCRIPT;
}

/** Failure helper that stamps the blocked/failed classification once. */
function declarationFailure(
  kind: "blocked" | "failed",
  code: Failure["code"],
  message: string,
  hint?: string,
): Result<never, DeclarationFailure> {
  return err({ ...failure(code, message, hint), kind });
}

/** The hint shown whenever there is no declaration to load. */
export function missingDeclarationHint(): string {
  return `create ${DECLARATION_RELATIVE_PATH} in the plugin repository root:

${DECLARATION_TEMPLATE}`;
}

/** Locate the declaration and decide which Node floor applies. */
async function locateDeclaration(
  options: LoadDeclarationOptions,
): Promise<Result<{ readonly path: string; readonly kind: DeclarationKind }, DeclarationFailure>> {
  const { fs, cwd } = options;
  if (options.declarationPath !== undefined) {
    const path =
      isWindowsAbsolute(options.declarationPath) || isPosixAbsolute(options.declarationPath)
        ? options.declarationPath
        : resolveAgainst(cwd, options.declarationPath);
    if (!(await fs.exists(path))) {
      return declarationFailure(
        "blocked",
        "prerequisite",
        `the --declaration file does not exist: ${path}`,
        missingDeclarationHint(),
      );
    }
    const kind = declarationKindFor(path);
    if (kind === null) {
      return declarationFailure(
        "blocked",
        "unsupported",
        `the declaration ${path} has an extension this tool cannot import`,
        "use a .ts declaration (Node 22.6+), or compile it to .js/.mjs and pass that file",
      );
    }
    return { ok: true, value: { path, kind } };
  }

  for (const relative of DECLARATION_SEARCH_PATHS) {
    const candidate = joinFsPath(cwd, relative);
    if (!(await fs.exists(candidate))) continue;
    const kind = declarationKindFor(candidate);
    if (kind === null) continue;
    return { ok: true, value: { path: candidate, kind } };
  }

  return declarationFailure(
    "blocked",
    "prerequisite",
    `no verification declaration found under ${cwd}`,
    missingDeclarationHint(),
  );
}

/** Read the import error's stable `code` field without trusting its type. */
function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Describe a thrown value for one line of report. */
function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Classify an import failure.
 *
 * `ERR_UNKNOWN_FILE_EXTENSION` is the specific way an older Node says "I do not
 * know how to import a .ts file": the declaration is fine, the runtime is not.
 * A syntax error or a throw from top-level code is the plugin's own defect.
 *
 * Module *resolution* failures are the third case, and they are about the
 * repository's environment rather than about the declaration's content:
 * a declaration importing `dsh-featherhunter-plugin-base/...` only resolves when
 * that package is installed in the plugin repository. Reporting that as "the
 * declaration threw" would send the author to edit a file that is fine, so a
 * missing *package* is blocked with an install hint, while a missing *relative
 * module* is still the author's defect (the file name is wrong).
 */
function classifyImportFailure(
  error: unknown,
  path: string,
  kind: DeclarationKind,
): Result<never, DeclarationFailure> {
  const code = errorCode(error);
  const message = describeThrown(error);
  const olderRuntimeCodes = new Set([
    "ERR_UNKNOWN_FILE_EXTENSION",
    "ERR_UNSUPPORTED_ESM_URL_SCHEME",
    "ERR_UNKNOWN_MODULE_FORMAT",
  ]);
  const resolutionCodes = new Set([
    "ERR_MODULE_NOT_FOUND",
    "ERR_PACKAGE_PATH_NOT_EXPORTED",
    "ERR_UNSUPPORTED_DIR_IMPORT",
  ]);
  if (code !== null && resolutionCodes.has(code)) {
    const missingPackage = /Cannot find package '([^']+)'/.exec(message)?.[1] ?? null;
    if (missingPackage !== null) {
      return declarationFailure(
        "blocked",
        "prerequisite",
        `the declaration ${path} imports package ${missingPackage}, which is not installed in this repository: ${message}`,
        `install ${missingPackage} in the plugin repository (a declaration resolves its imports from there), then rerun self-check`,
      );
    }
    return declarationFailure(
      code === "ERR_MODULE_NOT_FOUND" ? "failed" : "blocked",
      code === "ERR_MODULE_NOT_FOUND" ? "invalid-input" : "prerequisite",
      `the declaration ${path} could not resolve its imports: ${message}`,
      code === "ERR_MODULE_NOT_FOUND"
        ? "the declaration imports a file that does not exist; fix the specifier"
        : "install a version of the imported package that exports the declared entry point, then rerun self-check",
    );
  }
  if (code !== null && olderRuntimeCodes.has(code)) {
    const minimum = nodeRequirementFor(kind);
    return declarationFailure(
      "blocked",
      "unsupported",
      `Node could not import ${path} (it needs Node ${minimum}+ for a ${kind === "ts" ? "TypeScript" : "module"} declaration): ${code}`,
      `upgrade Node to ${minimum}+, or compile the declaration with tsc and pass the resulting .js file via --declaration`,
    );
  }
  if (error instanceof SyntaxError) {
    return declarationFailure(
      "failed",
      "invalid-input",
      `the declaration ${path} has a syntax error: ${describeThrown(error)}`,
      "fix the syntax error, then rerun self-check",
    );
  }
  return declarationFailure(
    "failed",
    "invalid-input",
    `the declaration ${path} threw while loading: ${describeThrown(error)}`,
    "the declaration must only define the profile; move side effects out of it",
  );
}

/** Candidate exports in priority order: the documented default, then named aliases. */
const NAMED_EXPORT_CANDIDATES: readonly string[] = ["profile", "verificationProfile", "declaration"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pick the profile value out of a module namespace.
 *
 * A `defineVerificationProfile(...)` result is a frozen object, and the input it
 * was built from is a plain object; both are accepted for the same reason a
 * repository might export either (computed or literal). Named exports are tried
 * in a fixed order before falling back to "the only object export", because a
 * silent guess between two profiles is worse than an error.
 */
function selectDeclarationValue(
  namespace: unknown,
  path: string,
): Result<{ readonly value: unknown; readonly exportName: string }, DeclarationFailure> {
  if (!isPlainObject(namespace)) {
    return declarationFailure(
      "failed",
      "invalid-input",
      `the declaration ${path} did not load as a module`,
      "export the profile from verify/profile.ts",
    );
  }
  for (const name of ["default", ...NAMED_EXPORT_CANDIDATES] as const) {
    if (Object.prototype.hasOwnProperty.call(namespace, name) && namespace[name] !== undefined) {
      return { ok: true, value: { value: namespace[name], exportName: name } };
    }
  }
  const objectExports = Object.entries(namespace).filter(
    ([name, value]) => name !== "__esModule" && isPlainObject(value) && "packageName" in value,
  );
  if (objectExports.length === 1) {
    const [name, value] = objectExports[0] as readonly [string, Record<string, unknown>];
    return { ok: true, value: { value, exportName: name } };
  }
  if (objectExports.length > 1) {
    const names = objectExports.map(([name]) => name).join(", ");
    return declarationFailure(
      "failed",
      "invalid-input",
      `the declaration ${path} exports more than one profile-like object (${names})`,
      "export exactly one: export default defineVerificationProfile({ ... })",
    );
  }
  return declarationFailure(
    "failed",
    "invalid-input",
    `the declaration ${path} does not export a verification profile`,
    "export default defineVerificationProfile({ ... }), or a plain profile object",
  );
}

/**
 * Discover, import and validate the declaration.
 *
 * Returns `blocked` for a missing declaration or an unimportable file kind, and
 * `failed` for a declaration whose content is wrong. The profile comes back
 * frozen and normalized, so no caller has to second-guess optional fields.
 */
export async function loadVerificationDeclaration(options: LoadDeclarationOptions): Promise<DeclarationLoadResult> {
  const located = await locateDeclaration(options);
  if (!located.ok) return located;
  const { path, kind } = located.value;

  const requiredNode = nodeRequirementFor(kind);
  if (!meetsNodeVersion(options.nodeVersion, requiredNode)) {
    return declarationFailure(
      "blocked",
      "unsupported",
      `a ${kind === "ts" ? "TypeScript" : "module"} declaration needs Node ${requiredNode}+, this run is Node ${options.nodeVersion}`,
      `upgrade Node to ${requiredNode}+, or compile the declaration with tsc and pass the resulting .js file via --declaration`,
    );
  }

  let namespace: unknown;
  try {
    namespace = await (options.importModule ?? nativeImport)(pathToFileURL(path).href);
  } catch (error) {
    return classifyImportFailure(error, path, kind);
  }

  const selected = selectDeclarationValue(namespace, path);
  if (!selected.ok) return selected;

  const parsed = parseVerificationProfile(selected.value.value as VerificationProfileInput);
  if (!parsed.ok) {
    return err({
      ...parsed.error,
      kind: "failed",
      hint:
        parsed.error.hint ??
        "fix the declaration fields; DECLARATION_TEMPLATE in the README shows a valid minimal profile",
    });
  }

  return {
    ok: true,
    value: {
      path,
      kind,
      exportName: selected.value.exportName,
      profile: parsed.value,
      requiredNode,
    },
  };
}
