#!/usr/bin/env node
/**
 * Graph capability gate (GC4-T1, WF-0071/BIZ-0004).
 *
 * A single defensive reader for the `projectMap.graph.enabled` flag. The graph
 * capability is OFF by default (refusal-by-default, constitution section 8):
 * absent config, absent section, or any non-`true` value all resolve to
 * disabled — only an explicit boolean `true` enables it. The full config SCHEMA
 * block (.passthrough().default), the L7 level gating and the installer wiring
 * are WF-0074's job; WF-0071 only needs the tools to RESPECT the flag without
 * touching the hot-path config schema. This is the one shared seam the WF-0072
 * consumers (simulate-impact / task-compiler / MCP) check, so the flag is read
 * in exactly one place (single source of truth).
 *
 * Pure; no imports at all (not even node:*). Never throws on malformed input.
 */

/**
 * Is the structural knowledge graph enabled for this project? Default OFF: only
 * an explicit `config.projectMap.graph.enabled === true` turns it on. Any other
 * shape (undefined, missing section, non-boolean, `false`) is disabled.
 *
 * @param {unknown} config parsed contextkit config object (any shape)
 * @returns {boolean}
 */
export function isGraphEnabled(config) {
  if (!config || typeof config !== 'object') return false;
  const projectMap = config.projectMap;
  if (!projectMap || typeof projectMap !== 'object') return false;
  const graph = projectMap.graph;
  if (!graph || typeof graph !== 'object') return false;
  return graph.enabled === true;
}
