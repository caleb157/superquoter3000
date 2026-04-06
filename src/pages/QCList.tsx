import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, FileDown, Copy, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_SECTIONS } from '@/lib/qc-defaults';
import { generateQCPdf } from '@/lib/qc-pdf';

const QCList = () => {
  const navigate = useNavigate();
  const [guides, setGuides] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [guidesRes, productsRes] = await Promise.all([
      supabase.from('qc_guides').select('*, products(name, sku, width_inch, depth_inch, height_inch)').order('updated_at', { ascending: false }),
      supabase.from('products').select('id, name, sku, project_id, width_inch, depth_inch, height_inch').eq('is_component', false).order('name'),
    ]);
    if (guidesRes.data) setGuides(guidesRes.data);
    if (productsRes.data) setProducts(productsRes.data);
    setLoading(false);
  };

  const createGuide = async () => {
    if (!selectedProductId) return;
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return;

    // Create guide
    const { data: guide, error } = await supabase.from('qc_guides').insert({
      product_id: selectedProductId,
      title: `QC Guide — ${product.name}${product.sku ? ` (${product.sku})` : ''}`,
      status: 'draft',
    }).select().single();
    if (error || !guide) { toast.error('Failed to create guide'); return; }

    // Load product data for pre-fill
    const [cbmRes, cogsRes] = await Promise.all([
      supabase.from('cbm_estimates').select('*').eq('product_id', selectedProductId).maybeSingle(),
      supabase.from('cogs_items').select('*').eq('product_id', selectedProductId),
    ]);

    // Create default sections with pre-filled data
    for (let si = 0; si < DEFAULT_SECTIONS.length; si++) {
      const sec = DEFAULT_SECTIONS[si];
      const { data: section } = await supabase.from('qc_sections').insert({
        guide_id: guide.id,
        name: sec.name,
        sort_order: si,
      }).select().single();
      if (!section) continue;

      const rows = sec.rows.map((row, ri) => {
        let text_content = row.text_content || '';
        // Pre-fill logic
        if (sec.name === 'Dimensions' && row.label === 'Size') {
          if (product.width_inch && product.depth_inch && product.height_inch) {
            text_content = `${product.width_inch}" x ${product.depth_inch}" x ${product.height_inch}" (L x W x H)`;
          }
        }
        if (sec.name === 'Packaging QC' && row.label === 'Inner Carton Box Size') {
          const cbm = cbmRes?.data;
          if (cbm?.ic_width && cbm?.ic_depth && cbm?.ic_height) {
            text_content = `${cbm.ic_width}" x ${cbm.ic_depth}" x ${cbm.ic_height}"`;
          }
        }
        return {
          section_id: section.id,
          label: row.label,
          text_content,
          sort_order: ri,
        };
      });
      await supabase.from('qc_rows').insert(rows);
    }

    toast.success('QC Guide created');
    setShowCreate(false);
    navigate(`/qc/${guide.id}`);
  };

  const duplicateGuide = async (guideId: string) => {
    // Load source
    const { data: source } = await supabase.from('qc_guides').select('*').eq('id', guideId).single();
    if (!source) return;
    const { data: sections } = await supabase.from('qc_sections').select('*, qc_rows(*)').eq('guide_id', guideId).order('sort_order');
    
    // Create copy
    const { data: newGuide } = await supabase.from('qc_guides').insert({
      product_id: source.product_id,
      title: source.title + ' (Copy)',
      status: 'draft',
    }).select().single();
    if (!newGuide) return;

    for (const sec of sections || []) {
      const { data: newSec } = await supabase.from('qc_sections').insert({
        guide_id: newGuide.id,
        name: sec.name,
        sort_order: sec.sort_order,
      }).select().single();
      if (!newSec) continue;
      const rows = (sec.qc_rows || []).map((r: any) => ({
        section_id: newSec.id,
        label: r.label,
        text_content: r.text_content,
        photo_urls: r.photo_urls,
        sort_order: r.sort_order,
      }));
      if (rows.length) await supabase.from('qc_rows').insert(rows);
    }

    toast.success('Guide duplicated');
    loadData();
  };

  const exportPdf = async (guideId: string) => {
    const { data: guide } = await supabase.from('qc_guides').select('*').eq('id', guideId).single();
    if (!guide) return;
    const { data: sections } = await supabase.from('qc_sections').select('*, qc_rows(*)').eq('guide_id', guideId).order('sort_order');
    
    const pdfData = {
      title: guide.title,
      sections: (sections || []).map(s => ({
        name: s.name,
        rows: ((s.qc_rows || []) as any[]).sort((a: any, b: any) => a.sort_order - b.sort_order).map((r: any) => ({
          label: r.label,
          text_content: r.text_content,
          photo_urls: r.photo_urls || [],
        })),
      })),
    };

    const doc = await generateQCPdf(pdfData);
    doc.save(`${guide.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    toast.success('PDF exported');
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">QC Guides</h1>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Guide
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Edited</TableHead>
              <TableHead className="w-[140px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : guides.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No QC guides yet</TableCell></TableRow>
            ) : guides.map(g => (
              <TableRow key={g.id}>
                <TableCell>
                  <Link to={`/qc/${g.id}`} className="text-primary hover:underline font-medium">{g.title}</Link>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{(g as any).products?.sku || '—'}</TableCell>
                <TableCell>
                  <Badge variant={g.status === 'final' ? 'default' : 'secondary'} className="text-xs">
                    {g.status === 'final' ? 'Final' : 'Draft'}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(g.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(g.updated_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/qc/${g.id}`)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicateGuide(g.id)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => exportPdf(g.id)}>
                      <FileDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create QC Guide</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm font-medium">Select Product / SKU</label>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a product..." />
              </SelectTrigger>
              <SelectContent>
                {products.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{p.sku ? ` (${p.sku})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createGuide} disabled={!selectedProductId}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default QCList;
