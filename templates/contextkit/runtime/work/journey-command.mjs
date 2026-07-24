/**
 * Renders one host-neutral journey command descriptor as an executable command.
 * The advisory surface, Lifecycle Map, and `work next` share this projection.
 *
 * @param {object|null} command - Journey stage command descriptor.
 * @returns {string|null} Executable command text, or null when unavailable.
 */
export function renderJourneyCommand(command) {
  if (!command || typeof command !== 'object') return null;
  if (command.work) {
    return `node contextkit/tools/scripts/work.mjs ${command.work}${command.args ? ` ${command.args}` : ''}`;
  }
  if (command.slash) return `/${command.slash}${command.args ? ` ${command.args}` : ''}`;
  if (command.tool) {
    return `node contextkit/tools/scripts/${command.tool}${command.args ? ` ${command.args}` : ''}`;
  }
  if (command.shell) return command.shell;
  return null;
}
