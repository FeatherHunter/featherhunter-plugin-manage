/**
 * Help and markdown are projections of the description, never a second list.
 *
 * The proof is a sentinel: a command and a check id are injected into a copy of
 * the description, and every renderer must show them. A renderer that had its own
 * hand-written table would pass the "contains every real command" test by luck, but
 * cannot pass this one.
 */
import { describe, expect, it } from "vitest";

import {
  EXIT_CODE_SUMMARIES,
  describeCapability,
  type CapabilityDescription,
} from "../capability-description";
import { renderDescription, renderHelp } from "../cli/main";
import type { CheckId } from "../contracts/branding";
// Imported through the package barrel on purpose: the docs ticket consumes the
// public export, so the barrel must expose it.
import { renderCapabilityMarkdown } from "../index";

const SENTINEL_COMMAND = {
  name: "sentinel-command",
  layer: 3 as const,
  summary: "a command that exists only in the injected description",
  usage: "dsh-verify sentinel-command [--json]",
  writes: "nothing",
  flags: ["--json"],
};
const SENTINEL_CHECK = "sentinel-check-id" as CheckId;

/** A description plus one command and one check id that cannot be hard-coded. */
function withSentinels(description: CapabilityDescription): CapabilityDescription {
  return {
    ...description,
    commands: [...description.commands, SENTINEL_COMMAND],
    builtInCheckIds: [...description.builtInCheckIds, SENTINEL_CHECK],
  };
}

describe("CLI help", () => {
  it("names every command and every built-in check from the description", () => {
    const description = describeCapability();
    const help = renderHelp(description);

    for (const command of description.commands) {
      expect(help, command.name).toContain(command.usage);
    }
    for (const id of description.builtInCheckIds) {
      expect(help, id).toContain(id);
    }
    for (const layer of description.layers) {
      expect(help, String(layer.layer)).toContain(`L${layer.layer}`);
    }
    for (const field of description.profileFields) {
      expect(help, field).toContain(field);
    }
  });

  it("renders the injected sentinel command and check, so it cannot be a hand-written table", () => {
    const help = renderHelp(withSentinels(describeCapability()));
    expect(help).toContain(SENTINEL_COMMAND.usage);
    expect(help).toContain(String(SENTINEL_CHECK));
  });
});

describe("human describe output", () => {
  it("renders every command and check id from the same object", () => {
    const description = describeCapability();
    const text = renderDescription(description);
    for (const command of description.commands) expect(text, command.name).toContain(command.name);
    for (const id of description.builtInCheckIds) expect(text, id).toContain(id);
    expect(renderDescription(withSentinels(description))).toContain(String(SENTINEL_CHECK));
  });
});

describe("generated markdown", () => {
  it("contains every command, check id, profile field and exit code", () => {
    const description = describeCapability();
    const markdown = renderCapabilityMarkdown(description);

    expect(markdown).toMatch(/^# .*real-machine-verification/);
    for (const command of description.commands) {
      expect(markdown, command.name).toContain(`dsh-verify ${command.name}`);
    }
    for (const id of description.builtInCheckIds) expect(markdown, id).toContain(id);
    for (const field of description.profileFields) expect(markdown, field).toContain(field);
    for (const [key, summary] of Object.entries(EXIT_CODE_SUMMARIES)) {
      expect(markdown, key).toContain(summary);
    }
    for (const flag of description.globalFlags) expect(markdown, flag.name).toContain(flag.name);
    expect(markdown).toContain(description.docs.readme);
    expect(markdown).toContain(description.docs.agentUsage);
  });

  it("is generated, not hand-written: injected sentinels show up", () => {
    const markdown = renderCapabilityMarkdown(withSentinels(describeCapability()));
    expect(markdown).toContain(SENTINEL_COMMAND.usage);
    expect(markdown).toContain(String(SENTINEL_CHECK));
  });

  it("is deterministic for the same description", () => {
    expect(renderCapabilityMarkdown(describeCapability())).toBe(renderCapabilityMarkdown(describeCapability()));
  });
});
