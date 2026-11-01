/**
 * The composition root for the real ports.
 *
 * `dsh-verify` is the only place that decides a *real* machine is in play; every
 * command receives this aggregate and every test swaps it for a fake. Keeping the
 * wiring here means the list of effects the capability can perform is one short
 * function a reviewer can read in full.
 */
import type { BrowserProbeFactory, Ports } from "../../contracts/ports";
import type { RuntimeFacts } from "../types";
import { createClockPort } from "./clock";
import { createCommandPort } from "./command";
import { createEnvPort } from "./env";
import { createFsPort, readFileSlice } from "./fs";
import { createHttpPort } from "./http";
import { createProcessPort } from "./process";
import { createScreenPort } from "./screen";

export interface NodePortsOptions {
  /** A browser adapter from the plugin repository; `null` keeps browser checks `blocked`. */
  readonly browser?: BrowserProbeFactory | null;
  /** Individual overrides for a future command or a test double. */
  readonly overrides?: Partial<Ports>;
}

/** Build the aggregate. Side-effect free until a port method is called. */
export function createNodePorts(options: NodePortsOptions = {}): Ports {
  const env = createEnvPort();
  const command = createCommandPort();
  const ports: Ports = {
    fs: createFsPort(),
    command,
    process: createProcessPort(),
    http: createHttpPort(),
    clock: createClockPort(),
    env,
    screen: createScreenPort({ command, env }),
    browser: options.browser ?? null,
    ...(options.overrides ?? {}),
  };
  return ports;
}

/** Facts the checks need but ports do not model: the running Node and the slice reader. */
export function createRuntimeFacts(): RuntimeFacts {
  return { nodeVersion: process.versions.node, readFileSlice };
}
