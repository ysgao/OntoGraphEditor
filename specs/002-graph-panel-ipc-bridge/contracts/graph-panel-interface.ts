/**
 * Cross-extension command contracts for the IPC bridge.
 * These commands are the only coupling between OntoGraph Editor and OntoGraph-lite.
 */

/**
 * Commands registered by OntoGraph Editor that OntoGraph-lite may call.
 */
export const ONTOGRAPH_EDITOR_COMMANDS = {
  /** Central IPC router. Accepts IpcMessage, routes to the appropriate panel. */
  IPC_ROUTE: 'ontographEditor.ipcRoute',
  /** Opens OntoGraph-lite graph panel (delegates to ontograph.openGraph). */
  OPEN_GRAPH: 'ontographEditor.openGraph',
} as const;

/**
 * Commands registered by OntoGraph-lite that OntoGraph Editor calls.
 */
export const ONTOGRAPH_LITE_COMMANDS = {
  /** Focus the graph view on a specific entity IRI. Creates panel if needed. */
  FOCUS_ENTITY: 'ontograph.focusEntity',
  /** Opens the graph panel (existing command, no arguments). */
  OPEN_GRAPH: 'ontograph.openGraph',
} as const;

/**
 * SNOMED CT IRI utilities shared between both extensions.
 */
export const SNOMED_IRI_BASE = 'http://snomed.info/id/';

export function sctidToIri(sctid: string): string {
  return `${SNOMED_IRI_BASE}${sctid}`;
}

export function iriToSctid(iri: string): string | undefined {
  const match = /\/id\/(\d+)$/.exec(iri);
  return match?.[1];
}
