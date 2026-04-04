import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, FileText, Trash2, Box, Beaker, Wrench, TreePine, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import {
  generateBoxRfq, generateChemicalRfq, generateHardwareRfq,
  generateRawPieceRfq, createRfq,
} from '@/lib/rfq-generation';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  responded: 'bg-amber-100 text-amber-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const TYPE_LABELS: Record<string, string> = {
  boxes: 'Boxes', chemicals: 'Chemicals', hardware: 'Hardware',
  raw_pieces: 'Raw Pieces', custom: 'Custom',
};

interface Props {
  projectId: string;
}

export const ProjectRfqTab = ({ projectId }: Props) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchRfqs = async () => {
    const { data } = await (supabase as any).from('rfqs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    setRfqs(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchRfqs(); }, [projectId]);

  const handleGenerate = async (type: string) => {
    setGenerating(true);
    try {
      let result;
      switch (type) {
        case 'boxes':
          result = await generateBoxRfq(projectId);
          break;
        case 'chemicals':
          result = await generateChemicalRfq(projectId);
          break;
        case 'hardware':
          result = await generateHardwareRfq(projectId);
          break;
        case 'raw_pieces':
          result = await generateRawPieceRfq(projectId);
          break;
        case 'custom':
          result = { title: 'Custom RFQ', items: [], discount: 0.10 };
          break;
        default:
          return;
      }

      const { rfqId, error } = await createRfq(projectId, type, result.title, result.items, result.discount, user?.id);
      if (error) { toast.error(error); return; }
      toast.success(`${TYPE_LABELS[type]} RFQ created with ${result.items.length} items`);
      if (rfqId) navigate(`/rfq/${rfqId}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate RFQ');
    } finally {
      setGenerating(false);
    }
  };

  const deleteRfq = async (rfqId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this RFQ?')) return;
    const { error } = await (supabase as any).from('rfqs').delete().eq('id', rfqId);
    if (error) { toast.error(error.message); return; }
    toast.success('RFQ deleted');
    fetchRfqs();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5" disabled={generating}>
              <Plus className="h-4 w-4" /> {generating ? 'Generating...' : 'Generate RFQ'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleGenerate('boxes')} className="gap-2 text-xs">
              <Box className="h-3.5 w-3.5" /> Box RFQ (IC & MC)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleGenerate('chemicals')} className="gap-2 text-xs">
              <Beaker className="h-3.5 w-3.5" /> Chemical RFQ
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleGenerate('hardware')} className="gap-2 text-xs">
              <Wrench className="h-3.5 w-3.5" /> Hardware RFQ
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleGenerate('raw_pieces')} className="gap-2 text-xs">
              <TreePine className="h-3.5 w-3.5" /> Raw Piece RFQ
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleGenerate('custom')} className="gap-2 text-xs">
              <PenLine className="h-3.5 w-3.5" /> Custom RFQ (Blank)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
      ) : rfqs.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No RFQs for this project yet.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">RFQ #</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Title</TableHead>
                  <TableHead className="text-xs">Vendor</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Date</TableHead>
                  <TableHead className="text-xs w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfqs.map((r: any) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/rfq/${r.id}`)}>
                    <TableCell className="text-xs font-medium">{r.rfq_number || '—'}</TableCell>
                    <TableCell className="text-xs">{TYPE_LABELS[r.rfq_type] || r.rfq_type}</TableCell>
                    <TableCell className="text-xs">{r.title || '—'}</TableCell>
                    <TableCell className="text-xs">{r.vendor_name || '—'}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[r.status] || ''} variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => deleteRfq(r.id, e)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
