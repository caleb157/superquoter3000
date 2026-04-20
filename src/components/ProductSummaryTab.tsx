import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ProductStagePills } from '@/components/ProductStagePills';
import { STAGE_LABEL } from '@/components/ProductStagePills';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

type Product = {
  id: string; name: string; updated_at: string | null;
  customer_rfq_id: string | null;
  design_stage: string | null; quote_stage: string | null; sample_stage: string | null;
  notes_finishes: string | null; notes_vendors: string | null; notes_issues: string | null;
};
type Inquiry = {
  id: string; rfq_number: string; title: string | null;
  customer: { id: string; name: string; company: string | null } | null;
};
type StageEvent = {
  id: string; track: string; from_stage: string | null; to_stage: string | null; occurred_at: string;
};

type SaveState = 'idle' | 'saving' | 'saved';

type Props = { productId: string; onProductUpdated?: () => void };

export function ProductSummaryTab({ productId, onProductUpdated }: Props) {
  const [product, setProduct] = useState<Product | null>(null);
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [saving, setSaving] = useState<Record<string, SaveState>>({});

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase
        .from('products')
        .select('id, name, updated_at, customer_rfq_id, design_stage, quote_stage, sample_stage, notes_finishes, notes_vendors, notes_issues')
        .eq('id', productId).maybeSingle();
      if (p) setProduct(p as any);

      if ((p as any)?.customer_rfq_id) {
        const { data: inq } = await supabase
          .from('customer_rfqs')
          .select('id, rfq_number, title, customer:customers(id, name, company)')
          .eq('id', (p as any).customer_rfq_id).maybeSingle();
        if (inq) setInquiry(inq as any);
      }

      const { data: ev } = await supabase
        .from('product_stage_events')
        .select('id, track, from_stage, to_stage, occurred_at')
        .eq('product_id', productId)
        .order('occurred_at', { ascending: false })
        .limit(5);
      setEvents((ev as any) ?? []);
    })();
  }, [productId]);

  const saveNote = async (field: 'notes_finishes' | 'notes_vendors' | 'notes_issues', value: string) => {
    setSaving(s => ({ ...s, [field]: 'saving' }));
    const { error } = await (supabase as any).from('products').update({ [field]: value || null }).eq('id', productId);
    if (error) { toast.error(error.message); setSaving(s => ({ ...s, [field]: 'idle' })); return; }
    setSaving(s => ({ ...s, [field]: 'saved' }));
    onProductUpdated?.();
    setTimeout(() => setSaving(s => ({ ...s, [field]: 'idle' })), 1500);
  };

  if (!product) return <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>;

  return (
    <div className="space-y-3">
      {/* Overview */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Overview</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {inquiry ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Inquiry:</span>
              <Link to={`/inquiry/${inquiry.id}`} className="hover:underline font-medium">
                {inquiry.rfq_number}{inquiry.title ? ` — ${inquiry.title}` : ''}
              </Link>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No inquiry linked</div>
          )}
          {inquiry?.customer && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Customer:</span>
              <span>{inquiry.customer.name}{inquiry.customer.company ? ` · ${inquiry.customer.company}` : ''}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Stages:</span>
            <ProductStagePills product={product} onChange={() => {}} />
          </div>
          {product.updated_at && (
            <div className="text-xs text-muted-foreground">
              Updated {formatDistanceToNow(new Date(product.updated_at), { addSuffix: true })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {([
            { key: 'notes_finishes', label: 'Finishes' },
            { key: 'notes_vendors', label: 'Vendors' },
            { key: 'notes_issues', label: 'Issues' },
          ] as const).map(f => (
            <div key={f.key}>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">{f.label}</Label>
                {saving[f.key] === 'saving' && <span className="text-[10px] text-muted-foreground">Saving…</span>}
                {saving[f.key] === 'saved' && <span className="text-[10px] text-emerald-600">Saved</span>}
              </div>
              <Textarea
                defaultValue={product[f.key] ?? ''}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (product[f.key] ?? '')) {
                    setProduct(p => p ? { ...p, [f.key]: v } : p);
                    saveNote(f.key, v);
                  }
                }}
                rows={3}
                className="text-sm"
                placeholder={`Notes about ${f.label.toLowerCase()}...`}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent activity</CardTitle></CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-3">No stage changes yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {events.map(e => (
                <li key={e.id} className="text-xs flex items-center gap-2">
                  <span className="capitalize font-medium">{e.track}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{e.from_stage ? (STAGE_LABEL[e.from_stage] ?? e.from_stage) : '—'}</span>
                  <span>→</span>
                  <span>{e.to_stage ? (STAGE_LABEL[e.to_stage] ?? e.to_stage) : '—'}</span>
                  <span className="text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
