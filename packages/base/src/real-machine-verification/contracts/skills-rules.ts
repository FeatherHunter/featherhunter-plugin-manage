/**
 * Skill rules: compare what a package *ships* with what the host actually
 * registered, without falling into the trap that made the old check lie.
 *
 * A plugin may ship N skills; the host registers all N under one provider. The
 * model-facing catalog, however, only lists *model-invocable* skills. A plugin
 * that marks most of its skills `disable-model-invocation: true` therefore shows
 * a much smaller number in a model's tool list, and a check that counts that list
 * reports a false failure — for years, silently.
 *
 * The correct observation is the registry itself (names + source), compared as a
 * set. Everything here is pure: the caller lists directories, reads frontmatter
 * and asks the host; these functions decide whether the set is right.
 */
import { err, ok, type Result } from "./result";

/** One skill as the host registry reports it. */
export interface SkillObservation {
  readonly name: string;
  /** Where it came from: `bundled`, `project`, `user`, `custom`… Host-defined. */
  readonly source: string;
  /** Provider precedence when the host reports it (lower wins). */
  readonly rank?: number;
  readonly dir?: string;
}

/** What the package claims to ship. */
export interface SkillSetExpectation {
  /** Exact skill names, in any order. */
  readonly names: readonly string[];
  /** Count the package expects. Kept explicit so a wrong list cannot pass silently. */
  readonly expectedCount: number;
}

/** The outcome of comparing an expectation with an observation. */
export interface SkillSetComparison {
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly duplicated: readonly string[];
  readonly observedCount: number;
  readonly expectedCount: number;
  readonly notes: readonly string[];
}

/**
 * A const attached to hints, because this is the single most likely
 * misinterpretation of an otherwise correct run.
 */
export const MODEL_CATALOG_CAVEAT =
  "do not count skills from a model-facing catalog: the host hides skills marked disable-model-invocation";

/**
 * Compare the declared set with the observed registry snapshot.
 *
 * `extra` only lists observed skills from `source === "bundled"`: the host also
 * registers project and user skills, and those are not this plugin's business.
 */
export function compareSkillSets(
  expectation: SkillSetExpectation,
  observed: readonly SkillObservation[],
): Result<SkillSetComparison> {
  const expected = new Set<string>();
  for (const name of expectation.names) {
    if (typeof name !== "string" || name.length === 0) {
      return err({ code: "invalid-input", message: "expected skill names must be non-empty strings" });
    }
    if (expected.has(name)) {
      return err({
        code: "invalid-input",
        message: `expected skill set lists ${name} twice`,
        hint: "the declaration and the shipped directory list disagree; fix the declaration",
      });
    }
    expected.add(name);
  }
  if (expectation.expectedCount !== expected.size) {
    return err({
      code: "invalid-input",
      message: `declared expectedCount ${expectation.expectedCount} does not match the ${expected.size} declared names`,
      hint: "count and names must describe the same set, otherwise a dropped skill can pass unnoticed",
    });
  }

  const counts = new Map<string, number>();
  for (const skill of observed) {
    counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  }
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort();
  const observedNames = new Set(counts.keys());

  const missing = [...expected].filter((name) => !observedNames.has(name)).sort();
  const extra = [...observedNames]
    .filter((name) => !expected.has(name) && observed.some((skill) => skill.name === name && skill.source === "bundled"))
    .sort();

  const notes: string[] = [];
  if (duplicated.length > 0) {
    notes.push(`registry reported duplicate names: ${duplicated.join(", ")}`);
  }
  if (observed.length !== expected.size) {
    notes.push(
      `registry returned ${observed.length} skill(s), the package declares ${expected.size}; extra non-bundled sources are expected to be filtered by the caller`,
    );
  }

  return ok({
    ok: missing.length === 0 && extra.length === 0 && duplicated.length === 0,
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
    duplicated: Object.freeze(duplicated),
    observedCount: observed.length,
    expectedCount: expected.size,
    notes: Object.freeze(notes),
  });
}

/** One skill directory as found inside the package. */
export interface ShippedSkill {
  /** Directory name, e.g. `grilling`. */
  readonly dirName: string;
  /** Raw `SKILL.md` content. */
  readonly content: string;
}

/** The names a shipped directory set declares, after checking the frontmatter matches. */
export interface ShippedSkillSet {
  readonly names: readonly string[];
  /** Skills whose frontmatter `name:` disagrees with their directory name. */
  readonly mismatches: readonly { readonly dirName: string; readonly declared: string | null }[];
  readonly missingFrontmatter: readonly string[];
}

/**
 * Extract `name` from a Markdown file's YAML frontmatter.
 *
 * A deliberately small reader: frontmatter is a `---` fence at the top followed
 * by `key: value` lines. It returns `null` rather than guessing, because a skill
 * with broken frontmatter is skipped by the host *silently* — the exact failure
 * this check exists to catch.
 */
export function readFrontmatterName(content: string): string | null {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") return null;
    const match = /^name:\s*(.*)$/.exec(line);
    if (match !== null) {
      const raw = match[1].trim();
      const unquoted = raw.replace(/^(['"])(.*)\1$/, "$2").trim();
      return unquoted.length === 0 ? null : unquoted;
    }
  }
  return null;
}

/**
 * Check every shipped skill's frontmatter against its directory name.
 *
 * The host requires `frontmatter.name === directory name` to register a skill; a
 * mismatch is dropped without an error, so a package can "ship 27 skills" and
 * register 26 with a green build.
 */
export function inspectShippedSkills(skills: readonly ShippedSkill[]): Result<ShippedSkillSet> {
  if (skills.length === 0) {
    return err({
      code: "prerequisite",
      message: "no skill directories were found in the package",
      hint: "check the declaration's bundledSkills.dir and that the package was built with its bundled directory",
    });
  }
  const names: string[] = [];
  const mismatches: { dirName: string; declared: string | null }[] = [];
  const missingFrontmatter: string[] = [];
  for (const skill of skills) {
    const declared = readFrontmatterName(skill.content);
    if (declared === null) {
      missingFrontmatter.push(skill.dirName);
      continue;
    }
    if (declared !== skill.dirName) {
      mismatches.push({ dirName: skill.dirName, declared });
      continue;
    }
    names.push(declared);
  }
  names.sort();
  return ok({
    names: Object.freeze(names),
    mismatches: Object.freeze(mismatches),
    missingFrontmatter: Object.freeze(missingFrontmatter),
  });
}

/** One sentence describing a failed comparison, for a check's `detail`. */
export function describeComparison(comparison: SkillSetComparison): string {
  if (comparison.ok) {
    return `registry contains exactly the ${comparison.expectedCount} declared skill(s)`;
  }
  const parts: string[] = [];
  if (comparison.missing.length > 0) parts.push(`missing ${comparison.missing.join(", ")}`);
  if (comparison.extra.length > 0) parts.push(`unexpected ${comparison.extra.join(", ")}`);
  if (comparison.duplicated.length > 0) parts.push(`duplicated ${comparison.duplicated.join(", ")}`);
  return parts.join("; ");
}
