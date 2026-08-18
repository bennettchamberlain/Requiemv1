import {
  ACQUISITION_METHODS,
  MAX_ARRAY_TERMS,
  MAX_DIMENSION_MM,
  MAX_MASS_G,
  PhysicalPropertyError,
  normalizeAcquisitionMethod,
  normalizeColorHex,
  normalizeColors,
  normalizeComposition,
  normalizeMaterials,
  normalizePhysicalProperties,
  normalizeUnitSystem,
  parseDimensions,
  parseLengthMm,
  parseMassG,
  parseVolumeMl,
} from '../physicalProperties';

describe('parseLengthMm', () => {
  it('treats a bare number as already canonical', () => {
    expect(parseLengthMm(120)).toBe(120);
    expect(parseLengthMm('120')).toBe(120);
  });

  it('converts every accepted length unit exactly', () => {
    expect(parseLengthMm('1 in')).toBe(25.4);
    expect(parseLengthMm('1"')).toBe(25.4);
    expect(parseLengthMm('2.5 cm')).toBe(25);
    expect(parseLengthMm('1 m')).toBe(1000);
    expect(parseLengthMm('1 ft')).toBe(304.8);
    expect(parseLengthMm('1 yard')).toBe(914.4);
  });

  it('sums the multi-term form humans and vision models write', () => {
    expect(parseLengthMm('5 ft 11 in')).toBe(1803.4);
    expect(parseMassG('1 kg 250 g')).toBe(1250);
  });

  it('reads hedged and thousands-separated values', () => {
    expect(parseLengthMm('about 30 cm')).toBe(300);
    expect(parseMassG('1,200 g')).toBe(1200);
    expect(parseMassG('1,5 kg')).toBe(1500);
  });

  it('returns null for absent and explicitly-unknown values', () => {
    expect(parseLengthMm(null)).toBeNull();
    expect(parseLengthMm(undefined)).toBeNull();
    expect(parseLengthMm('')).toBeNull();
    expect(parseLengthMm('unknown')).toBeNull();
  });

  it('refuses an unknown unit rather than guessing', () => {
    expect(() => parseLengthMm('12 furlongs')).toThrow(PhysicalPropertyError);
    expect(() => parseMassG('12 in')).toThrow(/unknown mass unit/);
  });

  it('refuses text it only partly understood', () => {
    // The dangerous alternative is storing 12 and silently dropping the rest.
    expect(() => parseLengthMm('12 cm wide')).toThrow(/could not interpret/);
    expect(() => parseLengthMm('12 cm wide by 8 deep')).toThrow(PhysicalPropertyError);
  });

  it('refuses zero and negatives, which mean unmeasured rather than measured', () => {
    expect(() => parseLengthMm(0)).toThrow(/greater than zero/);
    expect(() => parseLengthMm('-3 cm')).toThrow(/greater than zero/);
  });

  it('refuses values past the sanity bound, which are unit mix-ups', () => {
    expect(() => parseLengthMm(MAX_DIMENSION_MM + 1)).toThrow(/exceeds the maximum/);
    expect(() => parseMassG(`${MAX_MASS_G + 1}`)).toThrow(/exceeds the maximum/);
  });

  it('rounds to the scale of the column so a read-back is identical', () => {
    expect(parseLengthMm('1.00004 mm')).toBe(1);
    expect(parseVolumeMl('1 gal')).toBe(3785.412);
  });
});

describe('parseVolumeMl', () => {
  it('converts US customary fluid units', () => {
    expect(parseVolumeMl('1 l')).toBe(1000);
    expect(parseVolumeMl('16 fl oz')).toBe(473.176);
    expect(parseVolumeMl('1 cup')).toBe(236.588);
  });
});

describe('unit discipline for machine writers', () => {
  // The dangerous direction is LOW: the sanity bounds only guard the high side,
  // so an unlabelled 30 for a 30 cm object stores 30 mm and passes every CHECK.
  it('refuses a bare number when the caller cannot vouch for the unit', () => {
    expect(() => parseLengthMm('30', 'lengthMm', { requireUnit: true })).toThrow(/no unit/);
    expect(() => parseLengthMm(30, 'lengthMm', { requireUnit: true })).toThrow(/bare number/);
    expect(() => parseMassG('1.2', 'massG', { requireUnit: true })).toThrow(/no unit/);
  });

  it('still accepts anything that states its unit', () => {
    expect(parseLengthMm('30 cm', 'lengthMm', { requireUnit: true })).toBe(300);
    expect(parseMassG('1.2 kg', 'massG', { requireUnit: true })).toBe(1200);
  });

  it('keeps the named canonical fields lenient — the field name IS the unit', () => {
    expect(parseLengthMm(30)).toBe(30);
  });

  it('propagates the requirement through a whole patch', () => {
    expect(() => normalizePhysicalProperties({ massG: '2' }, { requireUnit: true })).toThrow(/no unit/);
    expect(normalizePhysicalProperties({ massG: '2 kg' }, { requireUnit: true })).toEqual({ massG: 2000 });
  });
});

describe('parseDimensions', () => {
  it('applies a trailing unit to every term', () => {
    expect(parseDimensions('12 x 8 x 2 in')).toEqual({
      lengthMm: 304.8,
      widthMm: 203.2,
      heightMm: 50.8,
    });
  });

  it('accepts per-term units and the multiplication sign', () => {
    expect(parseDimensions('10" x 4"')).toEqual({ lengthMm: 254, widthMm: 101.6, heightMm: null });
    expect(parseDimensions('30×20cm')).toEqual({ lengthMm: 300, widthMm: 200, heightMm: null });
  });

  it('always demands a unit — the shorthand is for text, and text lies', () => {
    // '30 x 20 x 5' from a person or a model means centimetres far more often
    // than millimetres; read as canonical it becomes a 30 mm desk.
    expect(() => parseDimensions('30 x 20 x 5')).toThrow(/no unit/);
    expect(() => normalizePhysicalProperties({ dimensions: '30 x 20 x 5' })).toThrow(/no unit/);
  });

  it('leaves everything unknown for absent input', () => {
    expect(parseDimensions(null)).toEqual({ lengthMm: null, widthMm: null, heightMm: null });
  });

  it('refuses more terms than an object has axes', () => {
    expect(() => parseDimensions('1 x 2 x 3 x 4 cm')).toThrow(/at most three terms/);
  });
});

describe('normalizeColors / normalizeMaterials', () => {
  it('lowercases, trims punctuation and deduplicates, dominant first', () => {
    expect(normalizeColors([' Blue ', 'blue.', 'Off  White'])).toEqual(['blue', 'off white']);
  });

  it('accepts the separated string a model or a form field produces', () => {
    expect(normalizeMaterials('Leather, brass and cotton')).toEqual(['leather', 'brass', 'cotton']);
  });

  it('collapses an all-empty list to null, which is how the schema spells none', () => {
    // The empty array would fail `cardinality(...) BETWEEN 1 AND 12`.
    expect(normalizeColors([])).toBeNull();
    expect(normalizeColors(['  ', '...'])).toBeNull();
    expect(normalizeColors(null)).toBeNull();
  });

  it('refuses a list long enough to be a description', () => {
    const tooMany = Array.from({ length: MAX_ARRAY_TERMS + 1 }, (_, index) => `color${index}`);

    expect(() => normalizeColors(tooMany)).toThrow(/at most 12 terms/);
  });
});

describe('normalizeColorHex', () => {
  it('canonicalizes to lowercase #rrggbb', () => {
    expect(normalizeColorHex('#FFAA00')).toBe('#ffaa00');
    expect(normalizeColorHex('ffaa00')).toBe('#ffaa00');
    expect(normalizeColorHex('#F0C')).toBe('#ff00cc');
  });

  it('refuses anything that is not a hex colour', () => {
    expect(normalizeColorHex(null)).toBeNull();
    expect(() => normalizeColorHex('blue')).toThrow(PhysicalPropertyError);
  });
});

describe('normalizeComposition', () => {
  it('keeps fractions as fractions', () => {
    expect(normalizeComposition({ Cotton: 0.8, elastane: 0.2 })).toEqual({ cotton: 0.8, elastane: 0.2 });
  });

  it('converts the percentages printed on every garment label', () => {
    expect(normalizeComposition({ cotton: 80, polyester: 20 })).toEqual({ cotton: 0.8, polyester: 0.2 });
    expect(normalizeComposition({ cotton: '95%', elastane: '5%' })).toEqual({ cotton: 0.95, elastane: 0.05 });
  });

  it('tolerates the rounding real labels contain', () => {
    expect(normalizeComposition({ a: 33, b: 33, c: 34 })).toEqual({ a: 0.33, b: 0.33, c: 0.34 });
  });

  it('refuses a composition claiming more than the whole object', () => {
    expect(() => normalizeComposition({ cotton: 0.8, wool: 0.8 })).toThrow(/more than the whole object/);
  });

  it('refuses non-positive and unreadable fractions', () => {
    expect(() => normalizeComposition({ cotton: 0 })).toThrow(/greater than zero/);
    expect(() => normalizeComposition({ cotton: 'lots' })).toThrow(/must be a number/);
    expect(() => normalizeComposition(['cotton'])).toThrow(/expected an object/);
  });

  it('returns an empty object for unknown, matching the column default', () => {
    expect(normalizeComposition(null)).toEqual({});
    expect(normalizeComposition({})).toEqual({});
  });
});

describe('normalizeUnitSystem / normalizeAcquisitionMethod', () => {
  it('accepts the constrained values and the obvious synonyms', () => {
    expect(normalizeUnitSystem('Metric')).toBe('metric');
    expect(normalizeUnitSystem('US')).toBe('imperial');
    expect(normalizeAcquisitionMethod('Bought')).toBe('purchased');
    expect(normalizeAcquisitionMethod('handed down')).toBe('inherited');
  });

  it('covers every value the CHECK constraint allows', () => {
    for (const method of ACQUISITION_METHODS) {
      expect(normalizeAcquisitionMethod(method)).toBe(method);
    }
  });

  it('refuses values the CHECK constraint would reject', () => {
    expect(() => normalizeUnitSystem('furlongs')).toThrow(PhysicalPropertyError);
    expect(() => normalizeAcquisitionMethod('stolen')).toThrow(PhysicalPropertyError);
  });
});

describe('normalizePhysicalProperties', () => {
  it('canonicalizes a whole patch', () => {
    expect(
      normalizePhysicalProperties({
        lengthMm: '12 in',
        massG: '2.5 lb',
        colors: 'Navy, White',
        colorHex: '#123ABC',
        composition: { Cotton: 80, elastane: 20 },
        acquisitionMethod: 'gifted',
        unitSystem: 'imperial',
      }),
    ).toEqual({
      lengthMm: 304.8,
      massG: 1133.981,
      colors: ['navy', 'white'],
      colorHex: '#123abc',
      materials: ['cotton', 'elastane'],
      composition: { cotton: 0.8, elastane: 0.2 },
      acquisitionMethod: 'gift',
      unitSystem: 'imperial',
    });
  });

  it('distinguishes not-mentioned from cleared, so it is safe for partial updates', () => {
    expect(normalizePhysicalProperties({ massG: null })).toEqual({ massG: null });
    expect(normalizePhysicalProperties({})).toEqual({});
  });

  it('fills only the axes the caller did not state outright', () => {
    expect(normalizePhysicalProperties({ dimensions: '12 x 8 x 2 in', heightMm: 10 })).toEqual({
      heightMm: 10,
      lengthMm: 304.8,
      widthMm: 203.2,
    });
  });

  it('keeps materials consistent with the stricter composition', () => {
    const result = normalizePhysicalProperties({
      materials: ['leather'],
      composition: { leather: 0.6, brass: 0.4 },
    });

    expect(result.materials).toEqual(['leather', 'brass']);
  });

  it('refuses to give a digital item a body', () => {
    expect(() => normalizePhysicalProperties({ isDigital: true, massG: 10 })).toThrow(/no physical body/);
    expect(() => normalizePhysicalProperties({ isDigital: true, colors: ['blue'] })).not.toThrow();
  });
});
