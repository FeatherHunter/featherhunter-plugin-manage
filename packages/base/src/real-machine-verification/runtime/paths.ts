/**
 * Path helpers for the runtime half.
 *
 * `node:path` is available here, but these helpers stay free of it on purpose:
 * plans, digests and reports are compared across machines, so every path this
 * tool writes down must use one spelling. Keeping joining and splitting in one
 * place means a Windows run and a Linux CI run produce comparable artifacts.
 */

/** Normalize every separator to `/`, which is the spelling used inside artifacts. */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Segment list without the root marker; `C:/a/b` → `["C:", "a", "b"]`. */
export function pathSegments(value: string): readonly string[] {
  return toPosixPath(value)
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function baseName(value: string): string {
  const segments = pathSegments(value);
  return segments.length === 0 ? "" : segments[segments.length - 1];
}

/** `null` for a drive root such as `C:/` or for `/`. */
export function parentPath(value: string): string | null {
  const normalized = toPosixPath(value).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return null;
  return normalized.slice(0, index);
}

/**
 * Parent path for walking the file system, preserving the separator style of
 * the input; `null` at a drive root such as `C:/` or `/`.
 *
 * `parentPath` normalizes to `/` because artifacts are compared across
 * machines; that is the wrong spelling for an `fs.exists` walk (`C:/repo` must
 * yield `C:/`, not `C:`). This helper keeps the input style so the walk can
 * hand every result straight back to the file-system port.
 */
export function parentFsPath(value: string): string | null {
  const normalized = value.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index <= 0) return null;
  const parent = normalized.slice(0, index);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

/** How many segments a path has; used by the delete guard, never by business rules. */
export function depthOf(value: string): number {
  return pathSegments(value).length;
}

export function isWindowsAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

export function isPosixAbsolute(value: string): boolean {
  return value.startsWith("/");
}

/**
 * Join path fragments, keeping the separator style of the first fragment.
 * An empty tail segment is dropped instead of producing `a//b`.
 */
export function joinFsPath(...segments: readonly string[]): string {
  const usable = segments.filter((segment) => segment.length > 0);
  if (usable.length === 0) return "";
  const [first, ...rest] = usable;
  const head = first.replace(/[\\/]+$/, "");
  const style = head.includes("\\") || isWindowsAbsolute(head) ? "\\" : "/";
  const tail = rest
    .map((segment) => segment.replace(/^[\\/]+/, "").replace(/[\\/]+$/, ""))
    .filter((segment) => segment.length > 0);
  return [head, ...tail].join(style);
}

/**
 * True when two paths name the same location as far as a Windows user would
 * agree. Case-insensitive when either side looks like a Windows path, because
 * `C:\Users\X` and `c:\users\x` are the same directory there.
 */
export function samePath(a: string, b: string): boolean {
  const left = toPosixPath(a).replace(/\/+$/, "");
  const right = toPosixPath(b).replace(/\/+$/, "");
  if (isWindowsAbsolute(left) || isWindowsAbsolute(right)) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

/**
 * True when `child` is `parent` itself or below it. Sibling directories that
 * merely share a prefix (`/work/batch` vs `/work/batch-2`) must not match.
 */
export function isInsidePath(child: string, parent: string): boolean {
  const childPath = toPosixPath(child).replace(/\/+$/, "");
  const parentPathValue = toPosixPath(parent).replace(/\/+$/, "");
  const caseFold = isWindowsAbsolute(childPath) || isWindowsAbsolute(parentPathValue);
  const left = caseFold ? childPath.toLowerCase() : childPath;
  const right = caseFold ? parentPathValue.toLowerCase() : parentPathValue;
  if (left === right) return true;
  return left.startsWith(`${right}/`);
}

/** Resolve `target` against `base` when it is relative; returns an absolute spelling. */
export function resolveAgainst(base: string, target: string): string {
  if (isWindowsAbsolute(target) || isPosixAbsolute(target)) return target;
  return joinFsPath(base, target);
}

/** `/` or `\` depending on the style of the path itself. */
export function separatorOf(value: string): "/" | "\\" {
  return value.includes("\\") || isWindowsAbsolute(value) ? "\\" : "/";
}
