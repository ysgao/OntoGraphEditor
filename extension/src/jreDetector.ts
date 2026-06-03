import { spawnSync } from 'child_process';

export interface JreDetectionResult {
  found: boolean;
  major: number | undefined;
  raw: string | undefined;
  compatible: boolean;
  error: string | undefined;
}

export const MINIMUM_JRE_MAJOR = 21;
export const JRE_DOWNLOAD_URL = 'https://adoptium.net/temurin/releases/?version=21';

export class JreDetector {
  detect(): JreDetectionResult {
    try {
      const result = spawnSync('java', ['-version'], {
        encoding: 'utf8',
        timeout: 3000,
      });

      if (result.error) {
        return { found: false, major: undefined, raw: undefined, compatible: false, error: result.error.message };
      }

      // java -version writes to stderr
      const raw = (result.stderr || result.stdout || '').trim();
      if (!raw) {
        return { found: false, major: undefined, raw: undefined, compatible: false, error: 'No version output' };
      }

      // Matches both:
      //   java version "1.8.0_292"  → major = 1 (Java 8, incompatible)
      //   openjdk version "21.0.1"  → major = 21
      const match = raw.match(/version "(\d+)/);
      const major = match ? parseInt(match[1], 10) : undefined;
      const compatible = major !== undefined && major >= MINIMUM_JRE_MAJOR;

      return { found: true, major, raw, compatible, error: undefined };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { found: false, major: undefined, raw: undefined, compatible: false, error: msg };
    }
  }
}
