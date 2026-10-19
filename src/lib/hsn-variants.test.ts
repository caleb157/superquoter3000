import { describe, expect, it } from 'vitest';
import { checkVariantGroup, defaultFinished, hsnIssue, templateGroups, withVariantDefaults, type FinishedDraft } from './odoo-bom';
import { confidentHsn, matchHsn, type HsnCode } from './hsn-match';

const fin = (p: Partial<FinishedDraft>): FinishedDraft => ({ ...defaultFinished({ name: 'X' }), ...p });

describe('variant defaults', () => {
  it('a lone product defaults blank suffix to STND and variant to Standard', () => {
    const f = withVariantDefaults(fin({ sku: 'LUX-TBL01-', variant: '' }), 1);
    expect(f.sku).toBe('LUX-TBL01-STND');
    expect(f.variant).toBe('Standard');
  });
  it('a template with 2+ variants gets no defaults', () => {
    const f = withVariantDefaults(fin({ sku: 'LUX-TBL01-', variant: '' }), 2);
    expect(f.sku).toBe('LUX-TBL01-');
    expect(f.variant).toBe('');
  });
  it('requires suffix and variant name on every variant of a multi-variant template', () => {
    const m = checkVariantGroup([
      { productId: 'a', finished: fin({ sku: 'LUX-TBL01-', variant: '' }) },
      { productId: 'b', finished: fin({ sku: 'LUX-TBL01-WLNT', variant: 'Walnut' }) },
    ]);
    expect(m.get('a')!.length).toBe(2);
    expect(m.get('b')!.length).toBe(0);
  });
  it('rejects two variants sharing a suffix or a variant name', () => {
    const m = checkVariantGroup([
      { productId: 'a', finished: fin({ sku: 'LUX-TBL01-STND', variant: 'Standard' }) },
      { productId: 'b', finished: fin({ sku: 'LUX-TBL01-stnd', variant: 'standard' }) },
    ]);
    expect(m.get('a')!.length).toBe(2);
    expect(m.get('b')!.length).toBe(2);
  });
  it('groups by template name; blank stays alone', () => {
    const g = templateGroups([
      { productId: 'a', finished: fin({ group: 'Table' }) },
      { productId: 'b', finished: fin({ group: '' }) },
      { productId: 'c', finished: fin({ group: 'table ' }) },
    ]);
    expect(g.map(x => x.map(r => r.productId))).toEqual([['a', 'c'], ['b']]);
  });
});

describe('HSN', () => {
  it('must be 8 digits', () => {
    expect(hsnIssue('940360')).not.toBeNull();
    expect(hsnIssue('94036000')).toBeNull();
    expect(hsnIssue('')).toBeNull();
  });
  const codes: HsnCode[] = [
    { code: '94036000', description: 'Wooden furniture, other', keywords: ['table', 'bench'], examples: ['Mango Wood Scalloped Coffee Table'] },
    { code: '94016900', description: 'Seats with wooden frames', keywords: ['stool', 'chair'], examples: ['Mango Wood Carved Stool'] },
    { code: '44191100', description: 'Chopping boards', keywords: ['charcuterie', 'board'], examples: ['Acacia charcuterie board'] },
  ];
  it('matches by product name, no AI', () => {
    expect(confidentHsn(matchHsn('Acacia Bar Stool with Cushion', codes))?.code).toBe('94016900');
    expect(confidentHsn(matchHsn('Live edge charcuterie board', codes))?.code).toBe('44191100');
    expect(matchHsn('Brass rickshaw', codes)).toEqual([]);
  });
});
