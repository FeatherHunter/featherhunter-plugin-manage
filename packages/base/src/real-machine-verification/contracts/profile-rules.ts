/**
 * Profile rules: read and rewrite the two lines of a DSH profile patch file that
 * decide which model an instance uses.
 *
 * The file is YAML, but the rules are *not* a YAML library: this package is
 * allowed `node:` builtins only, and a general YAML round-trip would also destroy
 * the comments a human put there. So the work is split in two:
 *
 * - **read** the specific anchors this capability cares about (the
 *   `agent-default-model` entry and the `llm-pi-ai` provider entry) with a line
 *   scanner that refuses to guess;
 * - **write** by splicing lines into the existing text, so everything else in the
 *   profile survives byte for byte.
 *
 * Two failure modes are treated as hard prerequisites rather than repaired
 * silently: a profile with no `agent-default-model` entry, and one with no
 * `llm-pi-ai` entry. Inventing whole plugin entries would be guessing at a
 * schema this package does not own — better to say so and let the operator
 * install the provider.
 */
import { err, ok, type Result } from "./result";
import type { ModelSelection } from "./verification-profile";

/** One top-level entry of a patch file: `- id: <id>` and its indented body. */
export interface PatchEntry {
  readonly id: string;
  /** 0-based index of the `- id:` line. */
  readonly startLine: number;
  /** 0-based index one past the last line of the entry. */
  readonly endLine: number;
}

export interface PatchScan {
  readonly lines: readonly string[];
  readonly entries: readonly PatchEntry[];
  readonly eol: "\n" | "\r\n";
  readonly trailingNewline: boolean;
}

export type ModelConfigProblemCode =
  | "missing-default-model-entry"
  | "missing-provider-entry"
  | "provider-mismatch"
  | "model-mismatch"
  | "api-key-env-mismatch"
  | "model-not-declared"
  | "models-empty"
  | "reference-model-mismatch";

export interface ModelConfigProblem {
  readonly code: ModelConfigProblemCode;
  readonly message: string;
  readonly hint?: string;
  /** The literal the declaration asks for; for CLI rendering, never a secret. */
  readonly expected?: string;
  /** The literal the patch file carries (or a named absence). */
  readonly actual?: string;
  /** Which top-level entry the problem belongs to, when it is entry-specific. */
  readonly entryId?: string;
}

/** One reference party (e.g. vision-router) that names a provider/model pair. */
export interface ModelConfigReference {
  readonly entryId: string;
  readonly provider: string;
  readonly model: string | null;
}

/** What the patch file currently says about the model. */
export interface ModelConfigState {
  readonly configured: boolean;
  readonly defaultProvider: string | null;
  readonly defaultModel: string | null;
  readonly apiKeyEnv: string | null;
  readonly declaredModels: readonly string[];
  readonly references: readonly ModelConfigReference[];
  readonly problems: readonly ModelConfigProblem[];
}

/* ------------------------------------------------------------------ scanning */

const ENTRY_START_RE = /^-\s/;
const ENTRY_ID_RE = /^\s*-?\s*id:\s*(.*?)\s*$/;

/** Split a patch file into lines plus its top-level entry boundaries. */
export function scanPatch(text: string): PatchScan {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = text.endsWith(eol);
  const body = trailingNewline ? text.slice(0, -eol.length) : text;
  const lines = body.length === 0 ? [] : body.split(eol);

  const entries: PatchEntry[] = [];
  let open: { id: string; startLine: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (ENTRY_START_RE.test(line)) {
      if (open !== null) entries.push({ id: open.id, startLine: open.startLine, endLine: index });
      const idMatch = ENTRY_ID_RE.exec(line);
      const id = idMatch === null ? "" : unquoteScalar(idMatch[1]);
      open = { id, startLine: index };
    }
  }
  if (open !== null) entries.push({ id: open.id, startLine: open.startLine, endLine: lines.length });
  return { lines, entries, eol, trailingNewline };
}

function unquoteScalar(raw: string): string {
  const withoutComment = raw.replace(/\s+#.*$/, "").trim();
  return withoutComment.replace(/^(['"])(.*)\1$/, "$2").trim();
}

function indentOf(line: string): number {
  const match = /^(\s*)/.exec(line);
  return match === null ? 0 : match[1].length;
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function findEntry(scan: PatchScan, id: string): PatchEntry | null {
  for (const entry of scan.entries) {
    if (entry.id === id) return entry;
  }
  return null;
}

/** First `key: value` scalar inside a line range, at any indentation. */
function findScalar(
  lines: readonly string[],
  start: number,
  end: number,
  key: string,
): { line: number; indent: number; value: string } | null {
  const re = new RegExp(`^(\\s*)(?:-\\s+)?${escapeRegExp(key)}:\\s*(.*)$`);
  for (let index = start; index < end; index += 1) {
    const match = re.exec(lines[index]);
    if (match === null) continue;
    const value = unquoteScalar(match[2]);
    if (value.length === 0) continue;
    return { line: index, indent: match[1].length, value };
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First `key:` block opener inside a range (used for `providers:` and `models:`). */
function findBlock(
  lines: readonly string[],
  start: number,
  end: number,
  key: string,
): { line: number; indent: number } | null {
  const re = new RegExp(`^(\\s*)${escapeRegExp(key)}:\\s*(?:#.*)?$`);
  for (let index = start; index < end; index += 1) {
    const match = re.exec(lines[index]);
    if (match !== null) return { line: index, indent: match[1].length };
  }
  return null;
}

/** End of the block opened at `line` with `indent`: next non-blank line with indent <= it. */
function blockEnd(lines: readonly string[], line: number, indent: number): number {
  for (let index = line + 1; index < lines.length; index += 1) {
    if (isBlankOrComment(lines[index])) continue;
    if (indentOf(lines[index]) <= indent) return index;
  }
  return lines.length;
}

/* ----------------------------------------------------------------- inspecting */

/** Read the model-relevant facts out of a patch file. */
export function inspectModelConfig(text: string, selection: ModelSelection): ModelConfigState {
  const scan = scanPatch(text);
  const problems: ModelConfigProblem[] = [];

  const defaultEntry = findEntry(scan, "agent-default-model");
  const providerEntry = findEntry(scan, "llm-pi-ai");

  let defaultProvider: string | null = null;
  let defaultModel: string | null = null;
  if (defaultEntry === null) {
    problems.push({
      code: "missing-default-model-entry",
      message: "profile has no agent-default-model entry",
      hint: "the profile cannot name a default model; install or repair the profile first",
      expected: "agent-default-model entry",
      actual: "absent",
      entryId: "agent-default-model",
    });
  } else {
    const provider = findScalar(scan.lines, defaultEntry.startLine, defaultEntry.endLine, "provider");
    const model = findScalar(scan.lines, defaultEntry.startLine, defaultEntry.endLine, "model");
    defaultProvider = provider?.value ?? null;
    defaultModel = model?.value ?? null;
    if (defaultProvider !== selection.provider) {
      problems.push({
        code: "provider-mismatch",
        message: `default provider is ${JSON.stringify(defaultProvider)}, expected ${JSON.stringify(selection.provider)}`,
        expected: selection.provider,
        actual: defaultProvider ?? "(missing)",
        entryId: "agent-default-model",
      });
    }
    if (defaultModel !== selection.model) {
      problems.push({
        code: "model-mismatch",
        message: `default model is ${JSON.stringify(defaultModel)}, expected ${JSON.stringify(selection.model)}`,
        hint: "model ids are compared verbatim; a near-miss id is a different model to the host",
        expected: selection.model,
        actual: defaultModel ?? "(missing)",
        entryId: "agent-default-model",
      });
    }
  }

  let apiKeyEnv: string | null = null;
  let declaredModels: string[] = [];
  if (providerEntry === null) {
    problems.push({
      code: "missing-provider-entry",
      message: "profile has no llm-pi-ai entry",
      hint: "enable the pi-ai provider in this profile before verifying a model",
      expected: "llm-pi-ai entry",
      actual: "absent",
      entryId: "llm-pi-ai",
    });
  } else {
    const providers = findBlock(scan.lines, providerEntry.startLine, providerEntry.endLine, "providers");
    if (providers !== null) {
      const providersEnd = Math.min(blockEnd(scan.lines, providers.line, providers.indent), providerEntry.endLine);
      const providerKey = findBlock(scan.lines, providers.line + 1, providersEnd, selection.provider);
      if (providerKey === null) {
        problems.push({
          code: "provider-mismatch",
          message: `llm-pi-ai declares no provider ${JSON.stringify(selection.provider)}`,
          expected: selection.provider,
          actual: "(no such provider block)",
          entryId: "llm-pi-ai",
        });
      } else {
        const providerEnd = Math.min(blockEnd(scan.lines, providerKey.line, providerKey.indent), providersEnd);
        const keyEnv = findScalar(scan.lines, providerKey.line + 1, providerEnd, "apiKeyEnv");
        apiKeyEnv = keyEnv?.value ?? null;
        if (apiKeyEnv !== selection.apiKeyEnv) {
          problems.push({
            code: "api-key-env-mismatch",
            message: `provider ${selection.provider} reads its key from ${JSON.stringify(apiKeyEnv)}, expected ${JSON.stringify(selection.apiKeyEnv)}`,
            expected: selection.apiKeyEnv,
            actual: apiKeyEnv ?? "(missing)",
            entryId: "llm-pi-ai",
          });
        }
        const models = findBlock(scan.lines, providerKey.line + 1, providerEnd, "models");
        if (models === null) {
          problems.push({
            code: "models-empty",
            message: `provider ${selection.provider} declares no models list`,
            expected: `a models list declaring ${selection.model}`,
            actual: "no models list",
            entryId: "llm-pi-ai",
          });
        } else {
          const modelsEnd = Math.min(blockEnd(scan.lines, models.line, models.indent), providerEnd);
          const ids: string[] = [];
          for (let index = models.line + 1; index < modelsEnd; index += 1) {
            const match = /^\s*-\s+id:\s*(.*?)\s*$/.exec(scan.lines[index]);
            if (match !== null) ids.push(unquoteScalar(match[1]));
          }
          declaredModels = ids;
          if (ids.length === 0) {
            problems.push({
              code: "models-empty",
              message: `provider ${selection.provider} declares an empty models list`,
              expected: `a models list declaring ${selection.model}`,
              actual: "empty models list",
              entryId: "llm-pi-ai",
            });
          } else if (!ids.includes(selection.model)) {
            problems.push({
              code: "model-not-declared",
              message: `provider ${selection.provider} does not declare model ${JSON.stringify(selection.model)}`,
              hint: "a model id that is referenced elsewhere but not declared here fails at request time, not at boot",
              expected: selection.model,
              actual: ids.join(", "),
              entryId: "llm-pi-ai",
            });
          }
        }
      }
    } else {
      problems.push({
        code: "provider-mismatch",
        message: "llm-pi-ai entry has no providers block",
        expected: selection.provider,
        actual: "(no providers block)",
        entryId: "llm-pi-ai",
      });
    }
  }

  // Reference parties (vision-router and friends) repeat the model id. The host
  // sends that id verbatim, so a near-miss here fails at request time with
  // 404/UNKNOWN_MODEL even though the default entry is right.
  const references: ModelConfigReference[] = [];
  for (const entry of scan.entries) {
    if (entry.id === "agent-default-model" || entry.id === "llm-pi-ai") continue;
    for (const item of collectReferenceItems(scan.lines, entry)) {
      references.push({ entryId: item.entryId, provider: item.provider, model: item.model });
      if (item.provider === selection.provider && item.model !== null && item.model !== selection.model) {
        problems.push({
          code: "reference-model-mismatch",
          message:
            `${entry.id} references provider ${JSON.stringify(item.provider)} with model ` +
            `${JSON.stringify(item.model)}, expected ${JSON.stringify(selection.model)}`,
          hint: "reference parties must use the declared model id verbatim; a near-miss id is a different model at request time",
          expected: selection.model,
          actual: item.model,
          entryId: entry.id,
        });
      }
    }
  }

  return {
    configured: problems.length === 0,
    defaultProvider,
    defaultModel,
    apiKeyEnv,
    declaredModels: Object.freeze(declaredModels),
    references: Object.freeze(references),
    problems: Object.freeze(problems),
  };
}

/** One `- provider: <p>` list item inside an entry, with its optional `model`. */
interface ReferenceItem {
  readonly entryId: string;
  readonly provider: string;
  readonly modelLine: number | null;
  readonly model: string | null;
}

/**
 * Collect the `- provider: <p>` list items of one entry (the shape a reference
 * party such as vision-router uses). A mapping-style provider list is not a
 * reference party and is ignored.
 */
function collectReferenceItems(lines: readonly string[], entry: PatchEntry): ReferenceItem[] {
  const found: ReferenceItem[] = [];
  const itemRe = /^(\s*)-\s+provider:\s*(.*?)\s*$/;
  for (let index = entry.startLine; index < entry.endLine; index += 1) {
    const match = itemRe.exec(lines[index]);
    if (match === null) continue;
    const itemIndent = match[1].length;
    let itemEnd = index + 1;
    for (; itemEnd < entry.endLine; itemEnd += 1) {
      if (isBlankOrComment(lines[itemEnd])) continue;
      if (indentOf(lines[itemEnd]) <= itemIndent) break;
    }
    const model = findScalar(lines, index + 1, itemEnd, "model");
    found.push({
      entryId: entry.id,
      provider: unquoteScalar(match[2]),
      modelLine: model?.line ?? null,
      model: model?.value ?? null,
    });
    index = itemEnd - 1;
  }
  return found;
}

/* -------------------------------------------------------------------- editing */

export interface ModelConfigEditResult {
  readonly text: string;
  readonly changed: boolean;
  readonly notes: readonly string[];
}

/**
 * Produce text that satisfies `inspectModelConfig`, by editing only the lines
 * that are wrong or missing. Pure: callers own the write.
 */
export function planModelConfigEdit(text: string, selection: ModelSelection): Result<ModelConfigEditResult> {
  const scan = scanPatch(text);
  const before = inspectModelConfig(text, selection);
  if (before.configured) return ok({ text, changed: false, notes: [] });

  const defaultEntry = findEntry(scan, "agent-default-model");
  if (defaultEntry === null) {
    return err({
      code: "prerequisite",
      message: "cannot configure the model: profile has no agent-default-model entry",
      hint: "this tool only edits an existing entry; open the profile once in the desktop app so DSH writes it",
    });
  }
  const providerEntry = findEntry(scan, "llm-pi-ai");
  if (providerEntry === null) {
    return err({
      code: "prerequisite",
      message: "cannot configure the model: profile has no llm-pi-ai entry",
      hint: "enable the pi-ai provider in this profile first",
    });
  }

  let lines = [...scan.lines];
  const notes: string[] = [];

  // 1. agent-default-model: provider + model, and drop reasoningEffort (it is a
  //    provider-specific knob; leaving it behind while switching providers makes
  //    the request shape depend on which provider happened to be configured).
  const entry = findEntry(scanPatch(lines.join(scan.eol)), "agent-default-model")!;
  lines = setScalar(lines, entry, "provider", selection.provider, notes);
  const refreshed = findEntry(scanPatch(lines.join(scan.eol)), "agent-default-model")!;
  lines = setScalar(lines, refreshed, "model", selection.model, notes);
  const refreshedAgain = findEntry(scanPatch(lines.join(scan.eol)), "agent-default-model")!;
  const reasoning = findScalar(lines, refreshedAgain.startLine, refreshedAgain.endLine, "reasoningEffort");
  if (reasoning !== null) {
    lines.splice(reasoning.line, 1);
    notes.push("removed agent-default-model.reasoningEffort: it is provider-specific and can make the request shape invalid");
  }

  // 2. llm-pi-ai: providers.<provider>.apiKeyEnv and providers.<provider>.models[].
  lines = ensureProviderEntry(lines, selection, notes);

  // 3. Reference parties: align the model id of every item that names this
  //    provider. In-place replacements, so the line numbers stay valid.
  lines = alignReferenceModels(lines, selection, notes);

  const nextText = lines.join(scan.eol) + (scan.trailingNewline ? scan.eol : "");
  const after = inspectModelConfig(nextText, selection);
  if (!after.configured) {
    return err({
      code: "internal",
      message: "model configuration edit did not converge; the profile file needs manual review",
      hint: after.problems.map((item) => item.message).join("; "),
    });
  }
  return ok({ text: nextText, changed: true, notes: Object.freeze(notes) });
}

/** Set `key: value` inside an entry: replace the existing line, else insert under `config:`. */
function setScalar(
  lines: readonly string[],
  entry: PatchEntry,
  key: string,
  value: string,
  notes: string[],
): string[] {
  const next = [...lines];
  const existing = findScalar(next, entry.startLine, entry.endLine, key);
  const rendered = `${key}: ${renderScalar(value)}`;
  if (existing !== null) {
    const indent = " ".repeat(existing.indent);
    next[existing.line] = `${indent}${rendered}`;
    notes.push(`set ${key} to ${value}`);
    return next;
  }
  const insertion = insertionPointForScalar(next, entry);
  next.splice(insertion.at, 0, `${" ".repeat(insertion.indent)}${rendered}`);
  notes.push(`added ${key}: ${value}`);
  return next;
}

function insertionPointForScalar(lines: readonly string[], entry: PatchEntry): { at: number; indent: number } {
  for (let index = entry.startLine; index < entry.endLine; index += 1) {
    const match = /^(\s*)config:\s*(?:#.*)?$/.exec(lines[index]);
    if (match !== null) return { at: index + 1, indent: match[1].length + 2 };
  }
  // No config block: nest two spaces under the entry id line.
  const idIndent = indentOf(lines[entry.startLine]);
  return { at: entry.startLine + 1, indent: idIndent + 2 };
}

/**
 * Make sure `providers.<provider>` exists with the right `apiKeyEnv` and a models
 * list that contains `selection.model`. Works from the outside in (block, then
 * provider, then key, then models, then the item) and re-scans after every
 * insertion, because every splice shifts the line indexes it just computed.
 */
function ensureProviderEntry(initial: readonly string[], selection: ModelSelection, notes: string[]): string[] {
  const lines = [...initial];
  const modelsFields = modelItemLines(selection);

  const locate = (): ProviderLocation | null => {
    const entry = findEntry(scanPatch(lines.join("\n")), "llm-pi-ai");
    if (entry === null) return null;
    const providers = findBlock(lines, entry.startLine, entry.endLine, "providers");
    if (providers === null) {
      return { entry, providers: null, providersEnd: 0, provider: null, providerEnd: 0, models: null };
    }
    const providersEnd = Math.min(blockEnd(lines, providers.line, providers.indent), entry.endLine);
    const provider = findBlock(lines, providers.line + 1, providersEnd, selection.provider);
    if (provider === null) return { entry, providers, providersEnd, provider: null, providerEnd: 0, models: null };
    const providerEnd = Math.min(blockEnd(lines, provider.line, provider.indent), providersEnd);
    const models = findBlock(lines, provider.line + 1, providerEnd, "models");
    return { entry, providers, providersEnd, provider, providerEnd, models };
  };

  let state = locate();
  if (state === null) return lines;

  // 1. The providers block itself.
  if (state.providers === null) {
    const at = insertionPointForScalar(lines, state.entry);
    lines.splice(at.at, 0, `${" ".repeat(at.indent)}providers:`);
    notes.push("added llm-pi-ai.config.providers block");
    state = locate();
    if (state === null || state.providers === null) return lines;
  }

  // 2. The provider block: apiKeyEnv plus a models list, inserted as one unit so
  //    a half-configured provider never exists between two writes.
  if (state.provider === null) {
    const providerIndent = state.providers.indent + 2;
    const fieldsIndent = providerIndent + 2;
    lines.splice(
      state.providers.line + 1,
      0,
      `${" ".repeat(providerIndent)}${renderKey(selection.provider)}:`,
      `${" ".repeat(fieldsIndent)}apiKeyEnv: ${renderScalar(selection.apiKeyEnv)}`,
      `${" ".repeat(fieldsIndent)}models:`,
      ...modelsFields.map((line) => `${" ".repeat(fieldsIndent + 2)}${line}`),
    );
    notes.push(`added provider ${selection.provider} with apiKeyEnv ${selection.apiKeyEnv} and model ${selection.model}`);
    return lines;
  }

  // 3. apiKeyEnv: replace a wrong value, insert a missing one.
  const keyEnv = findScalar(lines, state.provider.line + 1, state.providerEnd, "apiKeyEnv");
  if (keyEnv === null) {
    lines.splice(
      state.provider.line + 1,
      0,
      `${" ".repeat(state.provider.indent + 2)}apiKeyEnv: ${renderScalar(selection.apiKeyEnv)}`,
    );
    notes.push(`added apiKeyEnv ${selection.apiKeyEnv}`);
    state = locate();
    if (state === null || state.provider === null) return lines;
  } else if (keyEnv.value !== selection.apiKeyEnv) {
    lines[keyEnv.line] = `${" ".repeat(keyEnv.indent)}apiKeyEnv: ${renderScalar(selection.apiKeyEnv)}`;
    notes.push(`changed apiKeyEnv from ${keyEnv.value} to ${selection.apiKeyEnv}`);
  }

  // 4. The models list.
  if (state.models === null) {
    const modelsIndent = state.provider.indent + 2;
    const afterKeyEnv = findScalar(lines, state.provider.line + 1, state.providerEnd, "apiKeyEnv");
    lines.splice(
      afterKeyEnv === null ? state.provider.line + 1 : afterKeyEnv.line + 1,
      0,
      `${" ".repeat(modelsIndent)}models:`,
      ...modelsFields.map((line) => `${" ".repeat(modelsIndent + 2)}${line}`),
    );
    notes.push(`added models list with ${selection.model}`);
    return lines;
  }

  // 5. The model item itself, keeping the indentation the file already uses.
  const modelsEnd = Math.min(blockEnd(lines, state.models.line, state.models.indent), state.providerEnd);
  let itemIndent = state.models.indent + 2;
  let hasModel = false;
  for (let index = state.models.line + 1; index < modelsEnd; index += 1) {
    const match = /^(\s*)-\s+id:\s*(.*?)\s*$/.exec(lines[index]);
    if (match === null) continue;
    itemIndent = match[1].length;
    if (unquoteScalar(match[2]) === selection.model) hasModel = true;
  }
  if (hasModel) return lines;
  lines.splice(modelsEnd, 0, ...modelsFields.map((line) => `${" ".repeat(itemIndent)}${line}`));
  notes.push(`added model ${selection.model} to provider ${selection.provider}`);
  return lines;
}

/**
 * Rewrite the `model:` line of each reference item that names the configured
 * provider. Items for other providers are left alone. A trailing comment on the
 * rewritten line is kept.
 */
function alignReferenceModels(
  initial: readonly string[],
  selection: ModelSelection,
  notes: string[],
): string[] {
  const lines = [...initial];
  const scan = scanPatch(lines.join("\n"));
  for (const entry of scan.entries) {
    if (entry.id === "agent-default-model" || entry.id === "llm-pi-ai") continue;
    for (const item of collectReferenceItems(lines, entry)) {
      if (item.provider !== selection.provider) continue;
      if (item.modelLine === null || item.model === null || item.model === selection.model) continue;
      const line = lines[item.modelLine];
      const match = /^(\s*model:\s*)(.*?)(\s+#.*)?$/.exec(line);
      if (match === null) continue;
      lines[item.modelLine] = `${match[1]}${renderScalar(selection.model)}${match[3] ?? ""}`;
      notes.push(
        `aligned ${entry.id} reference model id from ${item.model} to ${selection.model}`,
      );
    }
  }
  return lines;
}

interface ProviderLocation {
  readonly entry: PatchEntry;
  readonly providers: { readonly line: number; readonly indent: number } | null;
  readonly providersEnd: number;
  readonly provider: { readonly line: number; readonly indent: number } | null;
  readonly providerEnd: number;
  readonly models: { readonly line: number; readonly indent: number } | null;
}

/** A YAML mapping key: bare when unambiguous, quoted otherwise. */
function renderKey(value: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value) ? value : JSON.stringify(value);
}

/** The five lines of one models[] item, at their relative indentation. */
function modelItemLines(selection: ModelSelection): string[] {
  const fields = [
    "- id: " + renderScalar(selection.model),
    "  name: " + renderScalar(selection.model),
    ...(selection.contextWindow === undefined ? [] : [`  contextWindow: ${selection.contextWindow}`]),
    ...(selection.maxTokens === undefined ? [] : [`  maxTokens: ${selection.maxTokens}`]),
    ...(selection.input === undefined ? [] : [`  input: [${selection.input.join(", ")}]`]),
  ];
  return fields;
}

/** Quote only when the scalar would otherwise be misread. */
function renderScalar(value: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
