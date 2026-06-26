/**
 * mcp-audit-core.mjs — Pure flag computation logic for the MCP audit (MCP-010).
 *
 * WHY split: mcp-audit.mjs was growing past the 308-line hard budget. The
 * I/O (config read, receipt store read) and the pure flag logic are two
 * distinct responsibilities — splitting here honours both SRP and the budget.
 *
 * This module is PURE: zero I/O, zero side effects. All inputs are supplied
 * by the caller (mcp-audit.mjs). Each function is independently testable.
 *
 * Zero runtime deps — node:* not required here. ADR-0073 / MCP-010.
 */

// ---------------------------------------------------------------------------
// Types (JSDoc only)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ name: string, transport: string, version?: string, envKeys?: string[], tools?: string[] }} McpServerInfo
 * @typedef {{ name: string, transport: string, version?: string, envKeys?: string[], tools?: string[] }} McpServerDescriptor
 * @typedef {{ code: string, server: string, severity: 'high'|'medium'|'low', message: string }} AuditFlag
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WRITE_TOOL_PATTERN = /write|create|update|delete|push|send|post|patch|insert|remove/i;
const SECRET_KEY_PATTERN = /secret|token|key|password|credential/i;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a server exposes at least one write-capable tool (by name).
 * @param {McpServerInfo} server
 * @returns {boolean}
 */
export function hasWriteTools(server) {
  return (server.tools ?? []).some((t) => WRITE_TOOL_PATTERN.test(t));
}

/**
 * Returns the environment key names that reference secrets for a server.
 * Accepts envKeys (string[]) — values are never present in McpServerInfo.
 *
 * @param {McpServerInfo} server
 * @returns {string[]}
 */
export function secretReferenceNames(server) {
  return (server.envKeys ?? []).filter((k) => SECRET_KEY_PATTERN.test(k));
}

// ---------------------------------------------------------------------------
// computeFlags
// ---------------------------------------------------------------------------

/**
 * Computes all MCP audit flags from the configured servers and receipt log.
 *
 * Flags:
 *   HAS_WRITE_TOOLS  — server exposes at least one write-capable tool (name matches write pattern).
 *                      Signals that the operator should verify the server's permission scope before
 *                      granting access. Approval-gate integration is tracked in CDK-022.
 *   UNPINNED_SERVER  — no explicit version pin in config
 *   SECRET_REFERENCE — env block references a secret key name (key name only — no values stored)
 *   UNUSED_SERVER    — server configured but no receipts in store
 *   HOST_DRIFT       — receipt.host ≠ currentHost
 *
 * Pure: no I/O. All sources supplied by caller.
 *
 * @param {McpServerInfo[]} servers
 * @param {object[]} receipts
 * @param {{ currentHost: string }} context
 * @returns {AuditFlag[]}
 */
export function computeFlags(servers, receipts, { currentHost }) {
  const flags = [];

  // Index receipts by server name for UNUSED detection
  /** @type {Map<string, object[]>} */
  const receiptsByServer = new Map();
  for (const r of receipts) {
    for (const srv of Array.isArray(r.servers) ? r.servers : []) {
      if (!receiptsByServer.has(srv)) receiptsByServer.set(srv, []);
      receiptsByServer.get(srv).push(r);
    }
  }

  for (const server of servers) {
    if (hasWriteTools(server)) {
      flags.push({
        code: 'HAS_WRITE_TOOLS',
        server: server.name,
        severity: 'high',
        message: `Server '${server.name}' exposes write-capable tools (names match write pattern). Review its permissions before granting access.`,
      });
    }

    if (!server.version) {
      flags.push({
        code: 'UNPINNED_SERVER',
        server: server.name,
        severity: 'medium',
        message: `Server '${server.name}' has no version pin. Unpinned servers risk silent behavior changes.`,
      });
    }

    for (const keyName of secretReferenceNames(server)) {
      flags.push({
        code: 'SECRET_REFERENCE',
        server: server.name,
        severity: 'low',
        message: `Server '${server.name}' references secret env key '${keyName}' (value not stored).`,
      });
    }

    if (!receiptsByServer.has(server.name)) {
      flags.push({
        code: 'UNUSED_SERVER',
        server: server.name,
        severity: 'low',
        message: `Server '${server.name}' is configured but has no receipts in the local store.`,
      });
    }
  }

  // HOST_DRIFT — receipts whose host ≠ currentHost
  for (const receipt of receipts) {
    const receiptHost = typeof receipt.host === 'string' ? receipt.host : '';
    if (receiptHost && receiptHost !== currentHost) {
      flags.push({
        code: 'HOST_DRIFT',
        server: (receipt.servers ?? [])[0] ?? '(unknown)',
        severity: 'medium',
        message: `Receipt '${receipt.id ?? '?'}' was written by host '${receiptHost}' but current host is '${currentHost}'.`,
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

/**
 * Assembles the full audit report from parsed inputs and computed flags.
 *
 * @param {object} opts
 * @param {McpServerInfo[]} opts.servers
 * @param {object[]} opts.receipts
 * @param {boolean} opts.configFound
 * @param {string} opts.substrateStatus
 * @param {string} opts.currentHost
 * @returns {import('./mcp-audit.mjs').AuditReport}
 */
export function buildReport({ servers, receipts, configFound, substrateStatus, currentHost }) {
  const flags = computeFlags(servers, receipts, { currentHost });

  const unusedSet = new Set(
    flags.filter((f) => f.code === 'UNUSED_SERVER').map((f) => f.server),
  );

  /** @type {Record<string,string[]>} */
  const exposedTools = {};
  /** @type {Record<string,string[]>} */
  const secretRefs = {};
  /** @type {Record<string,string>} */
  const transports = {};

  for (const srv of servers) {
    exposedTools[srv.name] = srv.tools ?? [];
    secretRefs[srv.name] = secretReferenceNames(srv);
    transports[srv.name] = srv.transport;
  }

  // McpServerInfo carries envKeys (string[]) only — values are stripped at the I/O boundary
  // in mcp-audit.mjs. McpServerDescriptor is structurally identical; mapping here is a
  // shallow projection for type clarity. Acceptance criterion 3: no secret values in output.
  /** @type {McpServerDescriptor[]} */
  const serverDescriptors = servers.map((srv) => ({
    name: srv.name,
    transport: srv.transport,
    ...(srv.version !== undefined ? { version: srv.version } : {}),
    envKeys: srv.envKeys ?? [],
    tools: srv.tools ?? [],
  }));

  return {
    configFound,
    substrateStatus,
    servers: serverDescriptors,
    receipts: receipts.length,
    flags,
    activeServers: servers.map((s) => s.name),
    unusedServers: [...unusedSet],
    exposedTools,
    secretRefs,
    transports,
  };
}
