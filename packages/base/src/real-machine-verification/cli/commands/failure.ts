/**
 * The one failure envelope every command in this ticket shares.
 *
 * A command failure is not a check failure: there is no check id to attach it
 * to, because the command never got far enough to run one. The envelope keeps
 * the same shape the existing commands use so a caller can parse every
 * `dsh-verify` failure with one branch.
 *
 * The human line never borrows a check-status word: a command that could not
 * run is blocked (exit 2), so it prints `dsh-verify <command>: [code] message`
 * and the failure-code vocabulary, exactly like every other blocked command.
 * Usage errors print the specific problem first and the usage line second.
 */
import { EXIT_CODES } from "../../capability-description";
import { formatFailure, type Failure } from "../../contracts/result";
import type { CliIo } from "../io";

const CLI_NAME = "dsh-verify";

/** The JSON error envelope, exactly one line when printed. */
export function failureJson(command: string, stage: string, error: Failure): Record<string, unknown> {
  return {
    schemaVersion: 1,
    command,
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.details === undefined ? {} : { details: error.details }),
      stage,
    },
  };
}

/** Print a fatal command failure and return the blocked exit code. */
export function emitFailure(
  io: CliIo,
  json: boolean,
  command: string,
  stage: string,
  error: Failure,
): number {
  io.stderr(`${CLI_NAME} ${command}: ${formatFailure(error)}\n`);
  if (json) io.stdout(`${JSON.stringify(failureJson(command, stage, error))}\n`);
  return EXIT_CODES.blocked;
}

/** Print a usage error (bad flags or positional arguments) and return 2. */
export function emitUsageFailure(
  io: CliIo,
  json: boolean,
  command: string,
  problems: readonly string[],
  usage: string,
): number {
  const message = problems.length === 0 ? "invalid arguments" : problems.join("; ");
  io.stderr(`${CLI_NAME} ${command}: ${message}\n`);
  io.stderr(`  usage: ${usage}\n`);
  if (json) {
    io.stdout(
      `${JSON.stringify(failureJson(command, "usage", { code: "invalid-input", message, hint: `usage: ${usage}` }))}\n`,
    );
  }
  return EXIT_CODES.blocked;
}
