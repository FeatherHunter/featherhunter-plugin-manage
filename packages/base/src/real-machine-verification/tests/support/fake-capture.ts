import type { CliIo } from "../../cli/io";

export interface CapturedIo {
  readonly io: CliIo;
  stdout(): string;
  stderr(): string;
  combined(): string;
  lines(): string[];
}

export function captureIo(): CapturedIo {
  const out: string[] = [];
  const error: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => error.push(text) },
    stdout: () => out.join(""),
    stderr: () => error.join(""),
    combined: () => `${out.join("")}${error.join("")}`,
    lines: () => `${out.join("")}`.split("\n").filter((line) => line.length > 0),
  };
}
