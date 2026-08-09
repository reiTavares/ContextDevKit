/**
 * MCP Dynamic Activation — rules & matching (pure).
 *
 * Cohesion note: the ACTIVATION_TABLE rows and the matching helpers
 * (normaliseTaskType / matchesTask / findMatchingRule / intersectWithManifest)
 * are co-evolved, split out of activation.mjs so each file stays under the
 * 308-line RED ceiling (constitution section 1) with one read-path per concern.
 *
 * PURE and deterministic, node:* only (no imports needed).
 *
 * @module activation-rules
 */

/**
 * Canonical task to server mapping table. Order matters: first match wins
 * per-server; id MUST match a manifest entry id; read-only narrows write.
 *
 * @type {Array<{taskPatterns: (string|RegExp)[], squadPatterns?: string[], pathPatterns?: (string|RegExp)[], servers: {id:string, mode?:string, allowedTools?:string[]}[]}>}
 */
export const ACTIVATION_TABLE = [
  {
    taskPatterns: ['fix-ui', 'ui', 'frontend', 'style', 'component', 'visual'],
    servers: [
      { id: 'playwright',  mode: 'write',     allowedTools: ['navigate', 'screenshot', 'click', 'fill', 'check'] },
      { id: 'github',      mode: 'read-only', allowedTools: ['get_file_contents', 'search_code', 'list_pull_requests', 'get_pull_request'] },
      { id: 'figma',       mode: 'read-only', allowedTools: ['get_file', 'get_node', 'get_comments'] },
    ],
  },
  {
    taskPatterns: ['migration', 'migrate', 'db-migration', 'schema-change'],
    servers: [
      { id: 'postgres',    mode: 'read-only', allowedTools: ['query', 'list_tables', 'describe_table'] },
      { id: 'github',      mode: 'read-only', allowedTools: ['get_file_contents', 'search_code', 'list_pull_requests', 'get_pull_request'] },
    ],
  },
  {
    taskPatterns: ['backend', 'api', 'service', 'endpoint'],
    servers: [
      { id: 'github',      mode: 'read-only', allowedTools: ['get_file_contents', 'search_code', 'list_pull_requests', 'get_pull_request', 'create_pull_request', 'create_issue'] },
      { id: 'postgres',    mode: 'read-only', allowedTools: ['query', 'list_tables', 'describe_table'] },
    ],
  },
  {
    taskPatterns: ['review', 'pr-review', 'code-review'],
    servers: [
      { id: 'github',      mode: 'read-only', allowedTools: ['get_file_contents', 'search_code', 'list_pull_requests', 'get_pull_request', 'get_issue', 'list_commits'] },
    ],
  },
  {
    taskPatterns: ['test', 'qa', 'e2e', 'integration-test'],
    servers: [
      { id: 'playwright',  mode: 'write',     allowedTools: ['navigate', 'screenshot', 'click', 'fill', 'check', 'wait_for_selector'] },
      { id: 'github',      mode: 'read-only', allowedTools: ['get_file_contents', 'list_pull_requests'] },
    ],
  },
  {
    taskPatterns: ['security', 'audit', 'deps-audit'],
    servers: [
      { id: 'github',      mode: 'read-only', allowedTools: ['get_file_contents', 'search_code', 'list_pull_requests', 'get_pull_request'] },
    ],
  },
  {
    taskPatterns: ['docs', 'documentation', 'design', 'wireframe'],
    servers: [
      { id: 'figma',       mode: 'read-only', allowedTools: ['get_file', 'get_node', 'get_comments', 'get_images'] },
      { id: 'github',      mode: 'read-only', allowedTools: ['get_file_contents', 'search_code'] },
    ],
  },
  {
    taskPatterns: ['deploy', 'ship', 'release'],
    servers: [
      { id: 'github',      mode: 'read-only', allowedTools: ['list_pull_requests', 'get_pull_request', 'get_issue', 'list_releases', 'get_release'] },
    ],
  },
];

export function normaliseTaskType(taskType) {
  return taskType.toLowerCase().trim().replace(/[\s_]+/g, '-');
}

export function matchesTask(pattern, normalised) {
  if (pattern instanceof RegExp) return pattern.test(normalised);
  return normalised === pattern || normalised.startsWith(pattern + '-');
}

export function findMatchingRule(normalisedTask, squad, paths) {
  for (const rule of ACTIVATION_TABLE) {
    const taskHit = rule.taskPatterns.some((p) => matchesTask(p, normalisedTask));
    if (!taskHit) continue;
    if (rule.squadPatterns && squad) {
      const squadHit = rule.squadPatterns.some((s) => s === squad || squad.startsWith(s));
      if (!squadHit) continue;
    }
    if (rule.pathPatterns && paths && paths.length > 0) {
      const pathHit = paths.some((p) =>
        rule.pathPatterns.some((pp) => (pp instanceof RegExp ? pp.test(p) : p.includes(pp))),
      );
      if (!pathHit) continue;
    }
    return rule;
  }
  return null;
}

export function intersectWithManifest(ruleServers, manifest) {
  const manifestMap = new Map(manifest.map((e) => [e.id, e]));
  const result = [];
  for (const ruleServer of ruleServers) {
    const manifestEntry = manifestMap.get(ruleServer.id);
    if (!manifestEntry) continue;
    if (manifestEntry.disabled === true) continue;
    const manifestMode = manifestEntry.mode ?? 'read-only';
    const ruleMode = ruleServer.mode ?? 'read-only';
    const effectiveMode =
      manifestMode === 'read-only' || ruleMode === 'read-only' ? 'read-only' : 'write';
    const manifestTools = manifestEntry.allowedTools ?? [];
    const ruleTools = ruleServer.allowedTools ?? [];
    let effectiveTools;
    if (manifestTools.length === 0 && ruleTools.length === 0) effectiveTools = [];
    else if (manifestTools.length === 0) effectiveTools = ruleTools;
    else if (ruleTools.length === 0) effectiveTools = manifestTools;
    else {
      const manifestSet = new Set(manifestTools);
      effectiveTools = ruleTools.filter((t) => manifestSet.has(t));
    }
    result.push({ entry: manifestEntry, mode: effectiveMode, allowedTools: effectiveTools });
  }
  return result;
}
