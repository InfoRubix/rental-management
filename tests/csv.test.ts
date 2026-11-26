import { describe, expect, it } from 'vitest';
import { csvField, toCSV } from '../src/lib/csv';

describe('CSV export', () => {
  it('quotes fields and escapes quotes, commas and line breaks', () => {
    expect(csvField('Projector, "HD"\nmodel')).toBe('"Projector, ""HD""\nmodel"');
    expect(csvField(null)).toBe('""');
    expect(csvField(3)).toBe('"3"');
  });

  it('neutralises spreadsheet formulas typed by customers', () => {
    expect(csvField('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvField('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvField('-2+3')).toBe(`"'-2+3"`);
    expect(csvField('+60 12-345 6789')).toBe(`"'+60 12-345 6789"`); // phone kept as text, not a formula
    expect(csvField('Normal name')).toBe('"Normal name"');
  });

  it('starts with a BOM and uses Windows line endings', () => {
    const csv = toCSV(['A', 'B'], [['1', '2']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿"A","B"\r\n"1","2"');
  });
});
