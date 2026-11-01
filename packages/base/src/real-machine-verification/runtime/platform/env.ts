/**
 * The environment port: everything the tool needs to know about the machine it is
 * running on, read once instead of reached for from every check.
 */
import { homedir, tmpdir } from "node:os";

import type { EnvPort, PlatformName } from "../../contracts/ports";

function platformName(): PlatformName {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "other";
}

export function createEnvPort(): EnvPort {
  return {
    get: (name) => process.env[name],
    snapshot: () => {
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) values[key] = value;
      }
      return values;
    },
    homeDir: () => homedir(),
    tmpDir: () => tmpdir(),
    platform: platformName,
    execPath: () => process.execPath,
    cwd: () => process.cwd(),
  };
}
