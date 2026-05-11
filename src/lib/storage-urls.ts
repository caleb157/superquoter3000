import { createElement, useEffect, useState, type ImgHTMLAttributes } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Buckets that are private and require signed URLs for display.
const PRIVATE_BUCKETS = new Set(['task-photos', 'qc-photos', 'sample-photos']);
const SIGN_TTL = 60 * 60; // 1 hour

type Parsed = { bucket: string; path: string } | null;

// Parse either a stored public URL or a "bucket/path" string into bucket + path.
function parseStored(stored: string): Parsed {
  if (!stored) return null;
  // Match .../storage/v1/object/(public|sign)/<bucket>/<path>
  const m = stored.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  return null;
}

const cache = new Map<string, { url: string; exp: number }>();

export async function resolveDisplayUrl(stored: string): Promise<string> {
  const parsed = parseStored(stored);
  if (!parsed || !PRIVATE_BUCKETS.has(parsed.bucket)) return stored;
  const key = `${parsed.bucket}/${parsed.path}`;
  const now = Date.now() / 1000;
  const hit = cache.get(key);
  if (hit && hit.exp > now + 30) return hit.url;
  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, SIGN_TTL);
  if (error || !data?.signedUrl) return stored;
  cache.set(key, { url: data.signedUrl, exp: now + SIGN_TTL });
  return data.signedUrl;
}

export function useSignedUrls(urls: string[] | undefined): string[] {
  const [resolved, setResolved] = useState<string[]>(urls ?? []);
  const key = (urls ?? []).join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = urls ?? [];
      const out = await Promise.all(list.map(u => resolveDisplayUrl(u)));
      if (!cancelled) setResolved(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return resolved;
}

export function useSignedUrl(url: string | null | undefined): string {
  const arr = useSignedUrls(url ? [url] : []);
  return arr[0] ?? '';
}



export function SignedImg({ src, ...rest }: SignedImgProps) {
  const resolved = useSignedUrl(src);
  return createElement('img', { ...rest, src: resolved || src });
}
