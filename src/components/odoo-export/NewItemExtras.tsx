// Extra fields for a "New item" BOM line: a photo (upload / camera / copy from the final
// product) and an existing Odoo vendor. Vendors are never created from HQ: the picker links
// to Odoo's Purchase → Vendors form instead. The HQ costing vendor is only a suggestion.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronsUpDown, ExternalLink, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { searchOdooVendors, type OdooVendor } from '@/lib/odoo-products';
import { bestVendorMatch, vendorSearchWord } from '@/lib/vendor-match';

const suggestCache = new Map<string, Promise<OdooVendor | null>>();
let createUrlCache: string | null = null;

function suggestFor(hqVendor: string) {
  const key = hqVendor.trim().toLowerCase();
  if (!suggestCache.has(key)) {
    const word = vendorSearchWord(hqVendor);
    suggestCache.set(key, word
      ? searchOdooVendors(word).then(r => { createUrlCache ||= r.createUrl; return bestVendorMatch(hqVendor, r.vendors); }).catch(() => null)
      : Promise.resolve(null));
  }
  return suggestCache.get(key)!;
}

export function VendorPicker({ value, hqVendor, onPick }: { value: OdooVendor | null; hqVendor: string; onPick: (v: OdooVendor | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<OdooVendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createUrl, setCreateUrl] = useState<string | null>(createUrlCache);
  const [suggested, setSuggested] = useState<OdooVendor | null>(null);

  useEffect(() => {
    if (value || !hqVendor.trim()) { setSuggested(null); return; }
    let live = true;
    suggestFor(hqVendor).then(v => { if (live) { setSuggested(v); setCreateUrl(createUrlCache); } });
    return () => { live = false; };
  }, [value, hqVendor]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchOdooVendors(query);
        if (!cancelled) { setRows(r.vendors); setError(null); if (r.createUrl) { createUrlCache = r.createUrl; setCreateUrl(r.createUrl); } }
      } catch (e) {
        if (!cancelled) { setRows([]); setError(e instanceof Error ? e.message : String(e)); }
      } finally { if (!cancelled) setLoading(false); }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query]);

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="flex-1 min-w-0 justify-between h-8 text-xs font-normal">
              <span className="truncate text-left">{value ? value.name : <span className="text-muted-foreground">Vendor (optional)…</span>}</span>
              <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] max-w-[90vw] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Search Odoo vendors…" value={query} onValueChange={setQuery} />
              <CommandList>
                {loading && <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Odoo…</div>}
                {!loading && error && <div className="p-3 text-xs text-destructive">{error}</div>}
                {!loading && !error && <CommandEmpty>No Odoo vendors found.</CommandEmpty>}
                {!loading && !error && rows.length > 0 && (
                  <CommandGroup>
                    {rows.map(v => (
                      <CommandItem key={v.id} value={String(v.id)} onSelect={() => { onPick(v); setOpen(false); }}>
                        <span className="truncate text-xs">{v.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
              {createUrl && (
                <a href={createUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" /> New vendor? Create it in Odoo, then search again
                </a>
              )}
            </Command>
          </PopoverContent>
        </Popover>
        {value && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onPick(null)} aria-label="Remove vendor"><X className="h-3.5 w-3.5" /></Button>
        )}
      </div>
      {!value && suggested && (
        <button type="button" onClick={() => onPick(suggested)}
          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-foreground hover:bg-primary/20"
          title={`HQ costing vendor: ${hqVendor}`}>
          <Sparkles className="h-3 w-3" /> Use {suggested.name}?
        </button>
      )}
    </div>
  );
}

export function ItemPhoto({ value, finishedUrl, onChange }: { value: string | null | undefined; finishedUrl: string | null; onChange: (url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const path = `odoo-materials/${crypto.randomUUID()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`;
      const { error } = await supabase.storage.from('product-photos').upload(path, file, { contentType: file.type, upsert: true });
      if (error) throw error;
      onChange(supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl);
    } catch (e) {
      toast.error(`Photo upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-1.5">
      <input ref={input} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      {value ? (
        <div className="relative">
          <img src={value} alt="Item" className="h-8 w-8 rounded object-cover border" />
          <button type="button" onClick={() => onChange(null)} aria-label="Remove photo"
            className="absolute -top-1.5 -right-1.5 rounded-full bg-background border h-4 w-4 flex items-center justify-center"><X className="h-2.5 w-2.5" /></button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5 mr-1" />}{busy ? '' : 'Photo'}
        </Button>
      )}
      {!value && finishedUrl && (
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onChange(finishedUrl)}>Copy from final product</Button>
      )}
    </div>
  );
}
