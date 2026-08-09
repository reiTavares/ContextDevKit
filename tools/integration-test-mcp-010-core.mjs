/** MCP configuration-audit pure core tests. */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reporter } from './it-helpers.mjs';

const kitRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(kitRoot, 'templates/contextkit/tools/scripts/mcp-audit-core.mjs');
const { computeFlags, buildReport, hasWriteTools, secretReferenceNames } = await import(pathToFileURL(source).href);
const report = reporter();

hasWriteTools({ tools: ['read_file'] }) ? report.bad('read-only tools classified as write') : report.ok('read-only tools stay read-only');
hasWriteTools({ tools: ['read_file', 'write_file'] }) ? report.ok('write tool is detected') : report.bad('write tool was missed');
const secretNames = secretReferenceNames({ envKeys: ['GITHUB_TOKEN', 'PORT', 'API_KEY'] });
secretNames.length === 2 && !secretNames.includes('PORT')
  ? report.ok('secret key names are detected without values')
  : report.bad(`secret key classification drifted: ${JSON.stringify(secretNames)}`);

const servers = [
  { name: 'writer', transport: 'stdio', version: '1.0.0', tools: ['write_file'], envKeys: ['WRITE_TOKEN'] },
  { name: 'reader', transport: 'http', tools: ['read_file'], envKeys: [] },
];
const flags = computeFlags(servers);
for (const code of ['HAS_WRITE_TOOLS', 'UNPINNED_SERVER', 'SECRET_REFERENCE']) {
  flags.some((flag) => flag.code === code) ? report.ok(`${code} is reported`) : report.bad(`${code} is missing`);
}
!flags.some((flag) => ['UNUSED_SERVER', 'HOST_DRIFT'].includes(flag.code))
  ? report.ok('receipt-derived flags are physically absent')
  : report.bad('receipt-derived flags remain active');

const built = buildReport({ servers, configFound: true });
built.observationStatus === 'configuration-only' && !Object.hasOwn(built, 'receipts')
  ? report.ok('report is explicitly configuration-only')
  : report.bad(`report authority is ambiguous: ${JSON.stringify(built)}`);
JSON.stringify(built).includes('WRITE_TOKEN') && !JSON.stringify(built).includes('secret-value')
  ? report.ok('report carries secret key names only')
  : report.bad('report secret boundary failed');

report.finish('MCP configuration audit core');
