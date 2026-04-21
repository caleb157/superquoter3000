import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Package2, ChevronDown, ChevronRight } from 'lucide-react';
import { differenceInDays, parseISO } from 'date-fns';
import { GenerateSampleBatchDialog } from '@/components/GenerateSampleBatchDialog';
import { MobileFab } from '@/components/MobileFab';

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const SAMPLE_STATUS_COLOR: Record<string, string> = {
  requested: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-amber-100 text-amber-700',
  ready: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function SamplesList() {
  const navigate = useNavigate();
  const [rfsItems, setRfsItems] = useState<any[]>([]);
  const [samples, setSamples] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchAll = async () => {
    const [rfsRes, sampleRes, inqRes] = await Promise.all([
      (supabase as any).from('rfs').select('*').order('requested_date', { ascending: false }),
      (supabase as any).from('samples').select('*').order('created_at', { ascending: false }),
      (supabase as any).from('customer_rfqs').select('id, rfq_number, title'),
    ]);
    setRfsItems(rfsRes.data || []);
    setSamples(sampleRes.data || []);
    setInquiries(inqRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const samplesByRfs = useMemo(() => {
    const m: Record<string, any[]> = {};
    samples.forEach(s => { (m[s.rfs_id] ||= []).push(s); });
    return m;
  }, [samples]);

  const inquiryLabel = (id: string | null) => {
    if (!id) return '—';
    const i = inquiries.find(x => x.id === id);
    return i ? `${i.rfq_number}${i.title ? ` · ${i.title}` : ''}` : '—';
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold flex items-center gap-2"><Package2 className="h-5 w-5" /> Samples</h1>
          <Button size="sm" className="ml-auto gap-1.5" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Batch
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : rfsItems.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Package2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No sample requests yet. Create your first RFS to start tracking vendor samples.</p>
          </CardContent></Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden md:block"><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs w-8"></TableHead>
                  <TableHead className="text-xs">RFS</TableHead>
                  <TableHead className="text-xs">Inquiry</TableHead>
                  <TableHead className="text-xs">Title</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Requested</TableHead>
                  <TableHead className="text-xs text-right">Required by</TableHead>
                  <TableHead className="text-xs text-right">Samples</TableHead>
                  <TableHead className="text-xs text-right">Days</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rfsItems.map(r => {
                    const list = samplesByRfs[r.id] || [];
                    const days = differenceInDays(new Date(), parseISO(r.requested_date));
                    const isOpen = expanded[r.id];
                    return (
                      <>
                        <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30"
                          onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}>
                          <TableCell>
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.rfs_number}</TableCell>
                          <TableCell className="text-xs">
                            {r.customer_rfq_id ? (
                              <button className="hover:underline" onClick={e => { e.stopPropagation(); navigate(`/inquiry/${r.customer_rfq_id}`); }}>
                                {inquiryLabel(r.customer_rfq_id)}
                              </button>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-sm">{r.title || '—'}</TableCell>
                          <TableCell><Badge className={STATUS_COLOR[r.status] || ''} variant="secondary">{r.status.replace('_', ' ')}</Badge></TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{new Date(r.requested_date).toLocaleDateString()}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{r.required_by_date ? new Date(r.required_by_date).toLocaleDateString() : '—'}</TableCell>
                          <TableCell className="text-xs text-right">{list.length}</TableCell>
                          <TableCell className={`text-xs text-right ${days > 14 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>{days}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={9} className="bg-muted/20 p-3">
                              {list.length === 0 ? (
                                <div className="text-xs text-muted-foreground text-center py-2">No vendor samples yet for this RFS.</div>
                              ) : (
                                <div className="space-y-1">
                                  {list.map(s => (
                                    <div key={s.id} className="flex items-center gap-3 text-xs bg-background rounded px-3 py-1.5">
                                      <Badge className={SAMPLE_STATUS_COLOR[s.status] || ''} variant="secondary">{s.status.replace('_', ' ')}</Badge>
                                      <span className="font-medium">{s.vendor_name || 'Unknown vendor'}</span>
                                      {s.dimensions_inch && <span className="text-muted-foreground">{s.dimensions_inch}"</span>}
                                      {s.finish && <span className="text-muted-foreground">{s.finish}</span>}
                                      <span className="ml-auto text-muted-foreground">
                                        {s.final_ready_date ? `Ready ${new Date(s.final_ready_date).toLocaleDateString()}`
                                          : s.initial_ready_date ? `Initial ${new Date(s.initial_ready_date).toLocaleDateString()}`
                                          : s.requested_date ? `Requested ${new Date(s.requested_date).toLocaleDateString()}` : ''}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {rfsItems.map(r => {
                const list = samplesByRfs[r.id] || [];
                const days = differenceInDays(new Date(), parseISO(r.requested_date));
                const isOpen = expanded[r.id];
                return (
                  <Card key={r.id}>
                    <CardContent className="p-3 space-y-2">
                      <button
                        className="w-full text-left"
                        onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}
                      >
                        <div className="flex items-start gap-2">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-medium">{r.rfs_number}</span>
                              <Badge className={STATUS_COLOR[r.status] || ''} variant="secondary">{r.status.replace('_', ' ')}</Badge>
                            </div>
                            {r.title && <div className="text-sm font-medium truncate mt-0.5">{r.title}</div>}
                            {r.customer_rfq_id && (
                              <button
                                className="text-xs text-primary hover:underline truncate block max-w-full"
                                onClick={e => { e.stopPropagation(); navigate(`/inquiry/${r.customer_rfq_id}`); }}
                              >
                                {inquiryLabel(r.customer_rfq_id)}
                              </button>
                            )}
                          </div>
                        </div>
                      </button>
                      <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 border-t">
                        <div>
                          <div className="text-muted-foreground">Samples</div>
                          <div className="font-medium">{list.length}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Days</div>
                          <div className={`font-medium ${days > 14 ? 'text-amber-600' : ''}`}>{days}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Required</div>
                          <div className="font-medium">{r.required_by_date ? new Date(r.required_by_date).toLocaleDateString() : '—'}</div>
                        </div>
                      </div>
                      {isOpen && list.length > 0 && (
                        <div className="space-y-1 pt-1 border-t">
                          {list.map(s => (
                            <div key={s.id} className="text-[11px] bg-muted/30 rounded px-2 py-1.5 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge className={SAMPLE_STATUS_COLOR[s.status] || ''} variant="secondary">{s.status.replace('_', ' ')}</Badge>
                                <span className="font-medium truncate">{s.vendor_name || 'Unknown vendor'}</span>
                              </div>
                              {(s.dimensions_inch || s.finish) && (
                                <div className="text-muted-foreground">
                                  {s.dimensions_inch && <span>{s.dimensions_inch}"</span>}
                                  {s.dimensions_inch && s.finish && <span> · </span>}
                                  {s.finish && <span>{s.finish}</span>}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {isOpen && list.length === 0 && (
                        <div className="text-[11px] text-muted-foreground text-center py-1">No vendor samples yet.</div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      <GenerateSampleBatchDialog
        open={showNew}
        onOpenChange={setShowNew}
        inquiryOptions={inquiries}
        onCreated={fetchAll}
      />
      <MobileFab onClick={() => setShowNew(true)} label="New sample batch" />
    </AppLayout>
  );
}
