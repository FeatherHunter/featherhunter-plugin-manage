/**
 * The screen port: physical display sizes, best effort per platform.
 *
 * The check that consumes this asks a narrow question ("does this machine have a
 * screen at all?"), so the port reports the answer and never throws. A headless
 * machine, a missing `xrandr`, or a PowerShell that refuses to load WinForms all
 * become `Result` failures, which the check turns into `blocked` — not a false
 * `fail` about the product.
 */
import type { CommandPort, EnvPort, ScreenInfo, ScreenPort } from "../../contracts/ports";
import { err, failure, ok, type Result } from "../../contracts/result";

const POWERSHELL_SCREENS =
  "Add-Type -AssemblyName System.Windows.Forms; " +
  "[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { " +
  "[pscustomobject]@{ Id = $_.DeviceName; Primary = [bool]$_.Primary; Width = $_.Bounds.Width; Height = $_.Bounds.Height } } | " +
  "ConvertTo-Json -Compress";

function parseJsonScreens(text: string): Result<readonly ScreenInfo[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch (error) {
    return err(failure("unsupported", `screen probe returned unparsable JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const screens: ScreenInfo[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const width = typeof record["Width"] === "number" ? record["Width"] : 0;
    const height = typeof record["Height"] === "number" ? record["Height"] : 0;
    if (width <= 0 || height <= 0) continue;
    screens.push({
      id: typeof record["Id"] === "string" && record["Id"].length > 0 ? record["Id"] : `screen-${screens.length + 1}`,
      primary: record["Primary"] === true,
      width,
      height,
    });
  }
  return ok(screens);
}

function parseXRandR(text: string): readonly ScreenInfo[] {
  const seen = new Set<string>();
  const screens: ScreenInfo[] = [];
  for (const match of text.matchAll(/(\d+)x(\d+)\+\d+\+\d+/g)) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    const key = `${width}x${height}`;
    if (!Number.isFinite(width) || !Number.isFinite(height) || seen.has(key)) continue;
    seen.add(key);
    screens.push({ id: key, primary: screens.length === 0, width, height });
  }
  return screens;
}

export interface ScreenPortOptions {
  readonly command: CommandPort;
  readonly env: EnvPort;
}

export function createScreenPort(options: ScreenPortOptions): ScreenPort {
  return {
    async screens(): Promise<Result<readonly ScreenInfo[]>> {
      const platform = options.env.platform();
      if (platform === "win32") {
        const run = await options.command.run({
          argv: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_SCREENS],
          timeoutMs: 20_000,
        });
        if (!run.ok) return run;
        if (run.value.exitCode !== 0) {
          return err(
            failure(
              "unsupported",
              `PowerShell screen probe exited ${String(run.value.exitCode)}`,
              "inject a ScreenPort, or open a desktop session before asking for screen checks",
              { stderr: run.value.stderr.slice(-500) },
            ),
          );
        }
        return parseJsonScreens(run.value.stdout);
      }
      if (platform === "darwin") {
        const run = await options.command.run({
          argv: ["system_profiler", "SPDisplaysDataType"],
          timeoutMs: 20_000,
        });
        if (!run.ok) return run;
        const matches = [...run.value.stdout.matchAll(/Resolution:\s*(\d+)\s*x\s*(\d+)/gi)];
        const screens = matches.map((match, index) => ({
          id: `display-${index + 1}`,
          primary: index === 0,
          width: Number(match[1]),
          height: Number(match[2]),
        }));
        if (screens.length === 0) {
          return err(failure("unsupported", "system_profiler reported no display resolution"));
        }
        return ok(screens);
      }
      if (platform === "linux") {
        const run = await options.command.run({ argv: ["xrandr", "--query"], timeoutMs: 10_000 });
        if (!run.ok) return run;
        const screens = parseXRandR(run.value.stdout);
        if (screens.length === 0) return err(failure("unsupported", "xrandr reported no connected display"));
        return ok(screens);
      }
      return err(failure("unsupported", `no screen probe for platform ${platform}`, "inject a ScreenPort in this runtime"));
    },
  };
}
