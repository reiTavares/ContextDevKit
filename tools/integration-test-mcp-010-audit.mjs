/** MCP configuration-audit I/O tests. */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { reporter } from './it-helpers.mjs';

const kitRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(kitRoot, 'templates/contextkit/tools/scripts/mcp-audit.mjs');
const { runAudit } = await import(pathToFileURL(source).href);
const report = reporter();

const root = resolve(tmpdir(), `mcp-audit-v4-${Date.now()}`);
const settingsDirectory = join(root, '.claude');
mkdirSync(settingsDirectory, { recursive: true });
writeFileSync(join(settingsDirectory, 'settings.json'), JSON.stringify({
  mcpServers: {
    writer: { transport: 'stdio', version: '1.0.0', tools: ['write_file'], env: { API_TOKEN: 'secret-value' } },
    reader: { transport: 'streamable-http', tools: ['read_file'], env: {} },
  },
}), 'utf8');

const audit = runAudit(root);
audit.configFound && audit.activeServers.length === 2
  ? report.ok('current MCP configuration is read')
  : report.bad(`configuration read failed: ${JSON.stringify(audit)}`);
audit.observationStatus === 'configuration-only' && !Object.hasOwn(audit, 'receipts')
  ? report.ok('audit does not invent historical usage')
  : report.bad('audit retained a receipt sidecar contract');
const serialized = JSON.stringify(audit);
serialized.includes('API_TOKEN') && !serialized.includes('secret-value')
  ? report.ok('environment values are removed at the read boundary')
  : report.bad('secret metadata boundary failed');
audit.flags.some((flag) => flag.code === 'HAS_WRITE_TOOLS')
  ? report.ok('write-capable server is surfaced')
  : report.bad('write-capable server was not surfaced');

const absent = runAudit(resolve(tmpdir(), `mcp-audit-v4-absent-${Date.now()}`));
!absent.configFound && absent.observationStatus === 'unavailable' && absent.flags.length === 0
  ? report.ok('missing config is unavailable, not a false pass')
  : report.bad(`missing config handling drifted: ${JSON.stringify(absent)}`);

rmSync(root, { recursive: true, force: true });
report.finish('MCP configuration audit I/O');
