#!/usr/bin/env node
/**
 * `graph` — the human/agent-facing query surface for the Structural Knowledge
 * Graph (IF2, WF-0072/BIZ-0004). A thin dispatcher over `graph-query.mjs` +
 * `graph-consumers.mjs`; it never parses source, only reads the committed
 * projection, and prints a JSON receipt. Absent graph -> a `{available:false}`
 * receipt with exit code 3 (distinct from a usage error, exit 2), so a caller
 * can tell "no graph yet" from "bad invocation" — never a fabricated answer.
 *
 * This is the single command every surface routes through: the `/project-map
 * --graph/--callers/--callees/--query` docs, the MCP server, and (as a later
 * additive follow-on) the execution-gate "query the graph first" nudge all shell
 * out to this one entry point rather than re-implementing traversal.
 *
 * Subcommands:
 *   callers <id>        reverse callers of a symbol
 *   affected <id>       reverse consumers (who breaks if it changes)
 *   impact <id>         callers + consumers + blast-radius count
 *   neighbors <id>      bounded, hub-avoiding neighborhood (--budget N)
 *   path <from> <to>    shortest path between two nodes
 *   god-nodes           most-connected nodes (--top N)
 *   query <substr>      node ids containing a substring
 *
 * Zero non-`node:` imports beyond the two sibling scripts (immutable rule 1).
 */
import { loadProjection, reverseCallers, boundedReachability, godNodes, shortestPath } from './graph-query.mjs';
import { impactReport, contractReverseConsumers } from './graph-consumers.mjs';
import { queryProjectGraph } from '../../runtime/graph/provider.mjs';

/** Parses `--flag value` pairs and positionals from an argv slice. */
function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++; }
    else positionals.push(argv[i]);
  }
  return { flags, positionals };
}

const USAGE = 'usage: graph <callers|affected|impact|neighbors|path|god-nodes|query> [id...] [--budget N] [--top N]';

/**
 * Dispatches one parsed invocation to a query result. Pure over `root`; returns
 * the query object (which may be `{available:false}` when the graph is absent).
 *
 * @param {string} root project root
 * @param {string} command subcommand
 * @param {{flags:object, positionals:string[]}} args
 * @param {{provider?:object,fallback?:Function}} [options] provider/fallback injection for tests and external adapters
 * @returns {object}
 * @throws {Error} on an unknown subcommand or missing required argument
 */
export function dispatch(root, command, args, options = {}) {
  const { flags, positionals } = args;
  const need = (i, label) => {
    if (!positionals[i]) throw new Error(`graph ${command}: missing <${label}>`);
    return positionals[i];
  };
  switch (command) {
    case 'callers':
      return reverseCallers(loadProjection(root), need(0, 'id'));
    case 'affected':
      return contractReverseConsumers(root, need(0, 'id'));
    case 'impact':
      return impactReport(root, need(0, 'id'));
    case 'neighbors':
      return boundedReachability(loadProjection(root), need(0, 'id'), Number(flags.budget) || 40);
    case 'path':
      return shortestPath(loadProjection(root), need(0, 'from'), need(1, 'to'));
    case 'god-nodes':
      return godNodes(loadProjection(root), Number(flags.top) || 10);
    case 'query':
      return queryProjectGraph(
        { root, query: need(0, 'substr') },
        { provider: options.provider, fallback: options.fallback },
      );
    default:
      throw new Error(`graph: unknown subcommand "${command}". ${USAGE}`);
  }
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph.mjs') {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) { process.stderr.write(USAGE + '\n'); process.exit(2); }
  try {
    const result = dispatch(process.cwd(), command, parseArgs(rest));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    // Provider queries are successful non-blocking receipts even when they ask
    // for fallback. Legacy structural commands keep exit 3 for unavailable data.
    process.exit(result && result.available === false && result.searchAllowed !== true ? 3 : 0);
  } catch (err) {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    process.exit(2);
  }
}
