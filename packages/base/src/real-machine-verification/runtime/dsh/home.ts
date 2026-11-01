/**
 * Isolated homes: copying a profile and seeding the workspace registry.
 *
 * Two facts about the host drive this file.
 *
 * 1. `DSH_HOME` is the whole isolation boundary for profiles and storage, but not
 *    for everything: an isolated instance still needs a profile that already has
 *    the plugin installed, so the honest way to build one is to copy the real
 *    profile and then stop trusting it — the copy is disposable and its plugin
 *    logs are removed so a later run cannot read yesterday's evidence.
 * 2. The workspace picker is a native dialog, which a headless run cannot click.
 *    The registry is a plain JSON store, so the runtime writes the registry entry
 *    directly. The id derivation is deterministic (sha256 of the lowercased path)
 *    so the same workspace keeps the same id across batches — otherwise every run
 *    would create a new "workspace" and the UI would fill with duplicates.
 */
import { sha256Text } from "../../contracts/identity";
import type { FsPort } from "../../contracts/ports";
import { err, ok, type Result } from "../../contracts/result";
import { measureTree, removeTree } from "../fs-utils";
import { baseName, joinFsPath, toPosixPath } from "../paths";
import type { EnvPort } from "../../contracts/ports";

/** The developer's real DSH home. Never written to by this tool. */
export function resolveRealHome(env: EnvPort): string {
  const explicit = env.get("DSH_REAL_HOME");
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const userProfile = env.get("USERPROFILE") ?? env.homeDir();
  return joinFsPath(userProfile, ".dsh");
}

export interface CopyProfileOptions {
  readonly fs: FsPort;
  readonly sourceHome: string;
  readonly targetHome: string;
  readonly profile: string;
  /** Plugin cache directory to strip of `logs` in the copy, e.g. `.dsh-demo-cache`. */
  readonly pluginCacheDir?: string;
  /** Replace an existing target home instead of refusing. */
  readonly force?: boolean;
}

export interface CopyProfileOutcome {
  readonly sourceProfileDir: string;
  readonly targetProfileDir: string;
  readonly files: number;
  readonly bytes: number;
  /** Directory that was deleted because it held stale plugin logs, when any. */
  readonly removedLogDirectory: string | null;
}

/**
 * Copy `<sourceHome>/profiles/<profile>` into a fresh home.
 *
 * Stale plugin logs are removed from the copy: a log file that already contains
 * hundreds of events from a previous run would make "the plugin logged something"
 * true before the instance ever started, which is exactly the kind of vacuous
 * evidence this tool exists to reject.
 */
export async function copyProfile(options: CopyProfileOptions): Promise<Result<CopyProfileOutcome>> {
  const { fs, sourceHome, targetHome, profile } = options;
  const sourceProfileDir = joinFsPath(sourceHome, "profiles", profile);
  const targetProfileDir = joinFsPath(targetHome, "profiles", profile);

  const sourceStat = await fs.stat(sourceProfileDir);
  if (!sourceStat.ok) {
    return err({
      code: "prerequisite",
      message: `source profile directory does not exist: ${sourceProfileDir}`,
      hint: "open DSH once with this profile, or pass --source-home pointing at a home that has it",
    });
  }
  if (sourceStat.value.kind !== "directory") {
    return err({ code: "prerequisite", message: `source profile is not a directory: ${sourceProfileDir}` });
  }

  const targetExists = await fs.exists(targetHome);
  if (targetExists) {
    if (options.force !== true) {
      return err({
        code: "conflict",
        message: `target home already exists: ${targetHome}`,
        hint: "pass --force to replace it, or choose a new batch name",
      });
    }
    const removed = await removeTree(fs, targetHome);
    if (!removed.ok) return removed;
  }

  const created = await fs.makeDir(joinFsPath(targetHome, "profiles"));
  if (!created.ok) return created;
  const copied = await fs.copy(sourceProfileDir, targetProfileDir, { recursive: true });
  if (!copied.ok) return copied;

  let removedLogDirectory: string | null = null;
  if (options.pluginCacheDir !== undefined && options.pluginCacheDir.length > 0) {
    const logDirectory = joinFsPath(targetProfileDir, options.pluginCacheDir, "logs");
    if (await fs.exists(logDirectory)) {
      const removed = await removeTree(fs, logDirectory);
      if (!removed.ok) return removed;
      removedLogDirectory = logDirectory;
    }
  }

  const measured = await measureTree(fs, targetProfileDir);
  if (!measured.ok) return measured;
  return ok({
    sourceProfileDir,
    targetProfileDir,
    files: measured.value.files,
    bytes: measured.value.bytes,
    removedLogDirectory,
  });
}

/**
 * Deterministic workspace id: sha256 of the lowercased absolute path, shaped as a
 * UUIDv4 so the host accepts it. The path is normalized to `/` first because the
 * same workspace must keep one id whether it was registered on Windows or Linux.
 */
export function workspaceIdForPath(path: string): string {
  const hex = sha256Text(toPosixPath(path).trim().toLowerCase()).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export interface WorkspaceSeed {
  /** Absolute path the instance should treat as its workspace. */
  readonly path: string;
  /** Display title; defaults to the directory name. */
  readonly title?: string;
}

export interface SeedWorkspaceRegistryOptions {
  readonly fs: FsPort;
  readonly home: string;
  readonly workspaces: readonly WorkspaceSeed[];
  /** Which seeded workspace is the default one. */
  readonly defaultPath?: string;
  /** Timestamp written into each new entry. Caller supplies it from the clock port. */
  readonly nowIso: string;
}

interface WorkspaceEntry {
  readonly path: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface WorkspaceRegistry {
  readonly unit: { readonly name: "workspace"; readonly version: 2 };
  readonly global: {
    readonly initialized: boolean;
    readonly workspaceIds: readonly string[];
    readonly archivedSessionIds: readonly string[];
    readonly pinnedSessionIds: readonly string[];
    readonly defaultWorkspaceId: string | null;
  };
  readonly tables: { readonly workspaces: Readonly<Record<string, WorkspaceEntry>> };
}

export function workspaceRegistryPath(home: string): string {
  return joinFsPath(home, "storages", "workspace.json");
}

function emptyRegistry(): WorkspaceRegistry {
  return {
    unit: { name: "workspace", version: 2 },
    global: {
      initialized: true,
      workspaceIds: [],
      archivedSessionIds: [],
      pinnedSessionIds: [],
      defaultWorkspaceId: null,
    },
    tables: { workspaces: {} },
  };
}

/** Read the registry, treating an absent or unreadable file as an empty one. */
export async function readWorkspaceRegistry(fs: FsPort, home: string): Promise<Result<WorkspaceRegistry>> {
  const file = workspaceRegistryPath(home);
  if (!(await fs.exists(file))) return ok(emptyRegistry());
  const raw = await fs.readJson(file);
  if (!raw.ok) return raw;
  const value = raw.value;
  if (typeof value !== "object" || value === null) {
    return err({ code: "io", message: `workspace registry is not a JSON object: ${file}` });
  }
  const record = value as Record<string, unknown>;
  const workspaces = record.tables !== undefined && typeof record.tables === "object" && record.tables !== null
    ? (record.tables as Record<string, unknown>).workspaces
    : undefined;
  const entries: Record<string, WorkspaceEntry> = {};
  if (workspaces !== undefined && typeof workspaces === "object" && workspaces !== null) {
    for (const [id, entry] of Object.entries(workspaces as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.path !== "string") continue;
      entries[id] = {
        path: item.path,
        title: typeof item.title === "string" ? item.title : baseName(item.path),
        sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds.filter((value): value is string => typeof value === "string") : [],
        createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
      };
    }
  }
  const globalRecord = typeof record.global === "object" && record.global !== null ? (record.global as Record<string, unknown>) : {};
  const registry: WorkspaceRegistry = {
    unit: { name: "workspace", version: 2 },
    global: {
      initialized: globalRecord.initialized === true,
      workspaceIds: Array.isArray(globalRecord.workspaceIds)
        ? globalRecord.workspaceIds.filter((value): value is string => typeof value === "string")
        : Object.keys(entries),
      archivedSessionIds: Array.isArray(globalRecord.archivedSessionIds)
        ? globalRecord.archivedSessionIds.filter((value): value is string => typeof value === "string")
        : [],
      pinnedSessionIds: Array.isArray(globalRecord.pinnedSessionIds)
        ? globalRecord.pinnedSessionIds.filter((value): value is string => typeof value === "string")
        : [],
      defaultWorkspaceId: typeof globalRecord.defaultWorkspaceId === "string" ? globalRecord.defaultWorkspaceId : null,
    },
    tables: { workspaces: entries },
  };
  return ok(registry);
}

/**
 * Register seeded workspaces in the isolated home's storage.
 *
 * Existing entries are preserved: a batch may seed two workspaces into a home
 * that already knows one, and dropping the third would make the menu state depend
 * on the order the caller seeded them.
 */
export async function seedWorkspaceRegistry(options: SeedWorkspaceRegistryOptions): Promise<Result<readonly string[]>> {
  const { fs, home, workspaces, nowIso } = options;
  const current = await readWorkspaceRegistry(fs, home);
  if (!current.ok) return current;

  const entries: Record<string, WorkspaceEntry> = { ...current.value.tables.workspaces };
  const ids: string[] = [...current.value.global.workspaceIds];
  for (const workspace of workspaces) {
    const id = workspaceIdForPath(workspace.path);
    const existing = entries[id];
    entries[id] = {
      path: workspace.path,
      title: workspace.title ?? baseName(workspace.path),
      sessionIds: existing?.sessionIds ?? [],
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    if (!ids.includes(id)) ids.push(id);
  }

  let defaultWorkspaceId = current.value.global.defaultWorkspaceId;
  if (options.defaultPath !== undefined) {
    defaultWorkspaceId = workspaceIdForPath(options.defaultPath);
  } else if (defaultWorkspaceId === null && ids.length > 0) {
    defaultWorkspaceId = ids[0];
  }

  const next: WorkspaceRegistry = {
    unit: { name: "workspace", version: 2 },
    global: {
      initialized: true,
      workspaceIds: ids,
      archivedSessionIds: current.value.global.archivedSessionIds,
      pinnedSessionIds: current.value.global.pinnedSessionIds,
      defaultWorkspaceId,
    },
    tables: { workspaces: entries },
  };

  const directory = joinFsPath(home, "storages");
  const madeDir = await fs.makeDir(directory);
  if (!madeDir.ok) return madeDir;
  const written = await fs.writeJson(workspaceRegistryPath(home), next);
  if (!written.ok) return written;
  return ok(ids);
}
