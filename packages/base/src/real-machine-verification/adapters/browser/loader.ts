/**
 * Loading the plugin repository's browser adapter.
 *
 * The core package owns no browser library: a plugin repository declares an
 * adapter module in `verify/profile.ts` (`browser: { module, exportName? }`)
 * and this loader imports it. Two properties matter:
 *
 * - **The import is dynamic and non-analyzable.** The production import wraps
 *   `import()` in a `new Function`, exactly like the declaration loader, so
 *   esbuild cannot inline the adapter's module graph into the core bundle. The
 *   core build stays free of browser dependencies even when the adapter has some.
 * - **A missing adapter is `blocked`, never `fail`.** "No adapter" says nothing
 *   about the product, so the loader returns an error classified as `blocked`
 *   (or `failed` when the adapter module exists but is wrong) and the caller
 *   maps any failure to a `blocked` page check. A false red is worse than an
 *   honest "we could not look".
 *
 * A bare `module` value is ambiguous by design: `verify/browser.mjs` looks
 * like a package subpath to Node. The loader resolves that ambiguity the only
 * honest way: a path-looking value (or a bare value that exists under the
 * repository root) is imported as a file URL; anything else is imported as a
 * package specifier.
 */
import { pathToFileURL } from "node:url";

import type { BrowserProbeFactory, FsPort } from "../../contracts/ports";
import { err, failure, type Failure, type Result } from "../../contracts/result";
import type { BrowserAdapterDeclaration } from "../../contracts/verification-profile";
import {
  isPosixAbsolute,
  isWindowsAbsolute,
  joinFsPath,
  resolveAgainst,
} from "../../runtime/paths";

/** Import one module specifier. Injectable so tests need no real files. */
export type BrowserAdapterImport = (specifier: string) => Promise<unknown>;

/** A loaded adapter plus enough provenance for a report to cite it. */
export interface LoadedBrowserAdapter {
  readonly factory: BrowserProbeFactory;
  /** The specifier handed to `import()`: a file URL or a package name. */
  readonly specifier: string;
  /** The declared module value, unchanged. */
  readonly module: string;
  /** `default` or the named export that supplied the factory. */
  readonly exportName: string;
}

/**
 * An adapter failure, classified.
 *
 * `blocked` means the machine/repository cannot provide the adapter (missing
 * module, unsupported runtime); `failed` means the module exists but does not
 * export the promised shape. The page check maps both to `blocked` because
 * neither says anything about the product; the classification stays available
 * for a report that wants to separate "missing" from "misconfigured".
 */
export type BrowserAdapterFailure = Failure & { readonly kind: "blocked" | "failed" };

export type BrowserAdapterLoadResult = Result<LoadedBrowserAdapter, BrowserAdapterFailure>;

export interface LoadBrowserAdapterOptions {
  readonly fs: FsPort;
  /** Plugin repository root; relative modules resolve against it. */
  readonly repoRoot: string;
  readonly declaration: BrowserAdapterDeclaration;
  /** Defaults to a native dynamic import; tests inject their own. */
  readonly importModule?: BrowserAdapterImport;
}

/** The production import: native `import()` behind a non-analyzable indirection. */
const nativeImport: BrowserAdapterImport = (specifier) => {
  const load = new Function("specifier", "return import(specifier);") as (value: string) => Promise<unknown>;
  return load(specifier);
};

/**
 * Copy-paste adapter skeleton.
 *
 * Deliberately library-neutral: the plugin repository already has a browser
 * driver (or none), and this capability must not choose one for it.
 */
export const BROWSER_ADAPTER_TEMPLATE = `// verify/browser.mjs — the adapter page checks import.
// Declare it in verify/profile.ts as:
//   browser: { module: "verify/browser.mjs" }
export default {
  async launch({ headless }) {
    const driver = await startMyBrowser({ headless }); // the plugin's own driver
    return {
      ok: true,
      value: {
        async newPage() {
          const page = await driver.openPage();
          return { ok: true, value: page }; // page implements BrowserPageHandle
        },
        async close() {
          await driver.close();
        },
      },
    };
  },
};
`;

/**
 * The sentence a blocked page check shows. It must be enough for a reader to
 * adopt the adapter without opening the source.
 */
export function missingBrowserAdapterHint(): string {
  return [
    "inject a browser adapter for page-level checks:",
    `  1. add to verify/profile.ts: browser: { module: "verify/browser.mjs" }`,
    `     (or browser: { module: "verify/browser.mjs", exportName: "createBrowserAdapter" } for a named export)`,
    "  2. the module must export { launch({ headless }) } where launch returns",
    "     { ok: true, value: { newPage(), close() } } (or { ok: false, error })",
    "  3. every page must implement url(), evaluate(), innerSize(), outerSize(),",
    "     text(), screenshot(), pageErrors() and close() (contracts/ports.ts)",
    "without an adapter, page checks report blocked (exit 2), never fail.",
    "",
    BROWSER_ADAPTER_TEMPLATE,
  ].join("\n");
}

/** Read an error's stable `code` without trusting the thrown value. */
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
): Result<never, BrowserAdapterFailure> {
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

/** Resolve a declared module to the specifier `import()` receives. */
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
    // `verify/browser.mjs` is a repository-relative path. A missing file is a
    // missing adapter, not a package name: importing it would report a package
    // resolution error that hides the real fix.
    candidate = joinFsPath(repoRoot, module);
  } else if (await fs.exists(joinFsPath(repoRoot, module))) {
    // A bare file name at the repository root is still a path when it exists.
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
): Result<never, BrowserAdapterFailure> {
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
        `the browser adapter package ${missingPackage} is not installed in this repository: ${message}`,
        `install ${missingPackage} in the plugin repository (the adapter resolution starts there), then rerun`,
      );
    }
    return adapterFailure(
      "blocked",
      "prerequisite",
      `the browser adapter module could not be resolved: ${specifier} (${message})`,
      missingBrowserAdapterHint(),
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
      `this Node cannot import the browser adapter (${code}): ${specifier}`,
      "upgrade Node (22.6+ can strip TypeScript types), or compile the adapter to .js/.mjs and point browser.module at the output; " +
        missingBrowserAdapterHint(),
    );
  }
  return adapterFailure(
    "failed",
    "invalid-input",
    `the browser adapter module threw while loading: ${message}`,
    "the adapter must only define its factory; move side effects into launch();\n\n" + missingBrowserAdapterHint(),
  );
}

/** A factory is an object with a callable `launch`; nothing more is assumed. */
function asFactory(value: unknown): BrowserProbeFactory | null {
  if (typeof value !== "object" || value === null) return null;
  const launch = (value as { launch?: unknown }).launch;
  if (typeof launch !== "function") return null;
  return value as BrowserProbeFactory;
}

/**
 * Import the declared adapter and prove it has the promised shape.
 *
 * Nothing is launched here: loading must stay side-effect free, because a dry
 * run and a plan need to know whether an adapter exists without starting a
 * browser.
 */
export async function loadBrowserAdapter(
  options: LoadBrowserAdapterOptions,
): Promise<BrowserAdapterLoadResult> {
  const { fs, repoRoot, declaration } = options;
  if (typeof declaration.module !== "string" || declaration.module.length === 0) {
    return adapterFailure(
      "blocked",
      "invalid-input",
      "profile.browser.module is empty",
      missingBrowserAdapterHint(),
    );
  }

  const resolved = await resolveSpecifier(fs, repoRoot, declaration.module);
  if (resolved.isPath && resolved.absolutePath !== null) {
    if (!(await fs.exists(resolved.absolutePath))) {
      return adapterFailure(
        "blocked",
        "prerequisite",
        `the browser adapter module does not exist: ${resolved.absolutePath}`,
        `create the module, or point profile.browser.module at a path relative to ${repoRoot};\n\n` +
          missingBrowserAdapterHint(),
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
      `the browser adapter ${resolved.specifier} did not load as a module`,
      missingBrowserAdapterHint(),
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
        `the browser adapter ${resolved.specifier} has no export named ${JSON.stringify(requested)}`,
        `export it, or drop browser.exportName to use the default export;\n\n` + missingBrowserAdapterHint(),
      );
    }
    value = exports[requested];
    exportName = requested;
  } else if (exports.default !== undefined) {
    value = exports.default;
    exportName = "default";
  } else {
    // CommonJS interop can surface `module.exports = factory` as the namespace
    // itself; accepting that shape beats telling the author their adapter is
    // "not a module" when Node already made one.
    value = exports;
    exportName = "module";
  }

  const factory = asFactory(value);
  if (factory === null) {
    return adapterFailure(
      "failed",
      "invalid-input",
      `the browser adapter ${resolved.specifier} export ${exportName} is not a BrowserProbeFactory`,
      "expected an object with a launch({ headless }) function;\n\n" + missingBrowserAdapterHint(),
    );
  }

  return {
    ok: true,
    value: { factory, specifier: resolved.specifier, module: declaration.module, exportName },
  };
}
