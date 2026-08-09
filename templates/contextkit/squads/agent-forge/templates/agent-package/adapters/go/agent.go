// GENERATED in Fase 5 by packager. Go runtime adapter for this Agent Package.
// Implements the common AgentRuntime interface; reads ../../manifest.yaml as the
// source of truth. Switching provider = editing the manifest, not this file.
package agent

import "errors"

// Runtime is the common interface every adapter implements (invoke / invokeStream /
// preflight / estimate / onEvent). See the package README for the full contract.

// CreateAgent builds the runtime from the package manifest.
func CreateAgent(manifestPath string) error {
	return errors.New("agent-forge: Go adapter is a Fase 5 stub — not yet generated")
}
