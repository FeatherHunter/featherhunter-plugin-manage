/**
 * Model configuration observation and repair for one profile's patch layer.
 *
 * The rules live in `contracts/profile-rules` (pure text in, pure text out). This
 * module owns the two things a pure rule cannot: reading the file and deciding
 * whether a change is allowed to touch the disk.
 *
 * Safety properties:
 *
 * - A conforming file is never written, so `--fix` is idempotent and leaves the
 *   bytes (and the mtime) alone.
 * - A missing `agent-default-model` or `llm-pi-ai` entry is a refusal, not an
 *   invitation to invent a plugin entry this package does not own.
 * - After writing, the file is read back and inspected again. The plan's own text
 *   is never trusted as proof; a write that did not stick is reported as a failed
 *   recheck, not a success.
 * - Credential observation reads reference *names* only. The value of an
 *   environment variable is tested for presence and discarded immediately; no
 *   report can carry it.
 */
import type { EnvPort, FsPort } from "../../contracts/ports";
import {
  inspectModelConfig,
  planModelConfigEdit,
  type ModelConfigState,
} from "../../contracts/profile-rules";
import { failure, type Failure, type Result } from "../../contracts/result";
import type { ModelSelection } from "../../contracts/verification-profile";
import { joinFsPath } from "../paths";
import { credentialStorePath, probeCredentialStore } from "./credentials";

/** The patch layer every profile keeps next to its package.json. */
export const MODEL_PATCH_FILE = "cordis.patch.yml";

/** `<profileDir>/cordis.patch.yml`. */
export function modelPatchPath(profileDir: string): string {
  return joinFsPath(profileDir, MODEL_PATCH_FILE);
}

/** One read of the patch layer plus what the rules made of it. */
export interface ModelConfigObservation {
  readonly patchPath: string;
  readonly text: string;
  readonly state: ModelConfigState;
}

/**
 * Read the patch layer and inspect it. A missing file is a prerequisite, not an
 * empty configuration: this command never creates the patch file.
 */
export async function readModelConfig(
  fs: FsPort,
  profileDir: string,
  selection: ModelSelection,
): Promise<Result<ModelConfigObservation>> {
  const patchPath = modelPatchPath(profileDir);
  const read = await fs.readText(patchPath);
  if (!read.ok) {
    return {
      ok: false,
      error: failure(
        read.error.code,
        `cannot read the profile patch layer ${patchPath}: ${read.error.message}`,
        `open the profile once (or launch DSH with --profile <name>) so DSH writes ${MODEL_PATCH_FILE}, then rerun; this command never creates the file`,
        { patchPath },
      ),
    };
  }
  return {
    ok: true,
    value: {
      patchPath,
      text: read.value,
      state: inspectModelConfig(read.value, selection),
    },
  };
}

/** What one `--fix` attempt did. A refusal and a write failure are values, not throws. */
export interface ModelFixOutcome {
  /** The plan found at least one line to change. */
  readonly changed: boolean;
  /** The new text reached the filesystem (the write call succeeded). */
  readonly written: boolean;
  /** Human-readable notes for the report; never secret values. */
  readonly notes: readonly string[];
  /** The state read back from disk after a successful write; null otherwise. */
  readonly after: ModelConfigObservation | null;
  /** Why the attempt stopped, when it did. */
  readonly failure: Failure | null;
}

/**
 * Plan and (only if the plan changes something) write the minimal edit.
 *
 * The write is followed by a read-back, so `after` is always what the disk says,
 * never what the plan hoped it would say.
 */
export async function fixModelConfig(
  fs: FsPort,
  observation: ModelConfigObservation,
  selection: ModelSelection,
): Promise<ModelFixOutcome> {
  const plan = planModelConfigEdit(observation.text, selection);
  if (!plan.ok) {
    return { changed: false, written: false, notes: [], after: null, failure: plan.error };
  }
  if (!plan.value.changed) {
    return {
      changed: false,
      written: false,
      notes: [...plan.value.notes],
      after: observation,
      failure: null,
    };
  }

  const write = await fs.writeText(observation.patchPath, plan.value.text);
  if (!write.ok) {
    return {
      changed: true,
      written: false,
      notes: [...plan.value.notes],
      after: null,
      failure: failure(
        "io",
        `could not write the profile patch layer ${observation.patchPath}: ${write.error.message}`,
        "the patch file is unchanged; fix the file permission or the disk and rerun --fix",
        { patchPath: observation.patchPath },
      ),
    };
  }

  const readBack = await fs.readText(observation.patchPath);
  if (!readBack.ok) {
    return {
      changed: true,
      written: true,
      notes: [...plan.value.notes],
      after: null,
      failure: failure(
        "io",
        `wrote the profile patch layer ${observation.patchPath}, but could not read it back: ${readBack.error.message}`,
        "the file was changed; inspect it by hand before rerunning, and do not assume the fix took effect",
        { patchPath: observation.patchPath },
      ),
    };
  }

  return {
    changed: true,
    written: true,
    notes: [...plan.value.notes],
    after: {
      patchPath: observation.patchPath,
      text: readBack.value,
      state: inspectModelConfig(readBack.value, selection),
    },
    failure: null,
  };
}

/** Where an available credential reference resolves. Never the value itself. */
export type CredentialPresenceSource = "dsh-home" | "env" | null;

/** Presence of one credential reference; deliberately not the credential. */
export interface CredentialPresence {
  readonly ref: string;
  readonly available: boolean;
  readonly source: CredentialPresenceSource;
  readonly storePath: string;
  readonly storeReadable: boolean;
  readonly storeRefPresent: boolean;
  /** Why the reference is unavailable; never a secret value. */
  readonly note: string | null;
}

/**
 * Check the profile home's credential store first, then the process environment.
 *
 * This command targets a profile in the real DSH home, so there is no batch home
 * to consult. The environment is read only for presence: the value is tested and
 * dropped in the same expression, and nothing in the returned object can carry it.
 */
export async function observeCredentialPresence(
  fs: FsPort,
  env: EnvPort,
  dshHome: string,
  ref: string,
): Promise<CredentialPresence> {
  const storePath = credentialStorePath(dshHome);
  const store = await probeCredentialStore(fs, storePath, ref);
  if (store.refPresent) {
    return {
      ref,
      available: true,
      source: "dsh-home",
      storePath,
      storeReadable: store.readable,
      storeRefPresent: true,
      note: null,
    };
  }

  const value = env.get(ref);
  if (value !== undefined && value.length > 0) {
    return {
      ref,
      available: true,
      source: "env",
      storePath,
      storeReadable: store.readable,
      storeRefPresent: false,
      note: null,
    };
  }

  const notes: string[] = [];
  if (!store.readable) {
    notes.push(`the credential store ${storePath} is not readable (${store.note ?? "no detail"})`);
  } else {
    notes.push(`${storePath} does not list ${ref}`);
  }
  notes.push(`the process environment does not define ${ref}`);
  return {
    ref,
    available: false,
    source: null,
    storePath,
    storeReadable: store.readable,
    storeRefPresent: false,
    note: notes.join("; "),
  };
}
