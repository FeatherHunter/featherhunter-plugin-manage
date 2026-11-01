import { describe, expect, it } from "vitest";

import type { ModelSelection } from "../contracts/verification-profile";
import { inspectModelConfig, planModelConfigEdit, scanPatch } from "../contracts/profile-rules";

const SELECTION: ModelSelection = {
  provider: "minimax-cn",
  model: "Minimax-M3.1-Flash",
  apiKeyEnv: "MINIMAX_CN_API_KEY",
  contextWindow: 1_000_000,
  maxTokens: 120_000,
  input: ["text", "image"],
};

/** A profile shaped like the desktop one: a default model of another provider, and
 * a pi-ai entry whose minimax provider exists but is not usable for our selection. */
const PROFILE = [
  "# written by hand — comments must survive edits",
  "- id: theme-pack",
  "  config:",
  "    mode: dark",
  "",
  "- id: agent-default-model",
  "  config:",
  "    provider: dsh-opencode-go-vision",
  "    model: deepseek-v4.1-flash",
  "    reasoningEffort: max",
  "",
  "# model providers",
  "- id: llm-pi-ai",
  "  config:",
  "    providers:",
  "      deepseek-account:",
  "        apiKeyEnv: DEEPSEEK_API_KEY",
  "        models:",
  "          - id: deepseek-flash",
  "            contextWindow: 128000",
  "      minimax-cn:",
  "        apiKeyEnv: WRONG_KEY_ENV",
  "",
  "- id: vision-router",
  "  config:",
  "    providers:",
  "      - provider: minimax-cn",
  "        model: M3.1-Flash",
  "",
].join("\n");

describe("scanPatch", () => {
  it("finds every top-level entry and its boundaries", () => {
    const scan = scanPatch(PROFILE);
    expect(scan.entries.map((entry) => entry.id)).toEqual([
      "theme-pack",
      "agent-default-model",
      "llm-pi-ai",
      "vision-router",
    ]);
    const provider = scan.entries.find((entry) => entry.id === "llm-pi-ai");
    expect(provider).toBeDefined();
    if (provider === undefined) return;
    expect(scan.lines[provider.startLine]).toContain("id: llm-pi-ai");
    expect(scan.lines[provider.endLine]).toContain("id: vision-router");
  });

  it("preserves the line ending style", () => {
    expect(scanPatch(PROFILE).eol).toBe("\n");
    expect(scanPatch(PROFILE.replace(/\n/g, "\r\n")).eol).toBe("\r\n");
  });
});

describe("inspectModelConfig", () => {
  it("reports every disagreement with the declared selection", () => {
    const state = inspectModelConfig(PROFILE, SELECTION);
    expect(state.configured).toBe(false);
    const codes = state.problems.map((problem) => problem.code);
    expect(codes).toContain("provider-mismatch");
    expect(codes).toContain("model-mismatch");
    expect(codes).toContain("api-key-env-mismatch");
    expect(codes).toContain("models-empty");
  });

  it("reports a model id that is referenced but not declared", () => {
    const declared = PROFILE.replace(
      "      minimax-cn:\n        apiKeyEnv: WRONG_KEY_ENV\n",
      "      minimax-cn:\n        apiKeyEnv: MINIMAX_CN_API_KEY\n        models:\n          - id: MiniMax-M3\n",
    );
    const state = inspectModelConfig(declared, SELECTION);
    expect(state.configured).toBe(false);
    expect(state.problems.map((problem) => problem.code)).toContain("model-not-declared");
  });

  it("accepts a profile that already matches the selection", () => {
    const configured = inspectModelConfig(
      [
        "- id: agent-default-model",
        "  config:",
        "    provider: minimax-cn",
        "    model: Minimax-M3.1-Flash",
        "- id: llm-pi-ai",
        "  config:",
        "    providers:",
        "      minimax-cn:",
        "        apiKeyEnv: MINIMAX_CN_API_KEY",
        "        models:",
        "          - id: Minimax-M3.1-Flash",
        "",
      ].join("\n"),
      SELECTION,
    );
    expect(configured.configured).toBe(true);
    expect(configured.apiKeyEnv).toBe("MINIMAX_CN_API_KEY");
    expect(configured.declaredModels).toEqual(["Minimax-M3.1-Flash"]);
  });

  it("cannot report configured when the default-model entry is absent", () => {
    const state = inspectModelConfig("- id: llm-pi-ai\n  config:\n    providers: {}\n", SELECTION);
    expect(state.configured).toBe(false);
    expect(state.problems.map((problem) => problem.code)).toContain("missing-default-model-entry");
  });
});

describe("planModelConfigEdit", () => {
  it("produces text that inspects as configured", () => {
    const edited = planModelConfigEdit(PROFILE, SELECTION);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.changed).toBe(true);
    const after = inspectModelConfig(edited.value.text, SELECTION);
    expect(after.configured).toBe(true);
    expect(after.defaultProvider).toBe("minimax-cn");
    expect(after.defaultModel).toBe("Minimax-M3.1-Flash");
    expect(after.apiKeyEnv).toBe("MINIMAX_CN_API_KEY");
    expect(after.declaredModels).toEqual(["Minimax-M3.1-Flash"]);
  });

  it("keeps comments, untouched entries and the other provider", () => {
    const edited = planModelConfigEdit(PROFILE, SELECTION);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const text = edited.value.text;
    expect(text).toContain("# written by hand — comments must survive edits");
    expect(text).toContain("# model providers");
    expect(text).toContain("      deepseek-account:");
    expect(text).toContain("          - id: deepseek-flash");
    expect(text).toContain("      minimax-cn:");
  });

  it("removes reasoningEffort, because it is provider-specific", () => {
    const edited = planModelConfigEdit(PROFILE, SELECTION);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.text).not.toContain("reasoningEffort");
    expect(edited.value.notes.join(" ")).toContain("reasoningEffort");
  });

  it("is idempotent: a second run reports no change", () => {
    const first = planModelConfigEdit(PROFILE, SELECTION);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = planModelConfigEdit(first.value.text, SELECTION);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.changed).toBe(false);
    expect(second.value.text).toBe(first.value.text);
  });

  it("adds the provider block when the provider is missing entirely", () => {
    const withoutProvider = PROFILE.replace(
      "      minimax-cn:\n        apiKeyEnv: WRONG_KEY_ENV\n",
      "",
    );
    const edited = planModelConfigEdit(withoutProvider, SELECTION);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const after = inspectModelConfig(edited.value.text, SELECTION);
    expect(after.configured).toBe(true);
  });

  it("adds the providers block when llm-pi-ai has no providers yet", () => {
    const bare = [
      "- id: agent-default-model",
      "  config:",
      "    provider: other",
      "    model: other-model",
      "- id: llm-pi-ai",
      "  config:",
      "    enabled: true",
      "",
    ].join("\n");
    const edited = planModelConfigEdit(bare, SELECTION);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(inspectModelConfig(edited.value.text, SELECTION).configured).toBe(true);
  });

  it("preserves CRLF line endings", () => {
    const crlf = PROFILE.replace(/\n/g, "\r\n");
    const edited = planModelConfigEdit(crlf, SELECTION);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.text.includes("\r\n")).toBe(true);
    expect(edited.value.text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("refuses to invent an agent-default-model entry", () => {
    const missing = "- id: llm-pi-ai\n  config:\n    providers: {}\n";
    const edited = planModelConfigEdit(missing, SELECTION);
    expect(edited.ok).toBe(false);
    if (edited.ok) return;
    expect(edited.error.code).toBe("prerequisite");
    expect(edited.error.message).toContain("agent-default-model");
  });

  it("refuses to invent a provider plugin entry", () => {
    const missing = "- id: agent-default-model\n  config:\n    provider: a\n    model: b\n";
    const edited = planModelConfigEdit(missing, SELECTION);
    expect(edited.ok).toBe(false);
    if (edited.ok) return;
    expect(edited.error.message).toContain("llm-pi-ai");
  });
});
