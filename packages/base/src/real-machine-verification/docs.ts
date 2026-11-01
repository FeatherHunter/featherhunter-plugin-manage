/**
 * Markdown projection of the capability description.
 *
 * The description is data so that `--help`, `describe` and the shipped markdown
 * (README.md / AGENTS-USAGE.md) can be *generated* from it instead of transcribed
 * next to it. This module owns only that projection; composing the sections into
 * the final documents belongs to the documentation ticket.
 */
import {
  EXIT_CODE_SUMMARIES,
  describeCapability,
  type CapabilityDescription,
} from "./capability-description";

/** A pipe would end the table cell early; nothing else here needs escaping. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
}

/**
 * Render the capability's reference section as markdown.
 *
 * Deterministic by construction: every line is derived from the argument, so the
 * same description always produces the same bytes (a useful property for a future
 * "docs are in sync" check).
 */
export function renderCapabilityMarkdown(description: CapabilityDescription = describeCapability()): string {
  const lines: string[] = [];
  lines.push(`# ${description.capability}`);
  lines.push("");
  lines.push(description.summary);
  lines.push("");

  lines.push("## Layers");
  lines.push("");
  lines.push(
    ...table(
      ["Layer", "Audience", "Use"],
      description.layers.map((layer) => [`L${layer.layer}`, layer.audience, layer.use]),
    ),
  );
  lines.push("");

  lines.push(`## Commands (${description.commands.length})`);
  lines.push("");
  lines.push(
    ...table(
      ["Layer", "Usage", "Writes"],
      description.commands.map((command) => [`L${command.layer}`, command.usage, command.writes]),
    ),
  );
  lines.push("");

  lines.push(`## Built-in check ids (${description.builtInCheckIds.length})`);
  lines.push("");
  lines.push("These ids are a stable contract: reports, comments and gates cite them.");
  lines.push("");
  for (const id of description.builtInCheckIds) lines.push(`- \`${id}\``);
  lines.push("");

  lines.push(`## Profile fields (${description.profileFields.length})`);
  lines.push("");
  for (const field of description.profileFields) lines.push(`- \`${field}\``);
  lines.push("");

  lines.push("## Exit codes");
  lines.push("");
  lines.push(
    ...table(
      ["Code", "Meaning"],
      (["ok", "hardFailure", "blocked"] as const).map((key) => [
        String(description.exitCodes[key]),
        EXIT_CODE_SUMMARIES[key],
      ]),
    ),
  );
  lines.push("");

  lines.push("## Global options");
  lines.push("");
  lines.push(
    ...table(
      ["Option", "Meaning"],
      description.globalFlags.map((flag) => [
        flag.value === undefined ? flag.name : `${flag.name} ${flag.value}`,
        flag.summary,
      ]),
    ),
  );
  lines.push("");

  lines.push("## Documents");
  lines.push("");
  lines.push(`- \`${description.docs.readme}\` — how to install and run this capability.`);
  lines.push(`- \`${description.docs.agentUsage}\` — the agent-facing capability table and error codes.`);
  return `${lines.join("\n")}\n`;
}
