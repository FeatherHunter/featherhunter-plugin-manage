import { describe, expect, it } from "vitest";
import { formatValidity, isExpired } from "../../src/core/index";

const NOW = new Date("2024-06-01T12:00:00Z");

describe("QR validity copy", () => {
  it("says today instead of zero days on the last valid day", () => {
    expect(formatValidity("2024-06-01", { lang: "zh", now: NOW })).toBe(
      "该二维码今天（6 月 1 日前）有效",
    );
    expect(formatValidity("2024-06-01", { lang: "en", now: NOW })).toBe(
      "Valid today (until 6/1)",
    );
  });

  it("counts whole days ahead while the code is not on its last day", () => {
    expect(formatValidity("2024-06-02", { lang: "zh", now: NOW })).toBe(
      "该二维码 1 天内（6 月 2 日前）有效",
    );
    expect(formatValidity("2024-06-02", { lang: "en", now: NOW })).toBe(
      "Valid for 1 day (until 6/2)",
    );
  });

  it("keeps the last day valid and drops the copy the day after", () => {
    expect(isExpired("2024-06-01", NOW)).toBe(false);
    expect(isExpired("2024-05-31", NOW)).toBe(true);
    expect(formatValidity("2024-05-31", { lang: "zh", now: NOW })).toBeNull();
    expect(formatValidity("2024-05-31", { lang: "en", now: NOW })).toBeNull();
  });

  it("returns null for codes that never expire", () => {
    expect(isExpired(undefined, NOW)).toBe(false);
    expect(formatValidity(undefined, { lang: "zh", now: NOW })).toBeNull();
  });
});
