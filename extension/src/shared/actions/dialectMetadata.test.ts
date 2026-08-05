import { describe, expect, it } from 'vitest';
import { EN_GB_REFSET, EN_US_REFSET, buildAcceptabilityMap, buildFsnAcceptabilityMap, parseDialectMetadata } from './dialectMetadata';

describe('parseDialectMetadata', () => {
  it('treats a project with no metadata.defaultModuleId as International Edition', () => {
    const meta = parseDialectMetadata(undefined);
    expect(meta.isExtension).toBe(false);
    expect(meta.dialects).toEqual({ [EN_US_REFSET]: 'en-us', [EN_GB_REFSET]: 'en-gb' });
  });

  it('resolves to international dialects when useInternationalLanguageRefsets is set', () => {
    const meta = parseDialectMetadata({ defaultModuleId: '999000011000000103', useInternationalLanguageRefsets: true });
    expect(meta.isExtension).toBe(true);
    expect(meta.useInternationalLanguageRefsets).toBe(true);
    expect(meta.dialects).toEqual({ [EN_US_REFSET]: 'en-us', [EN_GB_REFSET]: 'en-gb' });
  });

  it('parses requiredLanguageRefset.<lang> dotted keys into the dialect map', () => {
    const meta = parseDialectMetadata({
      defaultModuleId: '45991000052106',
      'requiredLanguageRefset.sv': '46011000052107',
    });
    expect(meta.isExtension).toBe(true);
    expect(meta.dialects).toEqual({ [EN_US_REFSET]: 'en-us', '46011000052107': 'sv' });
    expect(meta.defaultLanguage).toBe('sv');
  });

  it('parses the requiredLanguageRefsets array form, including default/readOnly flags', () => {
    const meta = parseDialectMetadata({
      defaultModuleId: '554461000005103',
      requiredLanguageRefsets: [{ da: '554471000005108', dialectName: 'da', default: 'true', readOnly: 'false' }],
    });
    expect(meta.dialects['554471000005108']).toBe('da');
    expect(meta.dialectDefaults['554471000005108']).toBe('true');
    expect(meta.defaultLanguage).toBe('da');
  });
});

describe('buildAcceptabilityMap', () => {
  const international = parseDialectMetadata(undefined);

  it('sets defaultValue for a matching lang, omits the rest (International Edition)', () => {
    expect(buildAcceptabilityMap(international, 'PREFERRED', true, 'en')).toEqual({
      [EN_US_REFSET]: 'PREFERRED',
      [EN_GB_REFSET]: 'PREFERRED',
    });
  });

  it('omits a dialect flagged readOnly', () => {
    const meta = parseDialectMetadata({
      defaultModuleId: '45991000052106',
      requiredLanguageRefsets: [{ en: '900000000000509007', readOnly: 'true' }],
    });
    expect(buildAcceptabilityMap(meta, 'PREFERRED', true, 'en')).toEqual({});
  });

  it('for an extension edit (not initial), prefers the matching lang and marks the default language Acceptable', () => {
    const meta = parseDialectMetadata({
      defaultModuleId: '45991000052106',
      'requiredLanguageRefset.sv': '46011000052107',
    });
    // dialects: en-us (base seed) + sv; lang being added is 'sv', module default language is also 'sv'
    expect(buildAcceptabilityMap(meta, 'ACCEPTABLE', false, 'sv')).toEqual({
      '46011000052107': 'PREFERRED',
    });
  });
});

describe('buildFsnAcceptabilityMap', () => {
  it('is Preferred in both en-us/en-gb for International Edition', () => {
    const international = parseDialectMetadata(undefined);
    expect(buildFsnAcceptabilityMap(international, true)).toEqual({
      [EN_US_REFSET]: 'PREFERRED',
      [EN_GB_REFSET]: 'PREFERRED',
    });
  });

  it('is Preferred in both en-us/en-gb when the extension uses international language refsets', () => {
    const meta = parseDialectMetadata({ defaultModuleId: '999000011000000103', useInternationalLanguageRefsets: true });
    expect(buildFsnAcceptabilityMap(meta, true)).toEqual({
      [EN_US_REFSET]: 'PREFERRED',
      [EN_GB_REFSET]: 'PREFERRED',
    });
  });

  it('is en-US-only Preferred for an extension with its own dialects (no GB key at all)', () => {
    const meta = parseDialectMetadata({
      defaultModuleId: '45991000052106',
      'requiredLanguageRefset.sv': '46011000052107',
    });
    expect(buildFsnAcceptabilityMap(meta, true)).toEqual({ [EN_US_REFSET]: 'PREFERRED' });
  });
});
