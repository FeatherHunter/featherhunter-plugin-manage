/**
 * Loading a repository's ticket-face adapter.
 *
 * The ticket tracker is external: GitHub, GitLab, or a local markdown folder.
 * The core package owns none of those protocols. A plugin repository declares
 * an adapter module in `verify/profile.ts` (`ticketFace: { module, exportName? }`)
 * and this loader imports it at run time.
 *
 * The import is dynamic and wrapped in `new Function`, exactly like the browser
 * loader, so esbuild cannot pull the adapter's dependencies into the core
 * bundle. A missing or malformed adapter is classified as a configuration
 * failure: the gate reports blocked (exit 2), never a silent pass and never a
 * false red. Unknown answers from Git must stay unknown; the adapter contract
 * allows the string "unknown" so the gate can refuse to decide.
 */
import { pathToFileURL } from "node:url";

import type { FsPort } from "../../contracts/ports";
import { err, failure, type Failure, type Result } from "../../contracts/result";
import {
  validateTicketFaceAdapter,
  type TicketFaceAdapter,
  type TicketFaceDeclaration,
} from "../../contracts/ticket-face";
import {
  isPosixAbsolute,
  isWindowsAbsolute,
  joinFsPath,
  resolveAgainst,
} from "../../runtime/paths";

/** Import one module specifier. Injectable so tests need no real files. */
export type TicketFaceImport = (specifier: string) => Promise<unknown>;

/** A loaded adapter plus enough provenance for a report to cite it. */
export interface LoadedTicketFaceAdapter {
  readonly adapter: TicketFaceAdapter;
  /** The specifier handed to import(): a file URL or a package name. */
  readonly specifier: string;
  /** The declared module value, unchanged. */
  readonly module: string;
  /** "default" or the named export that supplied the adapter. */
  readonly exportName: string;
}

/**
 * A ticket-face adapter failure, classified.
 *
 * `blocked` means the repository cannot provide the adapter (missing module,
 * unsupported runtime); `failed` means the module loaded but does not export
 * the promised shape. Both leave the product unobserved, so the gate turns
 * either into a blocked check.
 */
export type TicketFaceAdapterFailure = Failure & { readonly kind: "blocked" | "failed" };

export type TicketFaceAdapterLoadResult = Result<LoadedTicketFaceAdapter, TicketFaceAdapterFailure>;

export interface LoadTicketFaceAdapterOptions {
  readonly fs: FsPort;
  /** Plugin repository root; relative modules resolve against it. */
  readonly repoRoot: string;
  readonly declaration: TicketFaceDeclaration;
  /** Defaults to a native dynamic import; tests inject their own. */
  readonly importModule?: TicketFaceImport;
}

/** The production import: native import() behind a non-analyzable indirection. */
const nativeImport: TicketFaceImport = (specifier) => {
  const load = new Function("specifier", "return import(specifier);") as (value: string) => Promise<unknown>;
  return load(specifier);
};

/**
 * Copy-paste adapter skeleton.
 *
 * Deliberately protocol-neutral: the repository may talk to a remote API, shell
 * out to gh, or read markdown files, and this capability must not choose one.
 */
export const TICKET_FACE_ADAPTER_TEMPLATE = `// verify/ticket-face.mjs — the adapter the release gate imports.
// Declare it in verify/profile.ts as:
//   ticketFace: { module: "verify/ticket-face.mjs" }
export default {
  kind: "github",
  async listChecklistIssues() {
    return []; // [{ number, title, state, body, url? }]
  },
  async listComments(issueNumber) {
    return []; // [{ body, createdAt? }] oldest first
  },
  async resolveReleaseCommit() {
    return ""; // the 40-hex release commit, or "" when it cannot be resolved
  },
  async isAncestor(commit, descendant) {
    return "unknown"; // true / false / "unknown" — never false when Git cannot answer
  },
};
`;

/**
 * The sentence a blocked release check shows. It must be enough for a reader to
 * adopt the adapter without opening the source.
 */
export function missingTicketFaceHint(): string {
  return [
    "inject a ticket-face adapter before running the release gate:",
    '  1. add to verify/profile.ts: ticketFace: { module: "verify/ticket-face.mjs" }',
    '     (or ticketFace: { module: "verify/ticket-face.mjs", exportName: "createTicketFace" } for a named export)',
    "  2. the module must export { kind, listChecklistIssues(), listComments(issueNumber),",
    "     resolveReleaseCommit(), isAncestor(commit, descendant) }; isAncestor returns",
    '     true, false or "unknown" — returning false when Git cannot answer is a lie',
    "  3. GitHub/GitLab adapters read their own token; a markdown adapter reads the local",
    "     issue files. Return the checklist body and comments verbatim, oldest first",
    "without an adapter, release checks report blocked (exit 2), never fail.",
    "",
    TICKET_FACE_ADAPTER_TEMPLATE,
  ].join("\n");
}

/** Read an error's stable code without trusting the thrown value. */
function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function adapterFailure(
  kind: "blocked" | "failed",
  code: Failure["code"],
  message: string,
  hint?: string,
): Result<never, TicketFaceAdapterFailure> {
  return err({ ...failure(code, message, hint), kind });
}

/** Does this value look like a path rather than a package name? */
function looksLikePath(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    specifier.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(specifier)
  );
}

/** Resolve a declared module to the specifier import() receives. */
async function resolveSpecifier(
  fs: FsPort,
  repoRoot: string,
  module: string,
): Promise<{ readonly specifier: string; readonly isPath: boolean; readonly absolutePath: string | null }> {
  let candidate: string | null = null;
  if (looksLikePath(module)) {
    candidate =
      isWindowsAbsolute(module) || isPosixAbsolute(module) ? module : resolveAgainst(repoRoot, module);
  } else if (module.includes("/") && !module.startsWith("@")) {
    // verify/ticket-face.mjs is a repository-relative path. A missing file is
    // a missing adapter, not a package name: importing it would report a package
    // resolution error that hides the real fix.
    candidate = joinFsPath(repoRoot, module);
  } else if (await fs.exists(joinFsPath(repoRoot, module))) {
    candidate = joinFsPath(repoRoot, module);
  }
  if (candidate === null) return { specifier: module, isPath: false, absolutePath: null };
  return { specifier: pathToFileURL(candidate).href, isPath: true, absolutePath: candidate };
}

/** Classify an import failure without blaming the product. */
function classifyImportFailure(
  error: unknown,
  specifier: string,
  isPath: boolean,
): Result<never, TicketFaceAdapterFailure> {
  const code = errorCode(error);
  const message = describeThrown(error);
  const resolutionCodes = new Set([
    "ERR_MODULE_NOT_FOUND",
    "ERR_PACKAGE_PATH_NOT_EXPORTED",
    "ERR_UNSUPPORTED_DIR_IMPORT",
  ]);
  if (code !== null && resolutionCodes.has(code)) {
    const missingPackage = /Cannot find package '([^']+)'/.exec(message)?.[1] ?? null;
    if (missingPackage !== null && !isPath) {
      return adapterFailure(
        "blocked",
        "prerequisite",
        `the ticket-face adapter package ${missingPackage} is not installed in this repository: ${message}`,
        `install ${missingPackage} in the plugin repository (the adapter resolution starts there), then rerun`,
      );
    }
    return adapterFailure(
      "blocked",
      "prerequisite",
      `the ticket-face adapter module could not be resolved: ${specifier} (${message})`,
      missingTicketFaceHint(),
    );
  }
  const runtimeCodes = new Set([
    "ERR_UNKNOWN_FILE_EXTENSION",
    "ERR_UNSUPPORTED_ESM_URL_SCHEME",
    "ERR_UNKNOWN_MODULE_FORMAT",
  ]);
  if (code !== null && runtimeCodes.has(code)) {
    return adapterFailure(
      "blocked",
      "unsupported",
      `this Node cannot import the ticket-face adapter (${code}): ${specifier}`,
      "upgrade Node (22.6+ can strip TypeScript types), or compile the adapter to .js/.mjs and point ticketFace.module at the output; " +
        missingTicketFaceHint(),
    );
  }
  return adapterFailure(
    "failed",
    "invalid-input",
    `the ticket-face adapter module threw while loading: ${message}`,
    "the adapter must only define its object; move network and file reads inside the methods;\n\n" +
      missingTicketFaceHint(),
  );
}

/**
 * Import the declared adapter and prove it has the promised shape.
 *
 * Nothing is fetched here: loading must stay side-effect free, so a plan or a
 * dry run can tell whether an adapter exists without touching the tracker.
 */
export async function loadTicketFaceAdapter(
  options: LoadTicketFaceAdapterOptions,
): Promise<TicketFaceAdapterLoadResult> {
  const { fs, repoRoot, declaration } = options;
  if (typeof declaration.module !== "string" || declaration.module.length === 0) {
    return adapterFailure(
      "blocked",
      "invalid-input",
      "profile.ticketFace.module is empty",
      missingTicketFaceHint(),
    );
  }

  const resolved = await resolveSpecifier(fs, repoRoot, declaration.module);
  if (resolved.isPath && resolved.absolutePath !== null) {
    if (!(await fs.exists(resolved.absolutePath))) {
      return adapterFailure(
        "blocked",
        "prerequisite",
        `the ticket-face adapter module does not exist: ${resolved.absolutePath}`,
        `create the module, or point profile.ticketFace.module at a path relative to ${repoRoot};\n\n` +
          missingTicketFaceHint(),
      );
    }
  }

  let namespace: unknown;
  try {
    namespace = await (options.importModule ?? nativeImport)(resolved.specifier);
  } catch (error) {
    return classifyImportFailure(error, resolved.specifier, resolved.isPath);
  }

  if (typeof namespace !== "object" || namespace === null) {
    return adapterFailure(
      "failed",
      "invalid-input",
      `the ticket-face adapter ${resolved.specifier} did not load as a module`,
      missingTicketFaceHint(),
    );
  }

  const exports = namespace as Record<string, unknown>;
  const requested = declaration.exportName;
  let value: unknown;
  let exportName: string;
  if (requested !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(exports, requested)) {
      return adapterFailure(
        "failed",
        "invalid-input",
        `the ticket-face adapter ${resolved.specifier} has no export named ${JSON.stringify(requested)}`,
        `export it, or drop ticketFace.exportName to use the default export;\n\n` + missingTicketFaceHint(),
      );
    }
    value = exports[requested];
    exportName = requested;
  } else if (exports.default !== undefined) {
    value = exports.default;
    exportName = "default";
  } else {
    // CommonJS interop can surface module.exports = adapter as the namespace
    // itself; accepting that shape beats telling the author their adapter is
    // "not a module" when Node already made one.
    value = exports;
    exportName = "module";
  }

  const validated = validateTicketFaceAdapter(value);
  if (!validated.ok) {
    return adapterFailure(
      "failed",
      "invalid-input",
      `the ticket-face adapter ${resolved.specifier} export ${exportName} is not a TicketFaceAdapter: ${validated.error.message}`,
      (validated.error.hint ?? "implement every method in contracts/ticket-face.ts") +
        "\n\n" +
        missingTicketFaceHint(),
    );
  }

  return {
    ok: true,
    value: {
      adapter: validated.value,
      specifier: resolved.specifier,
      module: declaration.module,
      exportName,
    },
  };
}
