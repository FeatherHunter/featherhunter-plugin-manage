/**
 * Entry-point detection for the `dsh-verify` bundle.
 *
 * A package installed from a local directory (`file:` dependency, `npm link`,
 * pnpm `link:`) can be reached through a junction/symlink. Node resolves
 * `import.meta.url` to the real path of the module, while `process.argv[1]`
 * keeps the path the caller typed. Comparing the two directly therefore fails
 * for every linked install and the CLI silently does nothing — a green run that
 * proved nothing, which is exactly the failure mode this capability exists to
 * prevent.
 *
 * The check below accepts either spelling: the literal argv path or its
 * realpath. Both are compared against the module URL, so it works with and
 * without `--preserve-symlinks`.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type RealPathResolver = (path: string) => string;

function toFileUrl(path: string): string {
  try {
    return pathToFileURL(path).href;
  } catch {
    return "";
  }
}

/**
 * True when the module at `moduleUrl` was started as the process entry point.
 *
 * @param argv1 `process.argv[1]` of the running process (may be undefined).
 * @param moduleUrl `import.meta.url` of the module that owns the entry guard.
 * @param resolveRealPath injectable for tests; defaults to `fs.realpathSync`.
 */
export function isCliEntryPoint(
  argv1: string | undefined,
  moduleUrl: string,
  resolveRealPath: RealPathResolver = realpathSync,
): boolean {
  if (argv1 === undefined || argv1 === "") return false;
  const direct = toFileUrl(argv1);
  if (direct !== "" && direct === moduleUrl) return true;
  try {
    const real = toFileUrl(resolveRealPath(argv1));
    return real !== "" && real === moduleUrl;
  } catch {
    return false;
  }
}

