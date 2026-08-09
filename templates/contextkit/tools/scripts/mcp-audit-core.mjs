/** Pure configuration audit for MCP servers. No execution receipt store. */

const WRITE_TOOL_PATTERN = /write|create|update|delete|push|send|post|patch|insert|remove/i;
const SECRET_KEY_PATTERN = /secret|token|key|password|credential/i;

/** @param {{tools?:string[]}} server @returns {boolean} */
export function hasWriteTools(server) {
  return (server.tools ?? []).some((tool) => WRITE_TOOL_PATTERN.test(tool));
}

/** @param {{envKeys?:string[]}} server @returns {string[]} */
export function secretReferenceNames(server) {
  return (server.envKeys ?? []).filter((keyName) => SECRET_KEY_PATTERN.test(keyName));
}

/**
 * Computes observable configuration flags only. Historical usage and host
 * drift are intentionally unknown without an authoritative telemetry source.
 *
 * @param {Array<{name:string,transport:string,version?:string,envKeys?:string[],tools?:string[]}>} servers
 * @returns {Array<{code:string,server:string,severity:'high'|'medium'|'low',message:string}>}
 */
export function computeFlags(servers) {
  const flags = [];
  for (const server of servers ?? []) {
    if (hasWriteTools(server)) {
      flags.push({
        code: 'HAS_WRITE_TOOLS',
        server: server.name,
        severity: 'high',
        message: `Server '${server.name}' exposes write-capable tools. Review its real permission boundary before use.`,
      });
    }
    if (!server.version) {
      flags.push({
        code: 'UNPINNED_SERVER',
        server: server.name,
        severity: 'medium',
        message: `Server '${server.name}' has no version pin.`,
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
  }
  return flags;
}

/**
 * Builds the read-only audit report from current MCP configuration.
 *
 * @param {{servers?:object[],configFound?:boolean}} input
 * @returns {object}
 */
export function buildReport({ servers = [], configFound = false }) {
  const exposedTools = {};
  const secretRefs = {};
  const transports = {};
  for (const server of servers) {
    exposedTools[server.name] = [...(server.tools ?? [])];
    secretRefs[server.name] = secretReferenceNames(server);
    transports[server.name] = server.transport;
  }
  return {
    configFound,
    observationStatus: configFound ? 'configuration-only' : 'unavailable',
    servers: servers.map((server) => ({
      name: server.name,
      transport: server.transport,
      ...(server.version !== undefined ? { version: server.version } : {}),
      envKeys: [...(server.envKeys ?? [])],
      tools: [...(server.tools ?? [])],
    })),
    flags: computeFlags(servers),
    activeServers: servers.map((server) => server.name),
    exposedTools,
    secretRefs,
    transports,
    diagnostics: ['Historical usage is unknown; ContextDevKit 4 does not maintain an MCP receipt sidecar.'],
  };
}
