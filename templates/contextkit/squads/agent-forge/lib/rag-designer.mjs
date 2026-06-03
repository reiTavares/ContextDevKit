/**
 * rag-designer — produces the `rag/` config bundle (chunker, embedding, index,
 * retrieval, optional reranker) when the blueprint declares `capabilities.rag`.
 * Pure + zero-dep (rule 1). Deterministic heuristics shaped by the blueprint:
 *
 *  - **Embedding model.** Multilingual (`multilingual-e5`) by default; switched to
 *    English-only (`text-embedding-3-large`) when `intent.domain` ends in `-en`.
 *  - **Index backend.** `pgvector` when `privacy.data_residency: on-prem` /
 *    `allow_cloud_providers: false`; `qdrant` otherwise — both are commodity, dev
 *    swaps via `manifest.yaml` if a different backend is already in place.
 *  - **Chunking.** Recursive 512/64 by default; tightened to 256/32 for `extraction`
 *    where boundary precision matters more than context width.
 *  - **Hybrid search + reranker** on by default — the cost is small at retrieval-time
 *    and the precision lift is large; can be flipped off in the manifest later.
 *  - **`top_k` and `min_score`.** Derived from `intent.complexity` — higher complexity
 *    keeps more candidates and lowers the score floor.
 *
 * The packager calls `designRagConfig(blueprint)` only when `capabilities.rag === true`;
 * it serializes the four returned objects into the RAG template files.
 */

const MULTILINGUAL = 'multilingual-e5';
const ENGLISH = 'text-embedding-3-large';

function pickEmbedding(blueprint) {
  const domain = String(blueprint?.intent?.domain || '').toLowerCase();
  return domain.endsWith('-en') ? { model: ENGLISH, dimensions: 3072 } : { model: MULTILINGUAL, dimensions: 1024 };
}

function pickIndexBackend(blueprint) {
  const allowsCloud = blueprint?.privacy?.allow_cloud_providers !== false;
  const residency = blueprint?.privacy?.data_residency;
  if (!allowsCloud || residency === 'on-prem') return 'pgvector';
  return 'qdrant';
}

function pickChunking(blueprint) {
  const category = blueprint?.intent?.category;
  if (category === 'extraction') return { strategy: 'recursive', chunk_size_tokens: 256, chunk_overlap_tokens: 32, respect_boundaries: ['heading', 'paragraph'], keep_metadata: ['source', 'section', 'page'] };
  return { strategy: 'recursive', chunk_size_tokens: 512, chunk_overlap_tokens: 64, respect_boundaries: ['heading', 'paragraph'], keep_metadata: ['source', 'section', 'page'] };
}

function pickRetrieval(blueprint) {
  const complexity = blueprint?.intent?.complexity || 'medium';
  const topK = complexity === 'high' ? 12 : complexity === 'low' ? 6 : 8;
  const minScore = complexity === 'high' ? 0.25 : 0.30;
  return { top_k: topK, min_score: minScore, hybrid_search: true, rerank: true };
}

function buildSources(blueprint) {
  return {
    sources: [{
      id: `${blueprint?.agent_name || 'agent'}-knowledge`,
      type: 'filesystem',
      location: './knowledge',
      include: ['**/*.{md,pdf,txt}'],
      refresh: 'manual',
    }],
  };
}

function buildRerank() {
  return { enabled: true, model: 'bge-reranker-v2-m3', top_n_after_rerank: 4, min_score: 0.50 };
}

function buildQueryTemplate() {
  return [
    '<!-- How the user query is turned into a retrieval query + how context is injected. -->',
    '',
    '## Retrieval query',
    'Strip PII, expand acronyms, and keep the original wording. The architect can override',
    'this by hand-editing the file — the runtime adapter reads it verbatim.',
    '',
    '## Context injection',
    'Inject the top-k chunks as:',
    '',
    '```',
    '<context>',
    '{{retrieved_chunks}}',
    '</context>',
    '```',
    '',
    'Instruct the model to answer ONLY from `<context>` and to say when the answer is not',
    'present (faithfulness > fluency).',
    '',
  ].join('\n');
}

/** One-stop designer for the RAG bundle. Returns the four artefacts the packager writes. */
export function designRagConfig(blueprint) {
  return {
    config: {
      embedding: pickEmbedding(blueprint),
      index: { backend: pickIndexBackend(blueprint), metric: 'cosine' },
      retrieval: pickRetrieval(blueprint),
    },
    chunker: pickChunking(blueprint),
    sources: buildSources(blueprint),
    rerank: buildRerank(),
    queryTemplate: buildQueryTemplate(),
  };
}
