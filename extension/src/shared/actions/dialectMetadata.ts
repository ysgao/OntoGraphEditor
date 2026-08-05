import type { ProjectMetadata } from './types';

export const EN_US_REFSET = '900000000000509007';
export const EN_GB_REFSET = '900000000000508004';
const INTERNATIONAL_DEFAULT_LANGUAGE = 'en';

const INTERNATIONAL_DIALECTS: Record<string, string> = {
  [EN_US_REFSET]: 'en-us',
  [EN_GB_REFSET]: 'en-gb',
};
const INTERNATIONAL_DIALECT_DEFAULTS: Record<string, string> = {
  [EN_US_REFSET]: 'true',
  [EN_GB_REFSET]: 'true',
};
const INTERNATIONAL_READONLY_DIALECTS: Record<string, string> = {};

export interface DialectMetadata {
  isExtension: boolean;
  useInternationalLanguageRefsets: boolean;
  dialects: Record<string, string>;
  dialectDefaults: Record<string, string>;
  readOnlyDialects: Record<string, string>;
  defaultLanguage: string;
}

const INTERNATIONAL_DIALECT_METADATA: DialectMetadata = {
  isExtension: false,
  useInternationalLanguageRefsets: false,
  dialects: INTERNATIONAL_DIALECTS,
  dialectDefaults: INTERNATIONAL_DIALECT_DEFAULTS,
  readOnlyDialects: INTERNATIONAL_READONLY_DIALECTS,
  defaultLanguage: INTERNATIONAL_DEFAULT_LANGUAGE,
};

/**
 * Ports the dialect-relevant subset of metadataService.js's setExtensionMetadata()
 * (apps/authoring-ui-vscode/app/shared/metadata-service/metadataService.js, ~lines 254-461) —
 * `requiredLanguageRefset.<lang>` dotted keys, the `requiredLanguageRefsets`/
 * `optionalLanguageRefsets` array forms, and the `useInternationalLanguageRefsets` override.
 * Deliberately drops everything else that function parses (module list, acceptLanguageMap,
 * case-significance defaults, additionalFSNs) — unused by description/acceptability creation.
 *
 * Like the real app, "extension metadata" only kicks in when `defaultModuleId` is present on
 * the project's metadata at all (metadataService.js line 257) — otherwise this project is
 * International Edition and gets the hardcoded en-us/en-gb dialects.
 */
export function parseDialectMetadata(metadata: ProjectMetadata | undefined): DialectMetadata {
  if (!metadata || !('defaultModuleId' in metadata) || metadata.defaultModuleId == null) {
    return INTERNATIONAL_DIALECT_METADATA;
  }

  const dialects: Record<string, string> = { [EN_US_REFSET]: 'en-us' };
  const dialectDefaults: Record<string, string> = {};
  const readOnlyDialects: Record<string, string> = {};
  const defaultLanguages: string[] = [];

  for (const key of Object.keys(metadata)) {
    const match = key.match(/^requiredLanguageRefset\.(.+)/);
    if (match) {
      const lang = match[1];
      dialects[String(metadata[key])] = lang;
      if (defaultLanguages.length === 0) {
        defaultLanguages.push(lang);
      }
    }
  }

  const requiredLanguageRefsets = metadata.requiredLanguageRefsets;
  if (Array.isArray(requiredLanguageRefsets)) {
    for (const entry of requiredLanguageRefsets) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      let langCode: string | null = null;
      let refsetId: string | null = null;
      for (const [entryKey, entryValue] of Object.entries(entry)) {
        if (entryKey.length === 2) {
          langCode = entryKey;
          refsetId = String(entryValue);
        }
      }
      if (!langCode || !refsetId) {
        continue;
      }
      const dialectName = entry.dialectName;
      dialects[refsetId] = typeof dialectName === 'string' ? dialectName : langCode;

      const defaultFlag = entry.default;
      if (defaultFlag === 'true' && !defaultLanguages.includes(langCode)) {
        defaultLanguages.push(langCode);
      }
      if (defaultFlag !== null && defaultFlag !== undefined) {
        dialectDefaults[refsetId] = String(defaultFlag);
      }

      const readOnlyFlag = entry.readOnly;
      if (readOnlyFlag !== null && readOnlyFlag !== undefined) {
        readOnlyDialects[refsetId] = String(readOnlyFlag);
      }
    }
  }

  const optionalLanguageRefsets = metadata.optionalLanguageRefsets;
  if (Array.isArray(optionalLanguageRefsets)) {
    for (const entry of optionalLanguageRefsets) {
      if (entry && typeof entry === 'object' && 'refsetId' in entry) {
        dialects[String(entry.refsetId)] = String(entry.language ?? '');
      }
    }
  }

  const useInternationalLanguageRefsets = Boolean(metadata.useInternationalLanguageRefsets);

  return {
    isExtension: true,
    useInternationalLanguageRefsets,
    dialects: useInternationalLanguageRefsets ? INTERNATIONAL_DIALECTS : dialects,
    dialectDefaults: useInternationalLanguageRefsets ? INTERNATIONAL_DIALECT_DEFAULTS : dialectDefaults,
    readOnlyDialects,
    // metadataService.js's own getDefaultLanguageForModuleId() has a latent type bug here: for
    // extension modules it returns the whole `defaultLanguages` array (always truthy, even when
    // empty) rather than its first element, only working by accident via string-coercion for the
    // common single-default-language case. We take the first element directly instead of
    // reproducing that — a deliberate, documented correction, not silent drift.
    defaultLanguage: defaultLanguages[0] ?? INTERNATIONAL_DEFAULT_LANGUAGE,
  };
}

/**
 * Ports componentAuthoringUtil.js's getNewAcceptabilityMap(moduleId, defaultValue, initial, lang)
 * (~lines 38-70). The real function's final two `else if`/`else` branches are mutually exclusive
 * negations of each other, making the last `else` dead code — collapsed here into the two
 * reachable outcomes: extension-and-not-initial (Preferred if lang matches, Acceptable if the
 * module's default language matches, else omitted), and everything else (defaultValue if lang
 * matches, else omitted).
 */
export function buildAcceptabilityMap(
  meta: DialectMetadata,
  defaultValue: 'PREFERRED' | 'ACCEPTABLE',
  initial: boolean,
  lang: string
): Record<string, string> {
  const acceptabilityMap: Record<string, string> = {};

  for (const refsetId of Object.keys(meta.dialects)) {
    const dialectLabel = meta.dialects[refsetId];
    if (meta.isExtension && !initial) {
      if (dialectLabel.includes(lang)) {
        acceptabilityMap[refsetId] = 'PREFERRED';
      } else if (dialectLabel.includes(meta.defaultLanguage)) {
        acceptabilityMap[refsetId] = 'ACCEPTABLE';
      }
    } else if (dialectLabel.includes(lang)) {
      acceptabilityMap[refsetId] = defaultValue;
    }

    if (meta.dialectDefaults[refsetId] === 'false' && !initial) {
      delete acceptabilityMap[refsetId];
    }
    if (meta.readOnlyDialects[refsetId] === 'true') {
      delete acceptabilityMap[refsetId];
    }
  }

  return acceptabilityMap;
}

/**
 * Ports componentAuthoringUtil.js's getNewFsn(moduleId, initial, language) (~lines 106-122). The
 * FSN's language is always forced to the international default ('en') regardless of extension —
 * getNewFsn calls getDefaultLanguageForModuleId(null), and a null moduleId never matches an
 * extension module, so it always takes the international branch.
 */
export function buildFsnAcceptabilityMap(meta: DialectMetadata, initial: boolean): Record<string, string> {
  if (meta.isExtension && !meta.useInternationalLanguageRefsets) {
    return { [EN_US_REFSET]: 'PREFERRED' };
  }
  return buildAcceptabilityMap(meta, 'PREFERRED', initial, INTERNATIONAL_DEFAULT_LANGUAGE);
}
