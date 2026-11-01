/**
 * The CLI's two output streams, injectable so tests can capture them.
 *
 * The default implementation resolves `process.stdout.write` at call time rather
 * than module-load time: existing tests spy on the process streams before calling
 * `main`, and a captured reference would quietly bypass the spy.
 */
export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** The real process streams, looked up on every write. */
export function createNodeIo(): CliIo {
  return {
    stdout(text) {
      process.stdout.write(text);
    },
    stderr(text) {
      process.stderr.write(text);
    },
  };
}
