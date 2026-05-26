/**
 * tool-designer — render the canonical JSON tool schemas to per-provider adapter
 * files. Fase 1 ships Anthropic + OpenAI; Fases 2+ add Gemini (functionDeclarations
 * subset), DeepSeek (OpenAI-compat), Ollama (OpenAI-compat with chat_template).
 * Provider-specific quirks live INSIDE these render functions — the canonical file
 * stays neutral. Pure + zero-dep.
 *
 * Canonical shape: `tools/schemas.canonical.json` uses tool names as top-level keys
 * (reserving `_note` / `$schema` for metadata). Each tool is
 * `{ description, idempotent?, input_schema, error_format? }`.
 */

/** Walk the canonical object → `[{ name, description, input_schema, idempotent, error_format }]`. */
export function parseCanonical(canonical) {
  if (!canonical || typeof canonical !== 'object') return [];
  return Object.entries(canonical)
    .filter(([k]) => !k.startsWith('_') && !k.startsWith('$'))
    .map(([name, def]) => ({
      name,
      description: def?.description || '',
      input_schema: def?.input_schema || { type: 'object', properties: {}, required: [] },
      idempotent: def?.idempotent ?? null,
      error_format: def?.error_format ?? null,
    }));
}

/** Anthropic `tools` array — `{ name, description, input_schema }`. Force-call via tool_choice. */
export function renderAnthropic(tools) {
  return {
    _generated: 'agent-forge tool-designer (Fase 1) from ../schemas.canonical.json — do not hand-edit',
    _format: "Anthropic `tools` array: { name, description, input_schema }. Force a tool with tool_choice: { type: 'tool', name }.",
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
  };
}

/** OpenAI `tools` array — `{ type: 'function', function: { name, description, parameters } }`. */
export function renderOpenAI(tools) {
  return {
    _generated: 'agent-forge tool-designer (Fase 1) from ../schemas.canonical.json — do not hand-edit',
    _format: "OpenAI `tools` array of type 'function'. Force a call with tool_choice: { type: 'function', function: { name } }.",
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
  };
}

/** One-stop adapter generator. */
export function generateAdapters(canonical) {
  const tools = parseCanonical(canonical);
  return {
    tools,
    anthropic: renderAnthropic(tools),
    openai: renderOpenAI(tools),
  };
}
