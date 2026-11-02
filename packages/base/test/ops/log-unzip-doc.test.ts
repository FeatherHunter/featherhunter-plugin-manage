/**
 * Contract for `docs/排查-会话日志解压.md` (ticket 09).
 *
 * The deliverable is the document itself: a maintainer must be able to copy one
 * command out of it and get every frame of a session log, because Node's built-in
 * zstd decoder silently stops after the first frame of a multi-frame file. The
 * assertions below stay at the file boundary — the document text is the contract —
 * plus one live run of the documented program against a synthetic three-frame
 * file, skipped when Python or `zstandard` is not installed on this machine.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { REPO_ROOT } from "./support/ops-fixtures";

const DOC_PATH = join(REPO_ROOT, "docs", "排查-会话日志解压.md");
const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
/** The three JSON lines the synthetic log is built from, one write batch per frame. */
const FRAME_LINES: readonly string[] = ['{"seq":1}', '{"seq":2}', '{"seq":3}'];

/**
 * Strings the document must never carry: credentials, and machine-specific
 * absolute paths (the document may only use relative paths or environment
 * variables, so it stays correct on any machine).
 */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["OpenAI-style key (sk-)", /\bsk-[A-Za-z0-9_-]{16,}/],
  ["GitHub token (ghp_)", /\bgh[pousr]_[A-Za-z0-9]{16,}/],
  ["npm token (npm_)", /\bnpm_[A-Za-z0-9]{16,}/],
  ["token= assignment", /\btoken\s*=\s*\S{8,}/i],
  ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i],
  ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Windows user profile path", /[A-Za-z]:\\Users\\/i],
  ["Windows absolute path", /(?:^|[^A-Za-z0-9_])[A-Za-z]:[\\/]/m],
  ["Unix home path", /\/(?:home|Users)\/[A-Za-z0-9._-]+\//],
];

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function readDoc(): string {
  return readFileSync(DOC_PATH, "utf8");
}

/** Every non-empty line that lives inside a fenced code block, trimmed. */
function fencedLines(text: string): string[] {
  const lines: string[] = [];
  let insideFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) lines.push(line.trim());
  }
  return lines;
}

/** The program text of a documented `python -c "…" <inputs>` command, if any. */
function pythonProgram(line: string): string | null {
  const match = /^python\s+-c\s+"([^"]*)"/.exec(line);
  return match?.[1] ?? null;
}

/** Documented commands that decode across frames; these must actually work. */
function crossFramePrograms(text: string): string[] {
  return fencedLines(text)
    .filter((line) => line.startsWith("python "))
    .map(pythonProgram)
    .filter((program): program is string => program !== null && program.includes("read_across_frames=True"));
}

/** Count zstd frame magics in a buffer (one magic per frame header). */
function countFrameMagic(bytes: Buffer): number {
  let count = 0;
  for (let index = bytes.indexOf(ZSTD_FRAME_MAGIC); index !== -1; index = bytes.indexOf(ZSTD_FRAME_MAGIC, index + 1)) {
    count += 1;
  }
  return count;
}

/** Python with the `zstandard` module, or null when the machine cannot run the command. */
function probePython(): string | null {
  const probe = spawnSync("python", ["-c", "import zstandard"], { encoding: "utf8", shell: false, windowsHide: true });
  return probe.status === 0 ? "python" : null;
}

/** Build a three-frame log: one compressor frame per write batch, no line spanning frames. */
function writeThreeFrameLog(python: string, dir: string): string {
  const target = join(dir, "session.v4.jsonl.zstd");
  const payloads = FRAME_LINES.map((line) => "b'" + line + "\\n'").join(", ");
  const program = [
    "import sys, zstandard",
    "payloads = [" + payloads + "]",
    "compressor = zstandard.ZstdCompressor()",
    "open(sys.argv[1], 'wb').write(b''.join(compressor.compress(payload) for payload in payloads))",
  ].join("\n");
  const run = spawnSync(python, ["-c", program, target], { encoding: "utf8", shell: false, windowsHide: true });
  expect(run.status, "failed to build the multi-frame fixture: " + run.stderr).toBe(0);
  return target;
}

const PYTHON = probePython();

describe("docs/排查-会话日志解压.md", () => {
  it("exists and explains the multi-frame trap", () => {
    expect(existsSync(DOC_PATH), DOC_PATH + " is missing").toBe(true);
    const text = readDoc();
    expect(text.trim().length, "the document is empty").toBeGreaterThan(800);
    expect(text).toContain("多帧");
    expect(text).toContain("第一帧");
    expect(text).toMatch(/Node/);
  });

  it("ships a copy-pasteable python command that decodes .zstd into .jsonl", () => {
    const text = readDoc();
    const commands = fencedLines(text).filter((line) => line.startsWith("python "));
    expect(commands.length, "no fenced command line starting with python").toBeGreaterThan(0);

    const crossFrame = crossFramePrograms(text);
    expect(crossFrame.length, "no fenced python command with read_across_frames=True").toBeGreaterThan(0);
    for (const program of crossFrame) {
      expect(program, "a cross-frame command without zstandard").toContain("zstandard");
    }

    const commandLines = fencedLines(text).filter((line) => line.startsWith("python ") && line.includes("read_across_frames=True"));
    expect(
      commandLines.some((line) => line.includes(".jsonl")),
      "no documented command names its .jsonl output",
    ).toBe(true);
    expect(
      commandLines.some((line) => line.includes(".zstd") || line.includes(".zst")),
      "no documented command names its .zst/.zstd input",
    ).toBe(true);
  });

  it("explains how to verify the decode is complete", () => {
    const text = readDoc();
    for (const needle of ["帧数", "行数", "首行", "末行"]) {
      expect(text, "the document does not mention " + needle).toContain(needle);
    }
  });

  it("carries no credentials or machine-specific absolute paths", () => {
    const text = readDoc();
    for (const [label, pattern] of FORBIDDEN) {
      const match = pattern.exec(text);
      expect(match?.[0] ?? null, "the document matches " + label).toBeNull();
    }
  });

  it.skipIf(PYTHON === null)("the documented command decodes every frame, not just the first", () => {
    const python = PYTHON as string;
    const dir = tempDir("fh-log-doc-");
    const source = writeThreeFrameLog(python, dir);
    const raw = readFileSync(source);
    expect(countFrameMagic(raw), "the fixture must really hold three frames").toBe(FRAME_LINES.length);

    // Control: the built-in decoder sees at most the first frame, which is exactly
    // the failure the document describes (and why a single-frame decoder is not
    // enough to judge whether a log is complete).
    let builtinLines = 0;
    try {
      builtinLines = zlib.zstdDecompressSync(raw).toString("utf8").split("\n").filter(Boolean).length;
    } catch {
      builtinLines = 0;
    }
    expect(builtinLines, "the built-in decoder must not see the whole log").toBeLessThan(FRAME_LINES.length);

    const programs = crossFramePrograms(readDoc());
    expect(programs.length, "no cross-frame program to run").toBeGreaterThan(0);
    programs.forEach((program, index) => {
      const writesFile = program.includes("sys.argv[2]");
      const outputPath = join(dir, "out-" + index + ".jsonl");
      const run = spawnSync(python, writesFile ? ["-c", program, source, outputPath] : ["-c", program, source], {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      });
      expect(run.status, "documented command (variant " + index + ") failed: " + run.stderr).toBe(0);
      const decoded = writesFile ? readFileSync(outputPath, "utf8") : run.stdout;
      expect(decoded.split("\n").filter(Boolean), "variant " + index + " lost frames").toEqual([...FRAME_LINES]);
    });
  }, 60_000);
});
