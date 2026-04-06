import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Plus, ClipboardCheck, FileText, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_SECTIONS } from '@/lib/qc-defaults';
import { format } from 'date-fns';

interface QCGuidesSectionProps {
  productId: string;
  productName: string;
}

export const QCGuidesSection = ({ productId, productName }: QCGuidesSectionProps) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [guides, setGuides] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    loadGuides();
  }, [open, productId]);

  const loadGuides = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('qc_guides')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    setGuides(data || []);
    setLoading(false);
  };

  const createGuide = async () => {
    setCreating(true);
    try {
      // Create guide
      const { data: guide, error } = await supabase
        .from('qc_guides')
        .insert({ product_id: productId, title: `QC Guide — ${productName}`, status: 'draft' })
        .select()
        .single();
      if (error || !guide) throw error || new Error('Failed to create guide');

      // Fetch product data for pre-fill
      const [prodRes, cbmRes] = await Promise.all([
        supabase.from('products').select('width_inch, depth_inch, height_inch').eq('id', productId).single(),
        supabase.from('cbm_estimates').select('ic_width, ic_depth, ic_height, ic_type').eq('product_id', productId).maybeSingle(),
      ]);

      // Create default sections and rows
      for (let si = 0; si < DEFAULT_SECTIONS.length; si++) {
        const sec = DEFAULT_SECTIONS[si];
        const { data: section } = await supabase
          .from('qc_sections')
          .insert({ guide_id: guide.id, name: sec.name, sort_order: si })
          .select()
          .single();
        if (!section) continue;

        const rows = sec.rows.map((r, ri) => {
          let text = r.text_content || '';
          // Pre-fill from product
          if (sec.name === 'Dimensions' && r.label === 'Size' && prodRes.data) {
            const p = prodRes.data;
            if (p.width_inch && p.depth_inch && p.height_inch)
              text = `${p.width_inch} × ${p.depth_inch} × ${p.height_inch} inches`;
          }
          if (sec.name === 'Packaging QC' && r.label === 'Inner Carton Box Size' && cbmRes.data) {
            const c = cbmRes.data;
            if (c.ic_width && c.ic_depth && c.ic_height)
              text = `${c.ic_width} × ${c.ic_depth} × ${c.ic_height} inches (${c.ic_type || '5 ply'})`;
          }
          return { section_id: section.id, label: r.label, text_content: text, sort_order: ri };
        });
        await supabase.from('qc_rows').insert(rows);
      }

      toast.success('QC Guide created');
      navigate(`/qc/${guide.id}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create guide');
    } finally {
      setCreating(false);
    }
  };

  const duplicateGuide = async (guideId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { data: orig } = await supabase.from('qc_guides').select('*').eq('id', guideId).single();
      if (!orig) return;
      const { data: newGuide } = await supabase
        .from('qc_guides')
        .insert({ product_id: productId, title: `${orig.title} (Copy)`, status: 'draft' })
        .select().single();
      if (!newGuide) return;

      const { data: sections } = await supabase.from('qc_sections').select('*').eq('guide_id', guideId).order('sort_order');
      for (const sec of sections || []) {
        const { data: newSec } = await supabase
          .from('qc_sections')
          .insert({ guide_id: newGuide.id, name: sec.name, sort_order: sec.sort_order })
          .select().single();
        if (!newSec) continue;
        const { data: rows } = await supabase.from('qc_rows').select('*').eq('section_id', sec.id).order('sort_order');
        if (rows && rows.length > 0) {
          await supabase.from('qc_rows').insert(
            rows.map((r: any) => ({ section_id: newSec.id, label: r.label, text_content: r.text_content, photo_urls: r.photo_urls, sort_order: r.sort_order }))
          );
        }
      }
      toast.success('Guide duplicated');
      loadGuides();
    } catch {
      toast.error('Failed to duplicate guide');
    }
  };

  const deleteGuide = async (guideId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this QC guide?')) return;
    // Delete rows → sections → guide
    const { data: sections } = await supabase.from('qc_sections').select('id').eq('guide_id', guideId);
    if (sections) {
      for (const sec of sections) {
        await supabase.from('qc_rows').delete().eq('section_id', sec.id);
      }
      await supabase.from('qc_sections').delete().eq('guide_id', guideId);
    }
    await supabase.from('qc_guides').delete().eq('id', guideId);
    setGuides(prev => prev.filter(g => g.id !== guideId));
    toast.success('Guide deleted');
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 py-2 px-3 bg-muted/50 rounded-md hover:bg-muted transition-colors text-left">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
          <ClipboardCheck className="h-4 w-4" />
          <span className="text-sm font-semibold flex-1">QC Guides</span>
          {guides.length > 0 && <Badge variant="secondary" className="text-[10px]">{guides.length}</Badge>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="py-2 px-1 space-y-2">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={createGuide} disabled={creating}>
              <Plus className="h-3 w-3 mr-1" /> New QC Guide
            </Button>
          </div>

          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
          ) : guides.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No QC guides yet for this product.</p>
          ) : (
            <div className="space-y-1">
              {guides.map(g => (
                <div
                  key={g.id}
                  onClick={() => navigate(`/qc/${g.id}`)}
                  className="flex items-center gap-3 px-3 py-2 rounded-md border hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{g.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Created {format(new Date(g.created_at), 'MMM d, yyyy')}
                      {g.updated_at !== g.created_at && ` · Updated ${format(new Date(g.updated_at), 'MMM d, yyyy')}`}
                    </p>
                  </div>
                  <Badge variant={g.status === 'final' ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                    {g.status}
                  </Badge>
                  <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={(e) => duplicateGuide(g.id, e)} title="Duplicate">
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive" onClick={(e) => deleteGuide(g.id, e)} title="Delete">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
