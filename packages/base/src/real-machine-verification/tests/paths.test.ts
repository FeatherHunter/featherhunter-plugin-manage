import { describe, expect, it } from "vitest";

import { parentFsPath, parentPath } from "../runtime/paths";

/**
 * Two parent helpers with deliberately different jobs:
 * - `parentPath` normalizes to `/` because artifacts are compared across machines;
 * - `parentFsPath` preserves the input spelling because its result goes straight
 *   back into a file-system port while walking towards a project root.
 */
describe("parentPath (artifact spelling)", () => {
  it("returns the parent with forward slashes and strips trailing separators", () => {
    expect(parentPath("C:\\repo\\packages\\base")).toBe("C:/repo/packages");
    expect(parentPath("C:/repo/packages/base/")).toBe("C:/repo/packages");
  });

  it("returns null at a drive root or a posix root", () => {
    expect(parentPath("C:/")).toBeNull();
    expect(parentPath("/")).toBeNull();
    expect(parentPath("C:")).toBeNull();
  });
});

describe("parentFsPath (file-system walk)", () => {
  it("preserves the separator style of the input", () => {
    expect(parentFsPath("C:\\repo\\packages\\base")).toBe("C:\\repo\\packages");
    expect(parentFsPath("C:/repo/packages/base")).toBe("C:/repo/packages");
    expect(parentFsPath("D:/repo")).toBe("D:/");
  });

  it("keeps the drive when stepping out of a drive-level directory", () => {
    expect(parentFsPath("C:\\repo")).toBe("C:/");
    expect(parentFsPath("C:/repo")).toBe("C:/");
  });

  it("returns null at a root, so a walk cannot loop forever", () => {
    expect(parentFsPath("C:/")).toBeNull();
    expect(parentFsPath("/")).toBeNull();
    expect(parentFsPath("/repo")).toBeNull();
  });

  it("ignores trailing separators", () => {
    expect(parentFsPath("C:\\repo\\packages\\")).toBe("C:\\repo");
    expect(parentFsPath("C:\\repo\\")).toBe("C:/");
  });
});
