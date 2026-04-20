import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Upload, Loader2, Sparkles, FileSpreadsheet, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const ACCEPTED = ['.csv', '.xlsx', '.xls'];
const MAX_SIZE = 10 * 1024 * 1024;

interface ParsedCustomer {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  linkedin_url: string | null;
  source: string | null;
  lead_status: string;
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
  selected: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported: () => void;
}

export function CustomerImportDialog({ open, onOpenChange, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<ParsedCustomer[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setFile(null); setParsed([]); setDetectedColumns({}); setParsing(false); setImporting(false); };

  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  const onPick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_SIZE) { toast.error('File exceeds 10MB'); return; }
    const ext = '.' + f.name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED.includes(ext)) { toast.error('Unsupported file type. Use CSV or XLSX.'); return; }
    setFile(f);
    setParsed([]);
  };

  const fileToBase64 = (f: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    try {
      const data = await fileToBase64(file);
      const { data: result, error } = await supabase.functions.invoke('parse-customer-upload', {
        body: { file: { name: file.name, data } },
      });
      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);
      const customers = (result?.customers || []).map((c: any) => ({
        name: c.name || '(missing)',
        email: c.email || null,
        phone: c.phone || null,
        company: c.company || null,
        linkedin_url: c.linkedin_url || null,
        source: c.source || null,
        lead_status: ['lead', 'active', 'inactive', 'churned'].includes(c.lead_status) ? c.lead_status : 'lead',
        notes: c.notes || null,
        confidence: c.confidence || 'medium',
        selected: c.name && c.name !== '(missing)',
      }));
      setParsed(customers);
      setDetectedColumns(result?.detected_columns || {});
      if (customers.length === 0) toast.error('No customers found in file');
    } catch (e: any) {
      toast.error(e.message || 'Failed to parse');
    } finally {
      setParsing(false);
    }
  };

  const update = (i: number, field: keyof ParsedCustomer, value: any) => {
    setParsed(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  };

  const handleImport = async () => {
    const toImport = parsed.filter(p => p.selected && p.name && p.name !== '(missing)');
    if (toImport.length === 0) { toast.error('Nothing selected'); return; }
    setImporting(true);
    const rows = toImport.map(p => ({
      name: p.name.trim(),
      email: p.email?.trim() || null,
      phone: p.phone?.trim() || null,
      company: p.company?.trim() || null,
      linkedin_url: p.linkedin_url?.trim() || null,
      source: p.source?.trim() || null,
      lead_status: p.lead_status,
      notes: p.notes?.trim() || null,
    }));
    const { error } = await (supabase as any).from('customers').insert(rows);
    setImporting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Imported ${rows.length} customer${rows.length === 1 ? '' : 's'}`);
    onImported();
    close(false);
  };

  const selectedCount = parsed.filter(p => p.selected).length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Import Customers from CSV / XLSX
          </DialogTitle>
        </DialogHeader>

        {!parsed.length && (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 gap-3">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0])}
            />
            {file ? (
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="font-medium">{file.name}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFile(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drop your CSV or XLSX export here</p>
                <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                  Choose file
                </Button>
                <p className="text-xs text-muted-foreground">Supports Apollo, Waalaxy, LinkedIn, HubSpot exports — AI maps the columns automatically.</p>
              </>
            )}
            {file && (
              <Button onClick={handleParse} disabled={parsing} className="mt-2 gap-2">
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {parsing ? 'Parsing with AI...' : 'Parse with AI'}
              </Button>
            )}
          </div>
        )}

        {parsed.length > 0 && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
              <span>{parsed.length} rows parsed · {selectedCount} selected</span>
              {Object.keys(detectedColumns).length > 0 && (
                <span className="truncate max-w-md">Detected: {Object.entries(detectedColumns).map(([k, v]) => `${k}=${v}`).join(', ')}</span>
              )}
            </div>
            <ScrollArea className="flex-1 -mx-6 px-6">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b">
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 w-8">
                      <Checkbox
                        checked={selectedCount === parsed.length}
                        onCheckedChange={(v) => setParsed(p => p.map(x => ({ ...x, selected: !!v && x.name !== '(missing)' })))}
                      />
                    </th>
                    <th className="py-2">Name</th>
                    <th className="py-2">Email</th>
                    <th className="py-2">Company</th>
                    <th className="py-2">LinkedIn</th>
                    <th className="py-2">Source</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((c, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="py-1.5">
                        <Checkbox checked={c.selected} disabled={c.name === '(missing)'}
                          onCheckedChange={(v) => update(i, 'selected', !!v)} />
                      </td>
                      <td className="py-1.5">
                        <Input value={c.name} onChange={(e) => update(i, 'name', e.target.value)}
                          className="h-7 text-xs" />
                      </td>
                      <td className="py-1.5">
                        <Input value={c.email || ''} onChange={(e) => update(i, 'email', e.target.value)}
                          className="h-7 text-xs" />
                      </td>
                      <td className="py-1.5">
                        <Input value={c.company || ''} onChange={(e) => update(i, 'company', e.target.value)}
                          className="h-7 text-xs" />
                      </td>
                      <td className="py-1.5 max-w-[160px] truncate">
                        <Input value={c.linkedin_url || ''} onChange={(e) => update(i, 'linkedin_url', e.target.value)}
                          className="h-7 text-xs" />
                      </td>
                      <td className="py-1.5">
                        <Input value={c.source || ''} onChange={(e) => update(i, 'source', e.target.value)}
                          className="h-7 text-xs w-24" />
                      </td>
                      <td className="py-1.5">
                        <Badge variant="secondary" className="text-[10px]">{c.lead_status}</Badge>
                      </td>
                      <td className="py-1.5">
                        <Badge variant={c.confidence === 'high' ? 'default' : 'outline'} className="text-[10px] capitalize">
                          {c.confidence}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <div className="flex justify-between pt-2 border-t">
              <Button variant="ghost" size="sm" onClick={reset}>Start over</Button>
              <Button onClick={handleImport} disabled={importing || selectedCount === 0} className="gap-2">
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {selectedCount} customer{selectedCount === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
