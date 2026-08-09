/**
 * MCP install propagation smoke test.
 *
 * WF0014 added source artifacts outside the traditional runtime/tools engine
 * roots. A real install must propagate them so a target project has both the
 * MCP catalog and the ContextDevKit MCP server.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { KIT, installFixture, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const fx = installFixture(rep);

try {
  const installedCatalog = join(fx.proj, 'contextkit', 'mcp', 'registry.json');
  const installedProfile = join(fx.proj, 'contextkit', 'mcp', 'profiles', 'github-readonly.json');
  const installedServer = join(fx.proj, 'contextkit', 'mcp-server', 'server.mjs');

  existsSync(installedCatalog)
    ? rep.ok('fresh install includes contextkit/mcp/registry.json')
    : rep.bad('fresh install missing contextkit/mcp/registry.json');

  existsSync(installedProfile)
    ? rep.ok('fresh install includes MCP profiles')
    : rep.bad('fresh install missing MCP profiles');

  existsSync(installedServer)
    ? rep.ok('fresh install includes contextkit/mcp-server/server.mjs')
    : rep.bad('fresh install missing contextkit/mcp-server/server.mjs');

  const manifestPath = join(fx.proj, 'contextkit', 'mcp', 'project-manifest.json');
  const manifestBody = JSON.stringify({
    version: 1,
    servers: [{
      id: 'contextdevkit',
      mode: 'read-only',
      referencedSecrets: [],
      allowedTools: ['get_project_state'],
    }],
  }, null, 2) + '\n';

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifestBody, 'utf-8');

  const update = run([join(KIT, 'install.mjs'), '--target', fx.proj, '--update', '--yes']);
  update.status === 0
    ? rep.ok('update exits 0')
    : rep.bad(`update failed (status ${update.status}): ${update.stderr?.slice(0, 200)}`);

  const afterUpdate = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : null;
  afterUpdate === manifestBody
    ? rep.ok('project MCP manifest survives update byte-identical')
    : rep.bad('project MCP manifest changed or disappeared during update');

  const initialize = run([installedServer], {
    cwd: fx.proj,
    input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
  });
  initialize.stdout.includes('"name":"contextdevkit"')
    ? rep.ok('installed MCP server responds to initialize')
    : rep.bad('installed MCP server did not initialize as contextdevkit');
} finally {
  fx.cleanup();
}

rep.finish('MCP install propagation');
