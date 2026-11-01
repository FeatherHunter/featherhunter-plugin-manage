/**
 * Proving that settings isolation actually works, not just that an env var was set.
 *
 * `DSH_HOME` isolates profiles and storage, but a plugin that writes
 * `<home>/.dsh/<plugin>/settings.yaml` is only isolated if `USERPROFILE`/`HOME`
 * are redirected too. Reading the launch environment and saying "looks right" is
 * a guess about behaviour. This probe *executes* the situation: it starts a tiny
 * child process with the redirected environment, has the child resolve its own
 * home and write a marker, and then compares the developer's real settings file
 * before and after.
 *
 * The comparison is the load-bearing part. A probe that reports "the child wrote
 * to the temporary home" still passes if the child *also* wrote to the real home.
 * Hashing the real file on both sides is what turns the claim into evidence.
 */
import { sha256Text } from "../../contracts/identity";
import { BASE_ENV_ALLOWLIST } from "../../contracts/launch-plan";
import type { Ports } from "../../contracts/ports";
import { err, ok, type Result } from "../../contracts/result";
import { measureTree } from "../fs-utils";
import { joinFsPath } from "../paths";

export interface SettingsIsolationOptions {
  readonly ports: Ports;
  /** Where the probe's own files live (inside the batch directory). */
  readonly probeRoot: string;
  /** Directory name the plugin uses under `<home>/.dsh/`. */
  readonly settingsDir: string;
  /** The real DSH home (`~/.dsh`), whose settings must stay untouched. */
  readonly realHome: string;
  /** Redirected home the probe is given. */
  readonly redirectedHome: string;
  readonly timeoutMs?: number;
}

export interface SettingsIsolationResult {
  readonly ok: boolean;
  readonly redirectedHome: string;
  readonly childHomedir: string | null;
  readonly markerPath: string | null;
  readonly wroteMarker: boolean;
  readonly realSettingsPath: string;
  readonly realSettingsSha256Before: string | null;
  readonly realSettingsSha256After: string | null;
  readonly realSettingsUnchanged: boolean;
  readonly problems: readonly string[];
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The `node -e` program the probe runs. Kept tiny: it only reports what it saw. */
function probeScript(settingsDir: string): string {
  return [
    "const os=require('os'),fs=require('fs'),path=require('path');",
    "const home=os.homedir();",
    `const dir=path.join(home,'.dsh',${JSON.stringify(settingsDir)});`,
    "fs.mkdirSync(dir,{recursive:true});",
    "const marker=path.join(dir,'settings.yaml');",
    "fs.writeFileSync(marker,JSON.stringify({probe:true}));",
    "const back=fs.readFileSync(marker,'utf8');",
    "console.log(JSON.stringify({home,marker,wrote:back.length>0}));",
  ].join("");
}

/** Environment for the probe: allowlisted parent values, then the redirects. */
function probeEnv(parent: Readonly<Record<string, string>>, redirectedHome: string): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const name of BASE_ENV_ALLOWLIST) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  env.USERPROFILE = redirectedHome;
  env.HOME = redirectedHome;
  return Object.freeze(env);
}

/**
 * Run the probe. `ok` requires all three claims: the child saw the redirected
 * home, it could write and read there, and the real settings file is byte-identical.
 */
export async function probeSettingsIsolation(options: SettingsIsolationOptions): Promise<Result<SettingsIsolationResult>> {
  const { ports, probeRoot, settingsDir, realHome, redirectedHome } = options;
  const { fs, command, env } = ports;

  const realSettingsPath = joinFsPath(realHome, settingsDir, "settings.yaml");
  const before = await fs.hashFile(realSettingsPath);
  const beforeHash = before.ok ? before.value : null;
  const realExisted = await fs.exists(realSettingsPath);

  const made = await fs.makeDir(probeRoot);
  if (!made.ok) return made;

  const script = probeScript(settingsDir);
  const run = await command.run({
    argv: [env.execPath(), "-e", script],
    cwd: probeRoot,
    env: probeEnv(env.snapshot(), redirectedHome),
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  if (!run.ok) return run;

  const stdout = run.value.stdout;
  const lastLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .pop();

  let parsed: Record<string, unknown> | null = null;
  if (lastLine !== undefined) {
    try {
      const value = JSON.parse(lastLine) as unknown;
      if (typeof value === "object" && value !== null) parsed = value as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  const childHomedir = typeof parsed?.home === "string" ? parsed.home : null;
  const markerPath = typeof parsed?.marker === "string" ? parsed.marker : null;
  const wroteMarker = parsed?.wrote === true;

  const after = await fs.hashFile(realSettingsPath);
  const afterHash = after.ok ? after.value : null;
  const realSettingsUnchanged = beforeHash === afterHash;
  const realSettingsBytes = realExisted ? (await measureTree(fs, joinFsPath(realHome, settingsDir))).ok : false;
  void realSettingsBytes;

  const problems: string[] = [];
  if (run.value.exitCode !== 0) problems.push(`the probe process exited with code ${String(run.value.exitCode)}`);
  if (childHomedir === null) problems.push("the probe did not report its home directory");
  else if (!samePathLoose(childHomedir, redirectedHome)) {
    problems.push(`the child resolved its home to ${childHomedir}, not the redirected ${redirectedHome}`);
  }
  if (!wroteMarker) problems.push("the child could not write its marker file under the redirected home");
  if (!realSettingsUnchanged) {
    problems.push("the developer's real settings file changed while the probe ran; isolation is not effective");
  }

  return ok({
    ok: problems.length === 0,
    redirectedHome,
    childHomedir,
    markerPath,
    wroteMarker,
    realSettingsPath,
    realSettingsSha256Before: beforeHash,
    realSettingsSha256After: afterHash,
    realSettingsUnchanged,
    problems: Object.freeze(problems),
    command: [env.execPath(), "-e", "<probe script>"],
    exitCode: run.value.exitCode,
    stdout,
    stderr: run.value.stderr,
  });
}

/** Compare homes the way the platform does: case-insensitively on Windows paths. */
function samePathLoose(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const trimmed = value.replace(/[\\/]+$/, "");
    return /^[A-Za-z]:/.test(trimmed) ? trimmed.toLowerCase().replace(/\//g, "\\") : trimmed;
  };
  return normalize(left) === normalize(right);
}

/** A short fingerprint for reports: hash only, never file contents. */
export async function settingsFingerprint(ports: Ports, realHome: string, settingsDir: string): Promise<string | null> {
  const path = joinFsPath(realHome, settingsDir, "settings.yaml");
  const hashed = await ports.fs.hashFile(path);
  if (!hashed.ok) return null;
  return sha256Text(hashed.value).slice(0, 16);
}

/** Re-exported so callers do not have to import an unused helper from two paths. */
export { err as _err };
