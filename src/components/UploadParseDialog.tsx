import { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, X, FileText, FileSpreadsheet, Image, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';

const ACCEPTED_TYPES = ['.jpg', '.jpeg', '.png', '.pdf', '.xlsx', '.xls'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 10;

interface HardwareGuess {
  type: string;
  quantity_per_product: number;
  notes?: string;
}

interface ParsedProduct {
  name: string;
  sku: string | null;
  width_inch: number | null;
  depth_inch: number | null;
  height_inch: number | null;
  weight_kg: number | null;
  quantity: number | null;
  product_type: string | null;
  material_guess: string | null;
  target_price_usd: number | null;
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
  source_file: string;
  selected: boolean;
  useAsPhoto: boolean;
  sourceFileData?: string;
  sourceFileType?: string;
  hardware_guess: HardwareGuess[];
}

interface UploadParseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  productTypes: { id: string; name: string }[];
  onProductsCreated: () => void;
}

type FileEntry = {
  file: File;
  preview?: string;
};

export function UploadParseDialog({ open, onOpenChange, projectId, productTypes, onProductsCreated }: UploadParseDialogProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [parsedProducts, setParsedProducts] = useState<ParsedProduct[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]);
    setParsing(false);
    setParseProgress('');
    setParsedProducts([]);
    setShowReview(false);
    setImporting(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const addFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    const valid: FileEntry[] = [];
    for (const f of arr) {
      if (files.length + valid.length >= MAX_FILES) {
        toast.error(`Maximum ${MAX_FILES} files allowed`);
        break;
      }
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`${f.name} exceeds 10MB limit`);
        continue;
      }
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (!ACCEPTED_TYPES.includes(ext)) {
        toast.error(`${f.name}: unsupported file type`);
        continue;
      }
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      valid.push({ file: f, preview });
    }
    setFiles(prev => [...prev, ...valid]);
  };

  const removeFile = (idx: number) => {
    setFiles(prev => {
      const copy = [...prev];
      if (copy[idx].preview) URL.revokeObjectURL(copy[idx].preview!);
      copy.splice(idx, 1);
      return copy;
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }, [files]);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const xlsxToText = async (file: File): Promise<string> => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    let csv = '';
    for (const name of wb.SheetNames) {
      csv += `--- Sheet: ${name} ---\n`;
      csv += XLSX.utils.sheet_to_csv(wb.Sheets[name]) + '\n\n';
    }
    return csv;
  };

  const handleParse = async () => {
    setParsing(true);
    try {
      const filesToSend: any[] = [];
      const imageDataMap: Record<string, { data: string; type: string }> = {};

      for (let i = 0; i < files.length; i++) {
        const f = files[i].file;
        setParseProgress(`Processing file ${i + 1} of ${files.length}...`);

        if (f.name.match(/\.(xlsx|xls)$/i)) {
          const text = await xlsxToText(f);
          filesToSend.push({ data: text, type: 'text/csv', name: f.name });
        } else {
          const b64 = await fileToBase64(f);
          filesToSend.push({ data: b64, type: f.type, name: f.name });
          if (f.type.startsWith('image/')) {
            imageDataMap[f.name] = { data: b64, type: f.type };
          }
        }
      }

      setParseProgress('Analyzing files with AI...');

      const { data, error } = await supabase.functions.invoke('parse-product-upload', {
        body: { files: filesToSend },
      });

      if (error) throw new Error(error.message || 'AI parsing failed');
      if (!data?.products?.length) {
        toast.error('No products found in uploaded files');
        setParsing(false);
        return;
      }

      const products: ParsedProduct[] = data.products.map((p: any) => ({
        ...p,
        selected: true,
        useAsPhoto: !!imageDataMap[p.source_file],
        sourceFileData: imageDataMap[p.source_file]?.data,
        sourceFileType: imageDataMap[p.source_file]?.type,
        hardware_guess: p.hardware_guess || [],
      }));

      setParsedProducts(products);
      setShowReview(true);
    } catch (err: any) {
      toast.error(`Parse failed: ${err.message}`);
    }
    setParsing(false);
    setParseProgress('');
  };

  const updateParsed = (idx: number, field: string, value: any) => {
    setParsedProducts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const selectedCount = parsedProducts.filter(p => p.selected).length;

  const handleImport = async () => {
    setImporting(true);
    try {
      const toImport = parsedProducts.filter(p => p.selected);
      let created = 0;

      for (const p of toImport) {
        // Match product type
        const matchedType = productTypes.find(pt =>
          pt.name.toLowerCase() === (p.product_type || '').toLowerCase()
        );

        const { data: prod, error } = await supabase.from('products').insert({
          project_id: projectId,
          name: p.name || 'Unnamed Product',
          sku: p.sku || null,
          width_inch: p.width_inch,
          depth_inch: p.depth_inch,
          height_inch: p.height_inch,
          weight_kg: p.weight_kg,
          quantity: p.quantity || 100,
          product_type_id: matchedType?.id || null,
          target_price_usd: p.target_price_usd,
          notes: [p.material_guess ? `Material: ${p.material_guess}` : '', p.notes || ''].filter(Boolean).join('. '),
          sort_order: created,
        } as any).select().single();

        if (error) { toast.error(`Failed to create ${p.name}: ${error.message}`); continue; }
        if (!prod) continue;

        // Upload photo if applicable
        if (p.useAsPhoto && p.sourceFileData && p.sourceFileType) {
          try {
            const ext = p.sourceFileType.split('/')[1] || 'jpg';
            const path = `${prod.id}.${ext}`;
            const bytes = Uint8Array.from(atob(p.sourceFileData), c => c.charCodeAt(0));
            const { error: uploadErr } = await supabase.storage.from('product-photos').upload(path, bytes, {
              contentType: p.sourceFileType,
              upsert: true,
            });
            if (!uploadErr) {
              const { data: urlData } = supabase.storage.from('product-photos').getPublicUrl(path);
              await supabase.from('products').update({ photo_url: urlData.publicUrl } as any).eq('id', prod.id);
            }
          } catch (e) { console.error('Photo upload failed:', e); }
        }

        // Create default BOM rows
        const defaultCogs = [
          { product_id: prod.id, cogs_type: 'Raw Piece', component_name: 'Raw Piece 1', sort_order: 0 },
          { product_id: prod.id, cogs_type: 'Raw Piece', component_name: 'Raw Piece 2', sort_order: 1 },
          { product_id: prod.id, cogs_type: 'Subcontracting', component_name: 'Subcontracting 1', sort_order: 2 },
          { product_id: prod.id, cogs_type: 'Subcontracting', component_name: 'Subcontracting 2', sort_order: 3 },
          { product_id: prod.id, cogs_type: 'Finishing Materials', component_name: 'Color', is_auto_calculated: true, sort_order: 4 },
          { product_id: prod.id, cogs_type: 'Finishing Materials', component_name: 'Sealer', is_auto_calculated: true, sort_order: 5 },
          { product_id: prod.id, cogs_type: 'Finishing Materials', component_name: 'Lacquer', is_auto_calculated: true, sort_order: 6 },
          { product_id: prod.id, cogs_type: 'Packaging', component_name: 'IC Box', is_auto_calculated: true, waste_factor: 0.05, sort_order: 7 },
          { product_id: prod.id, cogs_type: 'Packaging', component_name: 'MC Box', is_auto_calculated: true, sort_order: 8 },
          { product_id: prod.id, cogs_type: 'Packaging', component_name: 'Other Packaging', sort_order: 9 },
          { product_id: prod.id, cogs_type: 'Hardware', component_name: 'Hardware 1', waste_factor: 0.05, sort_order: 10 },
          { product_id: prod.id, cogs_type: 'Hardware', component_name: 'Hardware 2', waste_factor: 0.05, sort_order: 11 },
          { product_id: prod.id, cogs_type: 'Accessories', component_name: 'Accessory 1', waste_factor: 0.05, sort_order: 12 },
          { product_id: prod.id, cogs_type: 'Accessories', component_name: 'Accessory 2', waste_factor: 0.05, sort_order: 13 },
        ];
        await supabase.from('cogs_items').insert(defaultCogs as any);

        const defaultOverhead = [
          { product_id: prod.id, labor_type: 'Manufacturing', sort_order: 0 },
          { product_id: prod.id, labor_type: 'QC', man_hours_per_unit: 0.05, sort_order: 1 },
          { product_id: prod.id, labor_type: 'Sanding', sort_order: 2 },
          { product_id: prod.id, labor_type: 'Finishing', is_auto_estimated: true, sort_order: 3 },
          { product_id: prod.id, labor_type: 'Assembly', sort_order: 4 },
          { product_id: prod.id, labor_type: 'Packaging', is_auto_estimated: true, sort_order: 5 },
          { product_id: prod.id, labor_type: 'Market', sort_order: 6 },
        ];
        await supabase.from('overhead_items').insert(defaultOverhead as any);
        await supabase.from('cbm_estimates').insert({ product_id: prod.id } as any);
        await supabase.from('non_unit_cogs').insert({
          product_id: prod.id, name: 'Auto Transport', total_quantity: 1, cost_each_inr: 0, include: 'Yes', sort_order: 0,
        } as any);

        created++;
      }

      toast.success(`Created ${created} products from upload`);
      onProductsCreated();
      handleClose(false);
    } catch (err: any) {
      toast.error(`Import failed: ${err.message}`);
    }
    setImporting(false);
  };

  const confidenceBadge = (c: string) => {
    const colors: Record<string, string> = {
      high: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      low: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[c] || colors.low}`}>{c}</span>;
  };

  const fileIcon = (name: string) => {
    if (name.match(/\.(jpg|jpeg|png)$/i)) return <Image className="h-4 w-4 text-blue-500" />;
    if (name.match(/\.pdf$/i)) return <FileText className="h-4 w-4 text-red-500" />;
    return <FileSpreadsheet className="h-4 w-4 text-green-500" />;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Upload & Parse Products
          </DialogTitle>
        </DialogHeader>

        {!showReview ? (
          <div className="space-y-4">
            {/* Drop zone */}
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drop product images, spec sheets, or spreadsheets here — or click to browse
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Accepted: JPG, PNG, PDF, XLSX, XLS · Max 10MB per file · Up to 10 files
              </p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept={ACCEPTED_TYPES.join(',')}
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded text-sm">
                    {f.preview ? (
                      <img src={f.preview} className="h-8 w-8 object-cover rounded" />
                    ) : (
                      fileIcon(f.file.name)
                    )}
                    <span className="flex-1 truncate text-xs">{f.file.name}</span>
                    <span className="text-[10px] text-muted-foreground">{(f.file.size / 1024).toFixed(0)} KB</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(i)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
              <Button
                onClick={handleParse}
                disabled={files.length === 0 || parsing}
                className="gap-2"
              >
                {parsing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {parseProgress || 'Parsing...'}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Parse with AI
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <p className="text-xs text-muted-foreground mb-2">
              Found {parsedProducts.length} products · Review and edit before importing
            </p>
            <ScrollArea className="flex-1 border rounded-md">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="p-1.5 text-left w-8">✓</th>
                      <th className="p-1.5 text-left">Source</th>
                      <th className="p-1.5 text-left min-w-[140px]">Name</th>
                      <th className="p-1.5 text-left w-20">SKU</th>
                      <th className="p-1.5 text-right w-14">W</th>
                      <th className="p-1.5 text-right w-14">D</th>
                      <th className="p-1.5 text-right w-14">H</th>
                      <th className="p-1.5 text-right w-14">Qty</th>
                      <th className="p-1.5 text-left w-28">Type</th>
                      <th className="p-1.5 text-left w-24">Material</th>
                      <th className="p-1.5 text-right w-16">Target $</th>
                      <th className="p-1.5 text-center w-16">Conf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedProducts.map((p, i) => (
                      <tr
                        key={i}
                        className={`border-t ${p.confidence === 'low' ? 'border-l-2 border-l-red-400' : p.confidence === 'medium' ? 'border-l-2 border-l-yellow-400' : ''}`}
                      >
                        <td className="p-1.5">
                          <Checkbox checked={p.selected} onCheckedChange={v => updateParsed(i, 'selected', !!v)} />
                        </td>
                        <td className="p-1.5">
                          <div className="flex items-center gap-1">
                            {fileIcon(p.source_file)}
                            <span className="truncate max-w-[80px]" title={p.source_file}>{p.source_file}</span>
                          </div>
                          {p.sourceFileData && (
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground mt-0.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={p.useAsPhoto}
                                onChange={e => updateParsed(i, 'useAsPhoto', e.target.checked)}
                                className="h-2.5 w-2.5"
                              />
                              Use as photo
                            </label>
                          )}
                        </td>
                        <td className="p-1.5">
                          <Input className="h-6 text-xs" value={p.name} onChange={e => updateParsed(i, 'name', e.target.value)} />
                        </td>
                        <td className="p-1.5">
                          <Input className="h-6 text-xs" value={p.sku || ''} onChange={e => updateParsed(i, 'sku', e.target.value)} />
                        </td>
                        <td className="p-1.5">
                          <Input className="h-6 text-xs text-right w-12" type="number" value={p.width_inch ?? ''} onChange={e => updateParsed(i, 'width_inch', e.target.value ? Number(e.target.value) : null)} />
                        </td>
                        <td className="p-1.5">
                          <Input className="h-6 text-xs text-right w-12" type="number" value={p.depth_inch ?? ''} onChange={e => updateParsed(i, 'depth_inch', e.target.value ? Number(e.target.value) : null)} />
                        </td>
                        <td className="p-1.5">
                          <Input className="h-6 text-xs text-right w-12" type="number" value={p.height_inch ?? ''} onChange={e => updateParsed(i, 'height_inch', e.target.value ? Number(e.target.value) : null)} />
                        </td>
                        <td className="p-1.5">
                          <Input className="h-6 text-xs text-right w-12" type="number" value={p.quantity ?? ''} onChange={e => updateParsed(i, 'quantity', e.target.value ? parseInt(e.target.value) : null)} />
                        </td>
                        <td className="p-1.5">
                          <Select value={p.product_type || ''} onValueChange={v => updateParsed(i, 'product_type', v)}>
                            <SelectTrigger className="h-6 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                            <SelectContent>
                              {productTypes.map(pt => (
                                <SelectItem key={pt.id} value={pt.name}>{pt.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-1.5">
                          <Input className="h-6 text-xs" value={p.material_guess || ''} onChange={e => updateParsed(i, 'material_guess', e.target.value)} />
                        </td>
                        <td className="p-1.5">
                          <Input className="h-6 text-xs text-right w-14" type="number" value={p.target_price_usd ?? ''} onChange={e => updateParsed(i, 'target_price_usd', e.target.value ? Number(e.target.value) : null)} />
                        </td>
                        <td className="p-1.5 text-center">
                          {confidenceBadge(p.confidence)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">
                {selectedCount} of {parsedProducts.length} selected
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setShowReview(false); setParsedProducts([]); }}>
                  Back
                </Button>
                <Button onClick={handleImport} disabled={selectedCount === 0 || importing} className="gap-2">
                  {importing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</>
                  ) : (
                    `Import ${selectedCount} Products`
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
