/**
 * Contract: JRE Detection Service
 * Feature: 003-extension-publish
 *
 * Defines the interface for detecting a compatible Java Runtime Environment
 * at extension activation time. Implementation lives at:
 *   extension/src/jreDetector.ts
 */

export interface JreDetectionResult {
  /** Whether a `java` executable was found on PATH */
  found: boolean;
  /** Parsed major version number, e.g. 21 for "openjdk version \"21.0.1\"" */
  major: number | undefined;
  /** Raw version string captured from java -version stderr output */
  raw: string | undefined;
  /** true iff found === true && major >= 21 */
  compatible: boolean;
  /** Process spawn error message if java could not be executed */
  error: string | undefined;
}

export interface IJreDetector {
  /**
   * Synchronously checks for a Java executable on the system PATH.
   * Must not throw — all errors captured in result.error.
   * Must complete in under 3 seconds (SC-004).
   */
  detect(): JreDetectionResult;
}

/** Minimum required Java major version */
export const MINIMUM_JRE_MAJOR = 21;

/** URL surfaced to users when JRE is absent or incompatible */
export const JRE_DOWNLOAD_URL = 'https://adoptium.net/temurin/releases/?version=21';
