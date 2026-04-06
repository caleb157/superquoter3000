import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import type { Tables } from '@/integrations/supabase/types';

interface Props {
  customers: Tables<'customers'>[];
  onImported: () => void;
}

interface ParsedRow {
  name: string;
  who: string;
  design_done: boolean;
  photo_done: boolean;
  rfq_date: string | null;
  initial_quote_date: string | null;
  sample_request_date: string | null;
  initial_sample_date: string | null;
  final_sample_date: string | null;
  finish: string | null;
  dimensions_inch: string | null;
  weight_kg: number | null;
  notes: string | null;
  is_foak: boolean;
  status: string;
  matched_customer_id: string | null;
  matched_customer_name: string | null;
}

function excelDate(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function PipelineImport({ customers, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: false });

    // Try to find "Quote Response" or first sheet
    const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('quote response')) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<any>(ws, { defval: null });

    const parsed: ParsedRow[] = data.map((row: any) => {
      const projectName = row['Project Name'] || row['Item'] || row['Name'] || '';
      const firstWord = projectName.split(/[\s-]+/)[0]?.toLowerCase();
      const match = customers.find(c =>
        c.name.toLowerCase().startsWith(firstWord) ||
        c.company?.toLowerCase().startsWith(firstWord)
      );

      const doneCol = row['Done'] ?? row['Done/Paused/Cancelled'] ?? null;
      let status = 'active';
      if (doneCol === 1 || doneCol === '1' || doneCol === true) status = 'done';
      const pausedCol = row['Paused'];
      if (pausedCol === 1 || pausedCol === '1' || pausedCol === true) status = 'paused';
      const cancelCol = row['Cancelled'];
      if (cancelCol === 1 || cancelCol === '1' || cancelCol === true) status = 'cancelled';

      return {
        name: projectName,
        who: row['Who?'] || row['Who'] || '',
        design_done: !!(row['Design'] || row['Design Done']),
        photo_done: !!(row['Photo'] || row['Photo Done']),
        rfq_date: excelDate(row['RFQ Date']),
        initial_quote_date: excelDate(row['Initial Quote Date'] || row['Quote Date']),
        sample_request_date: excelDate(row['Sample Request Date']),
        initial_sample_date: excelDate(row['Initial Sample Ready Date'] || row['Initial Sample Date']),
        final_sample_date: excelDate(row['Final Sample Ready Date'] || row['Final Sample Date']),
        finish: row['Finish'] || null,
        dimensions_inch: row['Dimensions'] || null,
        weight_kg: row['Weight'] ? parseFloat(row['Weight']) : null,
        notes: row['Notes'] || null,
        is_foak: !!(row['Exclude/FOAK'] || row['FOAK'] || row['Exclude']),
        status,
        matched_customer_id: match?.id ?? null,
        matched_customer_name: match?.name ?? null,
      };
    }).filter((r: ParsedRow) => r.name.trim());

    setRows(parsed);
    setOpen(true);
    e.target.value = '';
  };

  const handleImport = async () => {
    setImporting(true);
    const payload = rows.map(r => ({
      name: r.name,
      who: r.who || null,
      customer_id: r.matched_customer_id,
      design_done: r.design_done,
      photo_done: r.photo_done,
      rfq_date: r.rfq_date,
      initial_quote_date: r.initial_quote_date,
      sample_request_date: r.sample_request_date,
      initial_sample_date: r.initial_sample_date,
      final_sample_date: r.final_sample_date,
      finish: r.finish,
      dimensions_inch: r.dimensions_inch,
      weight_kg: r.weight_kg,
      notes: r.notes,
      is_foak: r.is_foak,
      status: r.status,
    }));

    const { error } = await supabase.from('pipeline_items').insert(payload);
    setImporting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Imported ${rows.length} items`);
    setOpen(false);
    setRows([]);
    onImported();
  };

  return (
    <>
      <Button variant="outline" size="sm" className="relative" asChild>
        <label className="cursor-pointer">
          <Upload className="h-3.5 w-3.5 mr-1" /> Import from Tracker
          <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleFile} />
        </label>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Preview — {rows.length} items</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border overflow-auto max-h-[55vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Customer Match</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Design</TableHead>
                  <TableHead>RFQ</TableHead>
                  <TableHead>Quote</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>FOAK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs">
                      {r.matched_customer_name ? (
                        <span className="text-emerald-600">{r.matched_customer_name}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.who || '—'}</TableCell>
                    <TableCell>{r.design_done ? <Check className="h-3 w-3 text-emerald-500" /> : <X className="h-3 w-3 text-muted-foreground/40" />}</TableCell>
                    <TableCell className="text-xs">{r.rfq_date || '—'}</TableCell>
                    <TableCell className="text-xs">{r.initial_quote_date || '—'}</TableCell>
                    <TableCell className="text-xs capitalize">{r.status}</TableCell>
                    <TableCell>{r.is_foak ? <Check className="h-3 w-3" /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? 'Importing…' : `Import ${rows.length} Items`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
