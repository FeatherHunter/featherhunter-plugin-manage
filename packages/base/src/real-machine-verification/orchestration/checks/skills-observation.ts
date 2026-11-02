/**
 * Skill observation: turn the host's file-tree roots and the package's shipped
 * directory into a registry-shaped observation.
 *
 * Why the file tree and not skills/list or a model-facing catalog: the host
 * hides skills marked disable-model-invocation: true from the model, so a
 * count taken from that surface is wrong for most published plugins. The
 * registry the host builds is (a) the package's bundled skill directory and
 * (b) the per-user/per-project root table - both observable read-only as a tree
 * of <name>/SKILL.md directories and flat <name>.md files, with the
 * skill's own frontmatter name deciding registration. Everything here is a
 * batch of small, testable functions; the check composes them.
 */
import type { FsPort } from "../../contracts/ports";
import { ok, type Result } from "../../contracts/result";
import type { ShippedSkill, SkillObservation } from "../../contracts/skills-rules";
import { readFrontmatterName } from "../../contracts/skills-rules";
import { baseName, joinFsPath, parentFsPath, resolveAgainst, samePath } from "../../runtime/paths";

/** One discoverable host root and the registry rank the host gives it. */
export interface SkillRootSpec {
  readonly source: string;
  readonly rank: number;
  /** Absolute path, or null for a root that cannot be observed read-only. */
  readonly path: string | null;
  readonly note: string | null;
}

/** Inputs for the root table. Paths are absolute; the port resolves them. */
export interface SkillRootInput {
  readonly cwd: string;
  readonly dshHome: string;
  readonly homeDir: string;
  /** DSH_AGENTS_HOME, when the environment sets it. */
  readonly agentsHome?: string | undefined;
  /** DSH_BUNDLED_SKILL_DIR, when the environment sets it. */
  readonly bundledSkillDir?: string | undefined;
}

/** One root after a best-effort read. A root that does not exist is data, not an error. */
export interface SkillRootObservation {
  readonly source: string;
  readonly rank: number;
  readonly path: string | null;
  readonly exists: boolean;
  /** Registered names (frontmatter name equal to the entry name). */
  readonly count: number;
  readonly names: readonly string[];
  /** Entries the host would silently skip, recorded only as notes. */
  readonly problems: readonly string[];
  readonly note: string | null;
}

/** The host gives up after this many ancestors when looking for the project root. */
const MAX_PROJECT_DEPTH = 64;

/**
 * The host's project root: the nearest ancestor (including cwd) with a .git
 * entry, falling back to cwd when the checkout is not a git repository.
 */
export async function findProjectRoot(fs: FsPort, cwd: string): Promise<string> {
  let current: string | null = cwd;
  for (let depth = 0; current !== null && depth < MAX_PROJECT_DEPTH; depth += 1) {
    if (await fs.exists(joinFsPath(current, ".git"))) return current;
    current = parentFsPath(current);
  }
  return cwd;
}

/** The six-root table the host uses, lowest rank winning. */
export function planSkillRoots(projectRoot: string, input: SkillRootInput): readonly SkillRootSpec[] {
  const agentsHome = (input.agentsHome ?? "").trim().length > 0
    ? resolveAgainst(input.cwd, (input.agentsHome ?? "").trim())
    : joinFsPath(input.homeDir, ".agents");
  const roots: SkillRootSpec[] = [
    { source: "project-dsh", rank: 100, path: joinFsPath(projectRoot, ".dsh", "skills"), note: null },
    { source: "project-agents", rank: 200, path: joinFsPath(projectRoot, ".agents", "skills"), note: null },
    {
      source: "custom",
      rank: 300,
      path: null,
      note: "custom root (config.customSkillDirs) cannot be observed read-only; ignored",
    },
    { source: "user-dsh", rank: 400, path: joinFsPath(input.dshHome, "skills"), note: null },
    { source: "user-agents", rank: 500, path: joinFsPath(agentsHome, "skills"), note: null },
  ];
  const bundled = (input.bundledSkillDir ?? "").trim();
  if (bundled.length > 0) {
    roots.push({
      source: "bundled-env",
      rank: 600,
      path: resolveAgainst(input.cwd, bundled),
      note: "from DSH_BUNDLED_SKILL_DIR",
    });
  }
  return roots;
}

/** One first-level candidate, keeping the entry kind for callers that need it. */
interface SkillTreeEntry {
  readonly dirName: string;
  readonly content: string;
  readonly kind: "directory" | "file";
}

/**
 * Enumerate one skill directory: directories containing SKILL.md and flat
 * *.md files, sorted by entry name. Returns the raw content so the caller can
 * decide what a broken frontmatter means.
 */
async function enumerateSkillTree(
  fs: FsPort,
  dir: string,
  options: { readonly skip?: readonly string[] } = {},
): Promise<Result<readonly SkillTreeEntry[]>> {
  const listed = await fs.list(dir);
  if (!listed.ok) return listed;
  const skip = new Set(options.skip ?? []);
  const entries: SkillTreeEntry[] = [];
  for (const entry of listed.value) {
    if (skip.has(entry.name) || entry.name.length === 0) continue;
    if (entry.kind === "directory") {
      const read = await fs.readText(joinFsPath(dir, entry.name, "SKILL.md"));
      if (read.ok) entries.push({ dirName: entry.name, content: read.value, kind: "directory" });
      continue;
    }
    if (entry.kind === "file" && /\.md$/i.test(entry.name)) {
      const read = await fs.readText(joinFsPath(dir, entry.name));
      if (read.ok) entries.push({ dirName: entry.name.replace(/\.md$/i, ""), content: read.value, kind: "file" });
    }
  }
  entries.sort((left, right) => (left.dirName < right.dirName ? -1 : left.dirName > right.dirName ? 1 : 0));
  return ok(entries);
}

/** Public enumeration for root observation: every candidate, kind erased. */
export async function enumerateSkillDirectory(
  fs: FsPort,
  dir: string,
  options: { readonly skip?: readonly string[] } = {},
): Promise<Result<readonly ShippedSkill[]>> {
  const entries = await enumerateSkillTree(fs, dir, options);
  if (!entries.ok) return entries;
  return ok(entries.value.map((entry) => ({ dirName: entry.dirName, content: entry.content })));
}

/** A file that lives next to the skills but is not one. */
export interface IgnoredSkillFile {
  readonly name: string;
  readonly reason: string;
}

/** What shipped-skill discovery found: the skills plus the docs files it skipped. */
export interface ShippedSkillDiscovery {
  readonly skills: readonly ShippedSkill[];
  /** Flat markdown files without a frontmatter name: the host would not register them. */
  readonly ignored: readonly IgnoredSkillFile[];
}

/**
 * Shipped-skill discovery for the repository and the installed package.
 *
 * The host only registers a flat <name>.md as a skill when its frontmatter has
 * a name; a README.md or LICENSE.md sitting next to the skills is a
 * documentation file, not a skill the host silently drops. Reporting it as a
 * missing name would turn every published package with a README into a false
 * red. The declared count still catches a *removed* skill through
 * compareSkillSets, and directory entries keep the strict missing-name failure.
 */
export async function discoverShippedSkills(
  fs: FsPort,
  dir: string,
): Promise<Result<ShippedSkillDiscovery>> {
  const entries = await enumerateSkillTree(fs, dir);
  if (!entries.ok) return entries;
  const skills: ShippedSkill[] = [];
  const ignored: IgnoredSkillFile[] = [];
  for (const entry of entries.value) {
    if (entry.kind === "file" && readFrontmatterName(entry.content) === null) {
      ignored.push({
        name: entry.dirName,
        reason: "flat markdown file without a readable frontmatter name is documentation, not a skill",
      });
      continue;
    }
    skills.push({ dirName: entry.dirName, content: entry.content });
  }
  return ok({ skills, ignored });
}

/** Read the host's root table. Missing/unreadable roots are observations, not errors. */
export async function observeSkillRoots(
  fs: FsPort,
  input: SkillRootInput,
): Promise<readonly SkillRootObservation[]> {
  const projectRoot = await findProjectRoot(fs, input.cwd);
  const roots = planSkillRoots(projectRoot, input);
  const observed: SkillRootObservation[] = [];
  for (const root of roots) {
    if (root.path === null) {
      observed.push({ source: root.source, rank: root.rank, path: null, exists: false, count: 0, names: [], problems: [], note: root.note });
      continue;
    }
    const listed = await enumerateSkillDirectory(fs, root.path, {
      skip: root.source === "user-dsh" ? [".system"] : [],
    });
    if (!listed.ok) {
      observed.push({
        source: root.source,
        rank: root.rank,
        path: root.path,
        exists: false,
        count: 0,
        names: [],
        problems: [],
        note: listed.error.code === "not-found" ? root.note : listed.error.message,
      });
      continue;
    }
    const names: string[] = [];
    const problems: string[] = [];
    for (const skill of listed.value) {
      const declared = readFrontmatterName(skill.content);
      if (declared === null) {
        problems.push(root.source + ": " + skill.dirName + " has no readable frontmatter name; the host would skip it");
        continue;
      }
      if (declared !== skill.dirName) {
        problems.push(root.source + ": " + skill.dirName + " declares name " + JSON.stringify(declared) + "; the host would skip it");
        continue;
      }
      names.push(declared);
    }
    names.sort();
    observed.push({
      source: root.source,
      rank: root.rank,
      path: root.path,
      exists: true,
      count: names.length,
      names,
      problems,
      note: root.note,
    });
  }
  return observed;
}

/** Flatten root observations into registry observations (source = root source). */
export function skillObservationsFromRoots(
  roots: readonly SkillRootObservation[],
): readonly SkillObservation[] {
  const observations: SkillObservation[] = [];
  for (const root of roots) {
    for (const name of root.names) {
      observations.push({
        name,
        source: root.source,
        rank: root.rank,
        ...(root.path === null ? {} : { dir: joinFsPath(root.path, name) }),
      });
    }
  }
  return observations;
}

/** How the installed copy's skill directory was found. */
export type InstalledSkillsResolution = "declared-path" | "basename-at-package-root" | "missing";

/** Result of looking for the skills directory inside the installed package. */
export interface InstalledSkillsLookup {
  readonly path: string | null;
  readonly resolution: InstalledSkillsResolution;
  readonly tried: readonly string[];
}

/**
 * Find the shipped skill directory in the installed package.
 *
 * The declared dir is relative to the package root. A package that changes
 * its built layout may keep the directory only under its last segment, so the
 * basename at the package root is tried second. Which spelling was used is
 * recorded, because "found it somewhere else" is a fact the reader needs.
 */
export async function findInstalledSkillsDir(
  fs: FsPort,
  packageDir: string,
  dir: string,
): Promise<InstalledSkillsLookup> {
  const declared = joinFsPath(packageDir, ...dir.split("/"));
  const candidates: { readonly path: string; readonly resolution: Exclude<InstalledSkillsResolution, "missing"> }[] = [
    { path: declared, resolution: "declared-path" },
  ];
  const fallback = joinFsPath(packageDir, baseName(dir));
  if (!samePath(fallback, declared)) candidates.push({ path: fallback, resolution: "basename-at-package-root" });
  const tried: string[] = [];
  for (const candidate of candidates) {
    tried.push(candidate.path);
    const listed = await fs.list(candidate.path);
    if (listed.ok) return { path: candidate.path, resolution: candidate.resolution, tried };
  }
  return { path: null, resolution: "missing", tried };
}

/** One name the host registered twice from different sources. */
export interface SkillObservationConflict {
  readonly name: string;
  readonly kept: { readonly source: string; readonly rank: number | null };
  readonly ignored: readonly { readonly source: string; readonly rank: number | null }[];
}

/** The merged observation set plus the precedence conflicts it resolved. */
export interface MergedSkillObservations {
  readonly observations: readonly SkillObservation[];
  readonly conflicts: readonly SkillObservationConflict[];
}

function rankOf(observation: SkillObservation): number {
  return observation.rank ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Merge the installed copy (source bundled, rank 600) with the host roots.
 *
 * Across sources the lowest rank wins, exactly as the host resolves a name held
 * by two providers; the conflict is recorded. Diagonally, duplicates inside
 * one source are kept, so compareSkillSets can report a registry that lists
 * the same name twice - a real defect, not a precedence decision.
 */
export function mergeSkillObservations(
  entries: readonly SkillObservation[],
): MergedSkillObservations {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  indexed.sort((left, right) => rankOf(left.entry) - rankOf(right.entry) || left.index - right.index);
  const groups = new Map<string, { readonly entry: SkillObservation; readonly index: number }[]>();
  for (const item of indexed) {
    const group = groups.get(item.entry.name);
    if (group === undefined) groups.set(item.entry.name, [item]);
    else group.push(item);
  }
  const observations: SkillObservation[] = [];
  const conflicts: SkillObservationConflict[] = [];
  for (const [name, group] of groups) {
    const sources = new Set(group.map((item) => item.entry.source));
    if (sources.size <= 1) {
      for (const item of group) observations.push(item.entry);
      continue;
    }
    const [first, ...rest] = group;
    observations.push(first.entry);
    conflicts.push({
      name,
      kept: { source: first.entry.source, rank: first.entry.rank ?? null },
      ignored: rest.map((item) => ({ source: item.entry.source, rank: item.entry.rank ?? null })),
    });
  }
  return { observations, conflicts };
}
