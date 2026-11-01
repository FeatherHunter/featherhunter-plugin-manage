/**
 * Post-build contracts for the published bundles.
 *
 * Kept apart from the build pipeline so the rules can be tested directly: a rule
 * that only runs inside a full build is a rule nobody can prove still works.
 *
 * - `self-contained`: the bundle references nothing outside itself (plugins inline
 *   it, so a surviving import would resolve against the plugin's own tree).
 * - `node-builtins`: every non-relative specifier starts with `node:`, which keeps
 *   one plugin from dragging a dependency into another plugin's host process.
 */

/** How a finished bundle is allowed to reference the outside world. */
export type BundleContract = "self-contained" | "node-builtins";

/** One broken rule, with the sentence the build prints. */
export interface BundleContractViolation {
  readonly contract: BundleContract;
  /** Already includes the bundle id, so a build log is actionable on its own. */
  readonly message: string;
}

/** Non-relative specifiers a finished bundle imports or re-exports. */
export function externalSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.add(specifier);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.add(specifier);
  }
  return [...specifiers].filter((specifier) => !specifier.startsWith("."));
}

/** The rules a `self-contained` bundle can break, in the order they are reported. */
const SELF_CONTAINED_RULES: readonly (readonly [string, RegExp])[] = [
  ["static import", /(^|\n)\s*import\b/],
  ["require()", /\brequire\s*\(/],
  ["dynamic import()", /\bimport\s*\(/],
];

/**
 * Check one finished bundle against its contract.
 *
 * Pure: the source is the only input. Returns every violation instead of throwing
 * so tests (and a future build summary) can see all problems in one pass.
 */
export function checkBundleContract(
  id: string,
  source: string,
  contract: BundleContract,
): BundleContractViolation[] {
  if (contract === "self-contained") {
    return SELF_CONTAINED_RULES.filter(([, pattern]) => pattern.test(source)).map(([name]) => ({
      contract,
      message: `${id} must stay self-contained; found ${name}`,
    }));
  }

  return externalSpecifiers(source)
    .filter((specifier) => !specifier.startsWith("node:"))
    .map((specifier) => ({
      contract,
      message: `${id} imports "${specifier}" — node-platform bundles may only import node: builtins`,
    }));
}

/** Throw when a bundle breaks its contract; the build calls this for every entry. */
export function assertBundleContract(id: string, source: string, contract: BundleContract): void {
  const violations = checkBundleContract(id, source, contract);
  if (violations.length > 0) throw new Error(violations.map((violation) => violation.message).join("; "));
}
