import { describe, it, expect } from 'vitest';
import { buildMediaItems, filterMediaItems, type MediaFilters, type RawMedia } from './media-gallery';

const raw: RawMedia = {
  inquiries: [
    { id: 'i1', rfq_number: 'RFQ-001', title: 'Dining set', customer: 'Acme' },
    { id: 'i2', rfq_number: 'RFQ-002', title: null, customer: 'Bolt' },
  ],
  products: [
    { id: 'p1', name: 'Oak table', sku: 'TB-01', photo_url: 'https://x/p1.jpg', customer_rfq_id: 'i1', created_at: '2026-09-01T10:00:00Z' },
    { id: 'p2', name: 'No photo', sku: 'TB-02', photo_url: '  ', customer_rfq_id: 'i1', created_at: '2026-09-02T10:00:00Z' },
  ],
  assemblies: [
    { id: 'a1', name: 'Dining kit', sku: 'KIT-1', photo_url: 'https://x/a1.jpg', customer_rfq_id: null, created_at: '2026-08-01T10:00:00Z' },
  ],
  samples: [{
    id: 's1', request_id: 'r1', photo_urls: ['https://x/s1a.jpg', 'https://x/s1b.jpg', 42], status: 'completed',
    customer_rfq_id: null, created_at: '2026-09-05T10:00:00Z', completed_at: '2026-10-01T10:00:00Z',
    product: { id: 'p1', name: 'Oak table', sku: 'TB-01', customer_rfq_id: 'i1' }, vendor: { name: 'Woodworks' },
  }],
  tasks: [
    { id: 't1', title: 'Check finish on chair', status: 'open', photo_urls: ['https://x/t1.jpg'], inquiry_id: 'i2', created_at: '2026-10-05T10:00:00Z' },
    { id: 't2', title: 'Nothing attached', status: 'open', photo_urls: null, inquiry_id: null, created_at: '2026-10-06T10:00:00Z' },
  ],
};

const none: MediaFilters = { sources: [], search: '', inquiryId: null, from: null, to: null };

describe('buildMediaItems', () => {
  const items = buildMediaItems(raw);

  it('makes one item per photo, skipping blanks and non-links, newest first', () => {
    expect(items.map(m => m.key)).toEqual(['task:t1:0', 'sample:s1:0', 'sample:s1:1', 'product:p1', 'assembly:a1']);
  });

  it('links each photo back to its record and inquiry', () => {
    const sample = items.find(m => m.key === 'sample:s1:0')!;
    expect(sample).toMatchObject({
      href: '/samples/r1', sku: 'TB-01', detail: 'Woodworks · Received',
      inquiryId: 'i1', inquiryNumber: 'RFQ-001', customer: 'Acme', date: '2026-10-01T10:00:00Z',
    });
    expect(items.find(m => m.key === 'product:p1')!.href).toBe('/product/p1');
    expect(items.find(m => m.key === 'assembly:a1')!).toMatchObject({ href: '/assembly/a1', inquiryId: null });
    expect(items.find(m => m.key === 'task:t1:0')!).toMatchObject({ href: null, parentId: 't1', customer: 'Bolt' });
  });
});

describe('filterMediaItems', () => {
  const items = buildMediaItems(raw);
  const keys = (f: Partial<MediaFilters>) => filterMediaItems(items, { ...none, ...f }).map(m => m.key);

  it('returns everything with no filters', () => {
    expect(keys({})).toHaveLength(5);
  });

  it('filters by source', () => {
    expect(keys({ sources: ['task', 'assembly'] })).toEqual(['task:t1:0', 'assembly:a1']);
  });

  it('filters by inquiry', () => {
    expect(keys({ inquiryId: 'i1' })).toEqual(['sample:s1:0', 'sample:s1:1', 'product:p1']);
  });

  it('searches SKU, names, inquiry and customer, all words must match', () => {
    expect(keys({ search: 'tb-01' })).toEqual(['sample:s1:0', 'sample:s1:1', 'product:p1']);
    expect(keys({ search: 'chair' })).toEqual(['task:t1:0']);
    expect(keys({ search: 'acme oak' })).toEqual(['sample:s1:0', 'sample:s1:1', 'product:p1']);
    expect(keys({ search: 'acme chair' })).toEqual([]);
  });

  it('filters by an inclusive date range', () => {
    expect(keys({ from: '2026-09-01', to: '2026-10-01' })).toEqual(['sample:s1:0', 'sample:s1:1', 'product:p1']);
  });
});
