/**
 * render-shared.mjs - Pure helpers shared by all four host renderers.
 *
 * WHY: all four renderers (Claude, Codex, Cursor, Antigravity) need the same
 * three primitives: (1) filter a manifest to the servers the host is allowed to
 * see, (2) expand a registry source string into runtime command/args,
 * (3) emit secrets as ${env:NAME} references, NEVER literal values.
 * Extracting these keeps each host renderer <=280 lines and prevents drift.
 *
 * CONTRACT:
 *   - Pure: no I/O, no side effects.
 *   - Zero third-party dependencies (node:* only) - hot-path safe.
 *   - Secrets appear ONLY as "${env:<NAME>}" strings in any output.
 *   - A literal secret value throws immediately (fail-closed, constitution s8).
 *
 * @module render/render-shared
 */

// -- Types (JSDoc only) --------------------------------------------------------

/**
 * @typedef {Object} ManifestEntry
 * @property {string}    id
 * @property {string}    [mode]
 * @property {string[]}  [referencedSecrets]
 * @property {string[]}  [allowedTools]
 * @property {boolean}   [disabled]
 * @property {Object}    [pin]
 */

/**
 * @typedef {Object} RegistryEntry
 * @property {string}   id
 * @property {string}   source
 * @property {string}   transport
 * @property {string[]} allowedHosts
 * @property {string[]} requiredSecrets
 * @property {Object}   pin
 * @property {string}   displayName
 */

/**
 * A server entry resolved for rendering - all fields required for any host output.
 *
 * @typedef {Object} ResolvedRenderEntry
 * @property {string}   id              Registry id.
 * @property {string}   displayName     Human-readable label from registry.
 * @property {string}   command         The executable to invoke (e.g. "npx").
 * @property {string[]} args            Arguments for the command.
 * @property {string}   transport       "stdio" | "streamable-http".
 * @property {string}   url             Non-empty only for http transport.
 * @property {Object}   env             Keys map to "${env:NAME}" references.
 * @property {string[]} allowedTools    Tool allow-list (empty = all declared).
 * @property {string}   mode            Effective mode ("read-only" | "write").
 */

/**
 * The output of any renderHost() call. The caller writes content to filePath
 * using their chosen strategy (e.g. marker-idempotent injection or atomic write).
 *
 * @typedef {Object} ConfigArtifact
 * @property {string}               filePath    Target path (relative to project root).
 * @property {'json'|'toml'}        format      Serialisation format.
 * @property {string}               content     Serialised config, ready to write.
 * @property {ResolvedRenderEntry[]} servers    Resolved entries that were rendered.
 * @property {string[]}             skipped     Server ids omitted (host not allowed).
 * @property {string}               host        The host this artifact was rendered for.
 * @property {'project'|'user'|'workspace'} scope  Write target scope for the artifact.
 */

// -- Known secret-value heuristics (mirrors manifest.mjs - kept in sync) ------

const SECRET_VALUE_PATTERNS = Object.freeze([
  /^gh[ps]_[A-Za-z0-9]{20,}$/,
  /^sk-[A-Za-z0-9]{20,}$/,
  /^xox[bpoa]-[0-9A-Za-z-]{24,}$/,
  /^[A-Za-z0-9+/]{40,}={0,2}$/,
  /\s/,
]);
const VALID_ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;

/**
 * Throws if candidate looks like a literal secret value rather than a name.
 * Called before emitting any env entry so the renderer can never silently leak.
 *
 * @param {string} candidate
 * @param {string} serverId  For error context.
 * @throws {TypeError}
 */
export function assertSecretName(candidate, serverId) {
  if (typeof candidate !== 'string') {
    throw new TypeError(
      `[render] server '${serverId}': secret ref must be a string, got ${typeof candidate}`
    );
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(candidate)) {
      throw new TypeError(
        `[render] server '${serverId}': referencedSecrets contains what looks like a literal ` +
        `secret value ('${candidate.slice(0, 8)}...'), not an env-var name. ` +
        `Store only the variable name (e.g. 'GITHUB_TOKEN').`
      );
    }
  }
  if (!VALID_ENV_NAME.test(candidate)) {
    throw new TypeError(
      `[render] server '${serverId}': '${candidate}' is not a valid env-var name ` +
      `(expected ALL_CAPS_IDENTIFIER).`
    );
  }
}

// -- Source -> command/args expansion -----------------------------------------

/**
 * Expands a registry source string into { command, args, url } for the target
 * transport.
 *
 * Supported prefixes:
 *   "npm:<pkg>"  -> npx -y <pkg>
 *   "cmd:<raw>"  -> raw string split by whitespace (first token = command)
 *   "<other>"    -> direct executable path (stdio) or URL (http)
 *
 * For streamable-http the source is a URL base; command/args are empty and the
 * caller should use url.
 *
 * @param {string} source
 * @param {string} transport
 * @returns {{ command: string, args: string[], url: string }}
 */
export function expandSource(source, transport) {
  if (transport === 'streamable-http') {
    return { command: '', args: [], url: source };
  }
  if (source.startsWith('npm:')) {
    return { command: 'npx', args: ['-y', source.slice(4)], url: '' };
  }
  if (source.startsWith('cmd:')) {
    const parts = source.slice(4).trim().split(/\s+/);
    return { command: parts[0] ?? '', args: parts.slice(1), url: '' };
  }
  return { command: source, args: [], url: '' };
}

// -- Env-ref builder ----------------------------------------------------------

/**
 * Builds an env object where every key maps to the ${env:<KEY>} reference
 * string. Throws if any name looks like a literal value (fail-closed, s8).
 *
 * @param {string[]} secretNames  From manifest entry referencedSecrets.
 * @param {string}   serverId     For error context.
 * @returns {Record<string, string>}
 */
export function buildEnvRefs(secretNames, serverId) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const name of secretNames) {
    assertSecretName(name, serverId);
    env[name] = `\${env:${name}}`;
  }
  return env;
}

// -- Host-filter --------------------------------------------------------------

/**
 * Filters a manifest's servers to those the given host is allowed to see and
 * that are not disabled. Cross-references with the registry to obtain source,
 * transport, allowedHosts, and display name.
 *
 * Servers in the manifest but absent from the registry are SKIPPED (reported
 * in skipped) - never silently included (no false-pass, constitution s8).
 *
 * @param {ManifestEntry[]}  manifestServers  From readManifest().servers.
 * @param {RegistryEntry[]}  registry         From loadRegistry().
 * @param {string}           host             Canonical host id (e.g. "claude-code",
 *                                            "cursor", "codex", "antigravity").
 * @returns {{ entries: ResolvedRenderEntry[], skipped: string[] }}
 */
export function filterForHost(manifestServers, registry, host) {
  const registryMap = new Map(registry.map((e) => [e.id, e]));
  /** @type {ResolvedRenderEntry[]} */
  const entries = [];
  const skipped = [];

  for (const manifestEntry of manifestServers) {
    if (manifestEntry.disabled === true) {
      skipped.push(manifestEntry.id);
      continue;
    }

    const regEntry = registryMap.get(manifestEntry.id);
    if (!regEntry) {
      // Not in registry -> cannot verify allowedHosts - skip (never a false-pass).
      skipped.push(manifestEntry.id);
      continue;
    }

    // allowedHosts: '*' means any host; otherwise the host must be listed.
    const allowed = regEntry.allowedHosts;
    if (!allowed.includes('*') && !allowed.includes(host)) {
      skipped.push(manifestEntry.id);
      continue;
    }

    const { command, args, url } = expandSource(regEntry.source, regEntry.transport);

    // Effective secret names: manifest override wins if present, else registry.
    const secretNames =
      Array.isArray(manifestEntry.referencedSecrets) && manifestEntry.referencedSecrets.length > 0
        ? manifestEntry.referencedSecrets
        : regEntry.requiredSecrets;

    const env = buildEnvRefs(secretNames, manifestEntry.id);

    entries.push({
      id: manifestEntry.id,
      displayName: regEntry.displayName,
      command,
      args,
      transport: regEntry.transport,
      url,
      env,
      allowedTools: Array.isArray(manifestEntry.allowedTools) ? manifestEntry.allowedTools : [],
      mode: manifestEntry.mode ?? 'read-only',
    });
  }

  return { entries, skipped };
}