/**
 * The clock port: timestamps a report can be compared on, and a sleep a polling
 * loop can use without importing `timers` at the call site.
 */
import type { ClockPort } from "../../contracts/ports";

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * ISO-8601 with the local offset (`2026-11-01T20:37:16.123+08:00`).
 *
 * `toISOString()` would print UTC, which makes a report from a Shanghai machine
 * and a report from a CI runner look like different moments even when they are
 * the same instant. The offset keeps both true: sortable by instant, readable as
 * the wall clock the operator saw.
 */
export function formatIsoLocal(ms: number): string {
  const date = new Date(ms);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function createClockPort(): ClockPort {
  return {
    nowMs: () => Date.now(),
    iso: (ms) => formatIsoLocal(ms ?? Date.now()),
    sleep: (ms) => new Promise<void>((resolve) => {
      setTimeout(resolve, Math.max(0, ms));
    }),
  };
}
