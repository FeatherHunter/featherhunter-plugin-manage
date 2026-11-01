/**
 * Reading a plugin's own log.
 *
 * The plugin writes one JSON object per line into
 * `<instance cwd>/<plugin cache dir>/logs/<YYYY-MM-DD>.log`. That file is the only
 * place the host does not mediate, which makes it the strongest available signal
 * that *the plugin itself ran* — a page can render a shell with no plugin behind
 * it, and a registry can list a provider that never executed a command.
 *
 * Bad lines are counted, not fatal: a log being written while it is read is an
 * ordinary race, and treating it as a failure would produce a flaky gate. Callers
 * set their own threshold (the built-in check fails on zero events, not on one
 * torn line).
 */
import type { ClockPort, DirEntry, FsPort } from "../../contracts/ports";
import { err, ok, type Result } from "../../contracts/result";
import { joinFsPath } from "../paths";

/** One parsed line of the plugin log. */
export interface PluginLogEvent {
  /** 1-based line number, so a report can point at the file. */
  readonly line: number;
  readonly raw: string;
  /** Parsed JSON when the line is an object; `null` for a torn or non-JSON line. */
  readonly json: Record<string, unknown> | null;
  readonly event: string | null;
  readonly level: string | null;
  readonly ts: string | null;
}

export interface PluginLogRead {
  readonly file: string;
  readonly events: readonly PluginLogEvent[];
  readonly badLines: number;
  readonly bytes: number;
}

export interface LogQuery {
  /** Exact event name(s). */
  readonly event?: string | readonly string[];
  /** Exact level. */
  readonly level?: string;
  /** Fields must match; looked up in `json.fields` first, then at the top level. */
  readonly fields?: Readonly<Record<string, string | number | boolean>>;
  /** Only events whose timestamp is at or after this epoch millisecond value. */
  readonly sinceMs?: number;
}

export interface PluginLogSummary {
  readonly total: number;
  readonly badLines: number;
  readonly firstTs: string | null;
  readonly lastTs: string | null;
  readonly byEvent: Readonly<Record<string, number>>;
  readonly byLevel: Readonly<Record<string, number>>;
}

const LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.log$/;

/** `<startCwd>/<pluginCacheDir>/logs` — where the plugin writes. */
export function pluginLogDirectory(startCwd: string, pluginCacheDir: string): string {
  return joinFsPath(startCwd, pluginCacheDir, "logs");
}

/** Date part of the clock's local ISO string, e.g. `2026-11-01`. */
export function localDate(clock: ClockPort): string {
  return clock.iso().slice(0, 10);
}

/**
 * Newest log file in a log directory, or the one for `date` when given.
 *
 * Returning the newest file is right for "did anything happen in this run",
 * because a run that crosses midnight writes two files and the newest one is the
 * one still being appended to.
 */
export async function findLatestPluginLog(
  fs: FsPort,
  logDir: string,
  options: { readonly date?: string } = {},
): Promise<Result<string>> {
  const listed = await fs.list(logDir);
  if (!listed.ok) {
    return err({
      code: "not-found",
      message: `plugin log directory does not exist: ${logDir}`,
      hint: "the instance may have failed before the plugin loaded; check instance.stderr.log",
    });
  }
  const matches = (entries: readonly DirEntry[]): DirEntry[] =>
    entries.filter((entry) => entry.kind === "file" && LOG_FILE_PATTERN.test(entry.name));
  const candidates = matches(listed.value)
    .map((entry) => entry.name)
    .filter((name) => options.date === undefined || name.startsWith(`${options.date}.log`) || name.startsWith(options.date))
    .sort();
  if (candidates.length === 0) {
    return err({
      code: "not-found",
      message: `no log file ${options.date === undefined ? "" : `for ${options.date} `}in ${logDir}`,
      hint: `expected a file named <YYYY-MM-DD>.log; found: ${listed.value.map((entry) => entry.name).slice(0, 10).join(", ") || "(empty)"}`,
    });
  }
  return ok(joinFsPath(logDir, candidates[candidates.length - 1]));
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Parse a log file. Torn and non-JSON lines are counted, never thrown. */
export async function readPluginLog(fs: FsPort, file: string): Promise<Result<PluginLogRead>> {
  const read = await fs.readText(file);
  if (!read.ok) return read;
  const rawLines = read.value.split(/\r?\n/);
  const events: PluginLogEvent[] = [];
  let badLines = 0;
  for (const [index, raw] of rawLines.entries()) {
    if (raw.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      badLines += 1;
      events.push({ line: index + 1, raw, json: null, event: null, level: null, ts: null });
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      badLines += 1;
      events.push({ line: index + 1, raw, json: null, event: null, level: null, ts: null });
      continue;
    }
    const json = parsed as Record<string, unknown>;
    events.push({
      line: index + 1,
      raw,
      json,
      event: asString(json.event) ?? asString((json.fields as Record<string, unknown> | undefined)?.event),
      level: asString(json.level),
      ts: asString(json.ts) ?? asString(json.timestamp),
    });
  }
  return ok({ file, events, badLines, bytes: read.value.length });
}

function fieldValue(event: PluginLogEvent, key: string): unknown {
  if (event.json === null) return undefined;
  const fields = event.json.fields;
  if (typeof fields === "object" && fields !== null && !Array.isArray(fields)) {
    const value = (fields as Record<string, unknown>)[key];
    if (value !== undefined) return value;
  }
  return event.json[key];
}

/** Filter events. String fields match by containment, everything else by equality. */
export function queryLogEvents(events: readonly PluginLogEvent[], query: LogQuery): readonly PluginLogEvent[] {
  const wantedEvents = query.event === undefined ? null : new Set(Array.isArray(query.event) ? query.event : [query.event]);
  return events.filter((event) => {
    if (wantedEvents !== null && (event.event === null || !wantedEvents.has(event.event))) return false;
    if (query.level !== undefined && event.level !== query.level) return false;
    if (query.fields !== undefined) {
      for (const [key, expected] of Object.entries(query.fields)) {
        const actual = fieldValue(event, key);
        if (typeof expected === "string") {
          if (typeof actual !== "string" || !actual.includes(expected)) return false;
        } else if (actual !== expected) {
          return false;
        }
      }
    }
    if (query.sinceMs !== undefined) {
      if (event.ts === null) return false;
      const parsed = Date.parse(event.ts);
      if (Number.isNaN(parsed) || parsed < query.sinceMs) return false;
    }
    return true;
  });
}

export function summarizeLogEvents(events: readonly PluginLogEvent[], badLines = 0): PluginLogSummary {
  const byEvent: Record<string, number> = {};
  const byLevel: Record<string, number> = {};
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  for (const event of events) {
    if (event.event !== null) byEvent[event.event] = (byEvent[event.event] ?? 0) + 1;
    if (event.level !== null) byLevel[event.level] = (byLevel[event.level] ?? 0) + 1;
    if (event.ts !== null) {
      const parsed = Date.parse(event.ts);
      if (!Number.isNaN(parsed)) {
        if (firstTs === null || parsed < Date.parse(firstTs)) firstTs = event.ts;
        if (lastTs === null || parsed > Date.parse(lastTs)) lastTs = event.ts;
      }
    }
  }
  return { total: events.length, badLines, firstTs, lastTs, byEvent, byLevel };
}

export interface WaitForLogEventOptions {
  readonly fs: FsPort;
  readonly clock: ClockPort;
  readonly file: string;
  readonly query: LogQuery;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

/**
 * Poll until a matching event appears.
 *
 * Used right after a UI action: the page can acknowledge a click before the plugin
 * has processed it, and the log line is the plugin's own claim that it did.
 */
export async function waitForLogEvent(options: WaitForLogEventOptions): Promise<Result<readonly PluginLogEvent[]>> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollMs = options.pollMs ?? 200;
  const deadline = options.clock.nowMs() + timeoutMs;
  let lastGood: readonly PluginLogEvent[] = [];
  while (options.clock.nowMs() <= deadline) {
    if (await options.fs.exists(options.file)) {
      const read = await readPluginLog(options.fs, options.file);
      if (read.ok) {
        lastGood = read.value.events;
        const matched = queryLogEvents(lastGood, options.query);
        if (matched.length > 0) return ok(matched);
      }
    }
    await options.clock.sleep(pollMs);
  }
  return err({
    code: "timeout",
    message: `no matching log event appeared within ${timeoutMs}ms in ${options.file}`,
    hint: `events seen: ${[...new Set(lastGood.map((event) => event.event ?? "(unparsed)"))].join(", ") || "(none)"}`,
  });
}
