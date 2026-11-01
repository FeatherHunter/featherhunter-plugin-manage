import { writeFile } from "node:fs/promises";

import type { Result } from "../../contracts/result.js";
import { err, failure, ok } from "../../contracts/result.js";

/**
 * Binary write seam for package installation.
 *
 * FsPort is text/json only, and widening it would change a shared contract and
 * every fake in the test suite. Installation is the one operation that must put
 * opaque tarball bytes on disk, so it carries its own minimal writer instead.
 * Callers inject this; tests replace it with an in-memory implementation.
 */
export interface BinaryWriter {
  write(path: string, bytes: Uint8Array): Promise<Result<{ readonly bytes: number }>>;
}

export function createBinaryWriter(): BinaryWriter {
  return {
    async write(path, bytes) {
      try {
        await writeFile(path, bytes);
        return ok({ bytes: bytes.byteLength });
      } catch (error) {
        return err(failure("io", `failed to write ${path}: ${error instanceof Error ? error.message : String(error)}`, "check the target directory exists and is writable"));
      }
    },
  };
}
