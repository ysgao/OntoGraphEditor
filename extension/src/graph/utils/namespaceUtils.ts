import type { OntologyModel } from '../model/OntologyModel.js';

const LOCAL_NAME_REGEX = /^[A-Za-z0-9_][A-Za-z0-9_\-\.]*$/;

/**
 * Extract the default prefix namespace from OWL Functional Syntax raw content.
 * Looks for `Prefix(:=<IRI>)` — the empty-name prefix that represents the
 * default namespace for unqualified entities in the ontology.
 * Returns the IRI string (e.g. "http://snomed.info/id/") or undefined.
 */
export function extractDefaultPrefix(rawContent: string): string | undefined {
  // Match Prefix(:=<IRI>) with optional whitespace around tokens
  const match = /^Prefix\s*\(\s*:\s*=\s*<([^>]+)>\s*\)/m.exec(rawContent);
  return match?.[1];
}

/**
 * Resolve namespace in priority order:
 * 1. configNamespace setting (non-empty)
 * 2. Default prefix `Prefix(:=<IRI>)` from rawContent (ends with # or /)
 * 3. model.metadata.iri if it ends with # or / (toy ontologies serialized by OntoGraph)
 * 4. undefined (caller must warn user)
 */
export function resolveNamespace(
  model: OntologyModel,
  configNamespace: string | undefined,
): string | undefined {
  if (configNamespace && configNamespace.length > 0) {
    // Apply the same trailing-separator guard used by the fallback paths below.
    // Returning a namespace that doesn't end with '#' or '/' would cause
    // constructIri to throw inside the validateInput callback.
    if (configNamespace.endsWith('#') || configNamespace.endsWith('/')) {
      return configNamespace;
    }
  }
  const defaultPrefix = extractDefaultPrefix(model.rawContent);
  if (defaultPrefix && (defaultPrefix.endsWith('#') || defaultPrefix.endsWith('/'))) {
    return defaultPrefix;
  }
  const ontIri = model.metadata.iri;
  if (ontIri && (ontIri.endsWith('#') || ontIri.endsWith('/'))) {
    return ontIri;
  }
  return undefined;
}

export type LocalNameValidation = true | { valid: false; reason: string };

/** Validate a local name against the IRI-safe pattern. */
export function validateLocalName(name: string): LocalNameValidation {
  if (!name || name.length === 0) {
    return { valid: false, reason: 'Local name must not be empty.' };
  }
  if (!LOCAL_NAME_REGEX.test(name)) {
    return {
      valid: false,
      reason: `Local name "${name}" contains invalid characters. Use letters, digits, underscore, hyphen, or dot.`,
    };
  }
  return true;
}

/**
 * Construct a full IRI from namespace + localName.
 * Throws if namespace does not end with '#' or '/'.
 */
export function constructIri(namespace: string, localName: string): string {
  if (!namespace || (!namespace.endsWith('#') && !namespace.endsWith('/'))) {
    throw new Error(
      `Namespace must end with '#' or '/' but got: "${namespace}"`,
    );
  }
  return namespace + localName;
}

/** Minimal check for absolute IRI syntax (has scheme, no spaces). */
export function isValidAbsoluteIri(iri: string): boolean {
  if (!iri || iri.length === 0) { return false; }
  if (/\s/.test(iri)) { return false; }
  // Must have a scheme followed by ':'
  return /^[A-Za-z][A-Za-z0-9+\-.]*:/.test(iri);
}
