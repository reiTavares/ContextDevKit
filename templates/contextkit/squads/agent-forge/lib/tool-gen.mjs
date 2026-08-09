/**
 * tool-designer — render the canonical JSON tool schemas to per-provider adapter
 * files. Fase 1 shipped Anthropic + OpenAI; Fase 2 adds Gemini (functionDeclarations
 * SUBSET — `additionalProperties` and `$schema` are dropped because Gemini's
 * function-calling parser rejects them), DeepSeek (OpenAI-compat drop-in), and
 * Ollama (OpenAI-compat via /v1/chat/completions). Provider-specific quirks live
 * INSIDE these render functions — the canonical file stays neutral. Pure + zero-dep.
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

/**
 * Strip JSON-Schema fields Gemini's `functionDeclarations` parser rejects:
 * `additionalProperties`, `$schema`, `$id`, `$ref` (subset enforcement).
 * Recurses into nested object/array shapes.
 */
function downConvertForGemini(node) {
  if (Array.isArray(node)) return node.map(downConvertForGemini);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties' || key === '$schema' || key === '$id' || key === '$ref') continue;
    out[key] = typeof value === 'object' ? downConvertForGemini(value) : value;
  }
  return out;
}

/** Google (Gemini) `tools[].functionDeclarations[]`. parameters is the JSON-Schema SUBSET. */
export function renderGoogle(tools) {
  return {
    _generated: 'agent-forge tool-designer (Fase 2) from ../schemas.canonical.json — do not hand-edit',
    _format: "Gemini `tools[].functionDeclarations[]`: { name, description, parameters }. parameters is a JSON-Schema SUBSET — additionalProperties + $schema dropped.",
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: downConvertForGemini(t.input_schema),
    })),
  };
}

/** DeepSeek: OpenAI-compatible drop-in. */
export function renderDeepSeek(tools) {
  return {
    _generated: 'agent-forge tool-designer (Fase 2) from ../schemas.canonical.json — do not hand-edit',
    _format: "DeepSeek is OpenAI-compatible — same shape as openai.tools.json (type 'function').",
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
  };
}

/** Self-hosted (Ollama/vLLM) via OpenAI-compatible endpoint. Native function calling on Llama 3.x / Mistral. */
export function renderOllama(tools) {
  return {
    _generated: 'agent-forge tool-designer (Fase 2) from ../schemas.canonical.json — do not hand-edit',
    _format: "Self-hosted via OpenAI-compatible endpoint. Native function calling on Llama 3.x / Mistral; reliability below cloud — robust eval is critical.",
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
  };
}

/** One-stop adapter generator: anthropic + openai + google + deepseek + ollama. */
export function generateAdapters(canonical) {
  const tools = parseCanonical(canonical);
  return {
    tools,
    anthropic: renderAnthropic(tools),
    openai: renderOpenAI(tools),
    google: renderGoogle(tools),
    deepseek: renderDeepSeek(tools),
    ollama: renderOllama(tools),
  };
}
