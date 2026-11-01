/**
 * The real filesystem port, plus the bounded slice reader used for asar headers.
 *
 * Every method returns `Result` instead of throwing. That is not ceremony: "the
 * client entry is missing" and "the disk went away" are different facts, and a
 * thrown error erases the difference right where a check needs it most.
 */
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";

import { sha256Bytes } from "../../contracts/identity";
import type { CopyOutcome, DirEntry, FileKind, FileStat, FsPort } from "../../contracts/ports";
import { err, failure, ok, type Result } from "../../contracts/result";
import type { ReadFileSlice } from "../types";

/** Turn a caught error into the one shape the rest of the capability understands. */
function ioFailure(message: string, error: unknown, hint?: string): Result<never> {
  const detail = error instanceof Error ? error.message : String(error);
  return err(failure("io", `${message}: ${detail}`, hint));
}

function kindOf(stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileKind {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "symlink";
  return "other";
}

/** The Node implementation of `FsPort`. One instance per invocation. */
export function createFsPort(): FsPort {
  return {
    async readText(path) {
      try {
        return ok(await readFile(path, "utf8"));
      } catch (error) {
        return ioFailure(`could not read ${path}`, error);
      }
    },
    async writeText(path, text) {
      try {
        await writeFile(path, text, "utf8");
        return ok(undefined);
      } catch (error) {
        return ioFailure(`could not write ${path}`, error);
      }
    },
    async readJson(path) {
      const text = await this.readText(path);
      if (!text.ok) return text;
      try {
        return ok(JSON.parse(text.value) as unknown);
      } catch (error) {
        return ioFailure(`${path} is not valid JSON`, error, "fix the file, or delete it so the tool can recreate it");
      }
    },
    async writeJson(path, value) {
      return this.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
    },
    async readBytes(path) {
      try {
        return ok(new Uint8Array(await readFile(path)));
      } catch (error) {
        return ioFailure(`could not read ${path}`, error);
      }
    },
    async hashFile(path) {
      const bytes = await this.readBytes(path);
      if (!bytes.ok) return bytes;
      return ok(sha256Bytes(bytes.value));
    },
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    async stat(path) {
      try {
        const stats = await stat(path);
        const value: FileStat = { kind: kindOf(stats), size: stats.size, mtimeMs: stats.mtimeMs };
        return ok(value);
      } catch (error) {
        return ioFailure(`could not stat ${path}`, error);
      }
    },
    async list(path) {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        const value: DirEntry[] = entries
          .map((entry) => ({
            name: entry.name,
            kind: entry.isFile()
              ? ("file" as const)
              : entry.isDirectory()
                ? ("directory" as const)
                : entry.isSymbolicLink()
                  ? ("symlink" as const)
                  : ("other" as const),
          }))
          .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
        return ok(value);
      } catch (error) {
        return ioFailure(`could not list ${path}`, error);
      }
    },
    async makeDir(path) {
      try {
        await mkdir(path, { recursive: true });
        return ok(undefined);
      } catch (error) {
        return ioFailure(`could not create ${path}`, error);
      }
    },
    async remove(path, options) {
      try {
        await rm(path, { recursive: options?.recursive === true, force: false });
        return ok(undefined);
      } catch (error) {
        return ioFailure(`could not remove ${path}`, error);
      }
    },
    async copy(from, to, options) {
      try {
        await cp(from, to, { recursive: options?.recursive === true });
        const measured = await measureCopyTarget(to);
        return ok(measured);
      } catch (error) {
        return ioFailure(`could not copy ${from} to ${to}`, error);
      }
    },
    async move(from, to) {
      try {
        await rename(from, to);
        return ok(undefined);
      } catch (error) {
        return ioFailure(`could not move ${from} to ${to}`, error);
      }
    },
    async realPath(path) {
      try {
        return ok(await realpath(path));
      } catch (error) {
        return ioFailure(`could not resolve ${path}`, error);
      }
    },
  };
}

/** Files and bytes below a copied tree, for a plan or a report. */
async function measureCopyTarget(path: string): Promise<CopyOutcome> {
  const stats = await lstat(path);
  if (stats.isFile()) return { files: 1, bytes: stats.size };
  const entries = await readdir(path, { withFileTypes: true });
  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      const nested = await measureCopyTarget(child);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await lstat(child)).size;
    }
  }
  return { files, bytes };
}

/**
 * Read a byte range from a file.
 *
 * The length and offset are validated before the handle is opened: an asar header
 * length comes from bytes inside the archive, i.e. from a file this tool did not
 * write, so `Buffer.alloc(4 GB)` must not be reachable from a corrupted archive.
 */
export const readFileSlice: ReadFileSlice = async (path, offset, length) => {
  if (!Number.isInteger(offset) || offset < 0) {
    return err(failure("invalid-input", `slice offset must be a non-negative integer, got ${String(offset)}`));
  }
  if (!Number.isInteger(length) || length <= 0) {
    return err(failure("invalid-input", `slice length must be a positive integer, got ${String(length)}`));
  }
  const handle = await open(path, "r").catch(() => null);
  if (handle === null) {
    return err(failure("io", `could not open ${path}`));
  }
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return ok(new Uint8Array(buffer.subarray(0, bytesRead)));
  } catch (error) {
    return ioFailure(`could not read ${path}`, error);
  } finally {
    await handle.close().catch(() => undefined);
  }
};
