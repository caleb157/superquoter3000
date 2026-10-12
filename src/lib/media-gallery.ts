// Media Gallery: every photo in the app in one list, read live from the records that
// own them (products, assemblies, sample lines, tasks). Nothing is copied: each photo
// is a link stored on its parent row, and the gallery links back to that row.

import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/supabase-paged';

export type MediaSource = 'product' | 'assembly' | 'sample' | 'task';

export const MEDIA_SOURCES: { key: MediaSource; label: string }[] = [
  { key: 'product', label: 'Products' },
  { key: 'assembly', label: 'Assemblies' },
  { key: 'sample', label: 'Samples' },
  { key: 'task', label: 'Tasks' },
];

export interface MediaItem {
  /** Unique per photo: source, parent id and position. */
  key: string;
  url: string;
  source: MediaSource;
  parentId: string;
  /** Product / assembly name, task title. */
  title: string;
  sku: string | null;
  /** Extra line under the title, e.g. the sample vendor or task status. */
  detail: string | null;
  inquiryId: string | null;
  inquiryNumber: string | null;
  inquiryTitle: string | null;
  customer: string | null;
  /** The parent record's date (photos carry no upload time of their own). */
  date: string;
  /** Where "Open" goes; tasks open in a dialog instead (see page). */
  href: string | null;
}

export interface InquiryRef { id: string; rfq_number: string; title: string | null; customer: string | null }

export interface RawMedia {
  products: { id: string; name: string; sku: string | null; photo_url: string | null; customer_rfq_id: string | null; created_at: string }[];
  assemblies: { id: string; name: string; sku: string | null; photo_url: string | null; customer_rfq_id: string | null; created_at: string }[];
  samples: {
    id: string; request_id: string | null; photo_urls: unknown; status: string; customer_rfq_id: string | null;
    created_at: string; completed_at: string | null;
    product: { id: string; name: string; sku: string | null; customer_rfq_id: string | null } | null;
    vendor: { name: string } | null;
  }[];
  tasks: { id: string; title: string; status: string; photo_urls: unknown; inquiry_id: string | null; created_at: string }[];
  inquiries: InquiryRef[];
}

const urlList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.trim() !== '') : [];

/** Flatten the raw rows into one photo list, newest first. */
export function buildMediaItems(raw: RawMedia): MediaItem[] {
  const inq = new Map(raw.inquiries.map(i => [i.id, i]));
  const withInquiry = (id: string | null) => {
    const i = id ? inq.get(id) : undefined;
    return {
      inquiryId: i?.id ?? null,
      inquiryNumber: i?.rfq_number ?? null,
      inquiryTitle: i?.title ?? null,
      customer: i?.customer ?? null,
    };
  };
  const out: MediaItem[] = [];

  for (const p of raw.products) {
    if (!p.photo_url?.trim()) continue;
    out.push({
      key: `product:${p.id}`, url: p.photo_url, source: 'product', parentId: p.id,
      title: p.name, sku: p.sku, detail: null, ...withInquiry(p.customer_rfq_id),
      date: p.created_at, href: `/product/${p.id}`,
    });
  }
  for (const a of raw.assemblies) {
    if (!a.photo_url?.trim()) continue;
    out.push({
      key: `assembly:${a.id}`, url: a.photo_url, source: 'assembly', parentId: a.id,
      title: a.name, sku: a.sku, detail: null, ...withInquiry(a.customer_rfq_id),
      date: a.created_at, href: `/assembly/${a.id}`,
    });
  }
  for (const s of raw.samples) {
    const statusWord = s.status === 'completed' ? 'Received' : s.status === 'cancelled' ? 'Cancelled' : 'Requested';
    urlList(s.photo_urls).forEach((url, n) => out.push({
      key: `sample:${s.id}:${n}`, url, source: 'sample', parentId: s.id,
      title: s.product?.name ?? 'Sample', sku: s.product?.sku ?? null,
      detail: [s.vendor?.name, statusWord].filter(Boolean).join(' · '),
      ...withInquiry(s.customer_rfq_id ?? s.product?.customer_rfq_id ?? null),
      date: s.completed_at ?? s.created_at,
      href: s.request_id ? `/samples/${s.request_id}` : s.product ? `/product/${s.product.id}` : null,
    }));
  }
  for (const t of raw.tasks) {
    urlList(t.photo_urls).forEach((url, n) => out.push({
      key: `task:${t.id}:${n}`, url, source: 'task', parentId: t.id,
      title: t.title, sku: null, detail: t.status === 'done' ? 'Done' : 'Open',
      ...withInquiry(t.inquiry_id), date: t.created_at, href: null,
    }));
  }

  return out.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

export interface MediaFilters {
  sources: MediaSource[];
  search: string;
  inquiryId: string | null;
  /** yyyy-mm-dd, inclusive, local dates. */
  from: string | null;
  to: string | null;
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function filterMediaItems(items: MediaItem[], f: MediaFilters): MediaItem[] {
  const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  const sources = new Set(f.sources);
  return items.filter(m => {
    if (sources.size && !sources.has(m.source)) return false;
    if (f.inquiryId && m.inquiryId !== f.inquiryId) return false;
    if (f.from || f.to) {
      const day = localDay(m.date);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    if (words.length) {
      const hay = [m.title, m.sku, m.detail, m.inquiryNumber, m.inquiryTitle, m.customer]
        .filter(Boolean).join(' ').toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
}

/** Load every photo-bearing row, paging past the 1,000-row cap. */
export async function loadMediaItems(): Promise<{ items: MediaItem[]; inquiries: InquiryRef[] }> {
  const db = supabase as any;
  const [products, assemblies, samples, tasks, inquiryRows] = await Promise.all([
    fetchAllRows(() => db.from('products')
      .select('id, name, sku, photo_url, customer_rfq_id, created_at')
      .not('photo_url', 'is', null).neq('photo_url', '').is('archived_at', null).order('id')),
    fetchAllRows(() => db.from('product_assemblies')
      .select('id, name, sku, photo_url, customer_rfq_id, created_at')
      .not('photo_url', 'is', null).neq('photo_url', '').order('id')),
    fetchAllRows(() => db.from('samples')
      .select('id, request_id, photo_urls, status, customer_rfq_id, created_at, completed_at, product:products(id, name, sku, customer_rfq_id), vendor:vendors(name)')
      .neq('photo_urls', '[]').order('id')),
    fetchAllRows(() => db.from('tasks')
      .select('id, title, status, photo_urls, inquiry_id, created_at')
      .neq('photo_urls', '[]').order('id')),
    fetchAllRows(() => db.from('customer_rfqs')
      .select('id, rfq_number, title, customers(name)').order('id')),
  ]);
  const inquiries: InquiryRef[] = (inquiryRows as any[]).map(i => ({
    id: i.id, rfq_number: i.rfq_number, title: i.title, customer: i.customers?.name ?? null,
  }));
  const items = buildMediaItems({ products, assemblies, samples, tasks, inquiries } as RawMedia);
  // Only offer inquiries that actually have photos in the picker.
  const withPhotos = new Set(items.map(m => m.inquiryId).filter(Boolean));
  return { items, inquiries: inquiries.filter(i => withPhotos.has(i.id)).sort((a, b) => b.rfq_number.localeCompare(a.rfq_number)) };
}
