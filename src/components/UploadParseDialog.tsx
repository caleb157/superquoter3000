import { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Upload, X, FileText, FileSpreadsheet, Image, Loader2, Sparkles, AlertTriangle, ChevronDown, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';

const ACCEPTED_TYPES = ['.jpg', '.jpeg', '.png', '.pdf', '.xlsx', '.xls'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 10;
const LARGE_PDF_THRESHOLD = 5 * 1024 * 1024; // 5MB

interface HardwareItem {
  item: string;
  quantity_per_product: number;
  notes?: string;
  matched_price?: number;
  matched_units?: string;
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
  finishing_difficulty: string | null;
  percent_wood: number | null;
  is_component: boolean;
  hardware_detected: HardwareItem[];
  construction_notes: string | null;
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
  source_file: string;
  selected: boolean;
  useAsPhoto: boolean;
  sourceFileData?: string;
  sourceFileType?: string;
  _expanded?: boolean;
  // Structured intake fields
  cogs_rows?: any[];
  sourced_externally?: boolean;
  ic_type?: string | null;
  products_per_ic?: number | null;
  ic_width?: number | null;
  ic_depth?: number | null;
  ic_height?: number | null;
  include_mc?: boolean | null;
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
  status?: 'pending' | 'parsing' | 'done' | 'error';
  error?: string;
};

export function UploadParseDialog({ open, onOpenChange, projectId, productTypes, onProductsCreated }: UploadParseDialogProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [parsePercent, setParsePercent] = useState(0);
  const [parsedProducts, setParsedProducts] = useState<ParsedProduct[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [hardwarePrices, setHardwarePrices] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]);
    setParsing(false);
    setParseProgress('');
    setParsePercent(0);
    setParsedProducts([]);
    setShowReview(false);
    setImporting(false);
    setHardwarePrices([]);
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
        toast.error(`${f.name} exceeds 20MB limit`);
        continue;
      }
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (!ACCEPTED_TYPES.includes(ext)) {
        toast.error(`${f.name}: unsupported file type`);
        continue;
      }
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      valid.push({ file: f, preview, status: 'pending' });
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

  // Convert PDF pages to images using canvas (pdfjs-dist alternative using canvas rendering)
  const pdfToPageImages = async (file: File): Promise<{ data: string; pageNum: number }[]> => {
    // Dynamic import of pdfjs-dist
    const pdfjsLib = await import('pdfjs-dist');
    // Set worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: { data: string; pageNum: number }[] = [];
    
    const maxPages = Math.min(pdf.numPages, 10); // Limit to 10 pages
    
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 }); // ~1200px width for most PDFs
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      
      await page.render({ canvasContext: ctx, viewport }).promise;
      
      // Convert to JPEG base64
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const b64 = dataUrl.split(',')[1];
      pages.push({ data: b64, pageNum: i });
      
      canvas.remove();
    }
    
    return pages;
  };

  const updateFileStatus = (idx: number, status: FileEntry['status'], error?: string) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, status, error } : f));
  };

  const handleParse = async () => {
    setParsing(true);
    const allProducts: ParsedProduct[] = [];
    const failedFiles: string[] = [];
    
    // Fetch hardware prices upfront for matching
    const { data: hwPrices } = await supabase.from('hardware_prices').select('*');
    setHardwarePrices(hwPrices || []);

    for (let i = 0; i < files.length; i++) {
      const f = files[i].file;
      const progressPct = Math.round(((i) / files.length) * 100);
      setParsePercent(progressPct);
      setParseProgress(`Parsing file ${i + 1} of ${files.length}: ${f.name}`);
      updateFileStatus(i, 'parsing');

      try {
        let filePayload: any;
        let imageDataMap: { data: string; type: string } | undefined;

        if (f.name.match(/\.(xlsx|xls)$/i)) {
          // Send raw base64 so edge function can parse XLSX structure
          const b64 = await fileToBase64(f);
          filePayload = { data: b64, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name: f.name };
        } else if (f.name.match(/\.pdf$/i)) {
          if (f.size > LARGE_PDF_THRESHOLD) {
            // Large PDF: convert pages to images client-side
            setParseProgress(`Converting PDF pages to images: ${f.name}...`);
            try {
              const pages = await pdfToPageImages(f);
              filePayload = { pages, type: 'application/pdf', name: f.name };
            } catch (pdfErr) {
              console.error('PDF rendering failed, sending raw:', pdfErr);
              const b64 = await fileToBase64(f);
              filePayload = { data: b64, type: f.type, name: f.name };
            }
          } else {
            // Small PDF: try page rendering too for better results
            try {
              const pages = await pdfToPageImages(f);
              filePayload = { pages, type: 'application/pdf', name: f.name };
            } catch {
              const b64 = await fileToBase64(f);
              filePayload = { data: b64, type: f.type, name: f.name };
            }
          }
        } else {
          const b64 = await fileToBase64(f);
          filePayload = { data: b64, type: f.type, name: f.name };
          if (f.type.startsWith('image/')) {
            imageDataMap = { data: b64, type: f.type };
          }
        }

        setParseProgress(`Analyzing with AI: ${f.name}...`);

        const { data, error } = await supabase.functions.invoke('parse-product-upload', {
          body: { files: [filePayload] },
        });

        if (error) throw new Error(error.message || 'AI parsing failed');

        if (data?.errors?.length) {
          data.errors.forEach((e: string) => toast.warning(e));
        }

        if (data?.products?.length) {
          const products: ParsedProduct[] = data.products.map((p: any) => {
            // Match hardware items against hardware_prices
            const hw = (p.hardware_detected || p.hardware_guess || []).map((h: any) => {
              const matched = (hwPrices || []).find((hp: any) =>
                hp.name.toLowerCase().includes((h.item || h.type || '').toLowerCase()) ||
                (h.item || h.type || '').toLowerCase().includes(hp.name.toLowerCase())
              );
              return {
                item: h.item || h.type || 'Unknown',
                quantity_per_product: h.quantity_per_product || 1,
                notes: h.notes || '',
                matched_price: matched?.unit_cost_inr,
                matched_units: matched?.units,
              };
            });

            return {
              name: p.name || 'Unknown Product',
              sku: p.sku || null,
              width_inch: p.width_inch || null,
              depth_inch: p.depth_inch || null,
              height_inch: p.height_inch || null,
              weight_kg: p.weight_kg || null,
              quantity: p.quantity || null,
              product_type: p.product_type || null,
              material_guess: p.material_guess || null,
              target_price_usd: p.target_price_usd || null,
              finishing_difficulty: p.finishing_difficulty || null,
              percent_wood: p.percent_wood || null,
              is_component: p.is_component || false,
              hardware_detected: hw,
              construction_notes: p.construction_notes || null,
              notes: p.notes || null,
              confidence: p.confidence || 'low',
              source_file: p.source_file || f.name,
              selected: true,
              useAsPhoto: !!imageDataMap,
              sourceFileData: imageDataMap?.data,
              sourceFileType: imageDataMap?.type,
              _expanded: false,
              // Structured intake fields
              cogs_rows: p.cogs_rows || undefined,
              sourced_externally: p.sourced_externally || false,
              ic_type: p.ic_type || null,
              products_per_ic: p.products_per_ic || null,
              ic_width: p.ic_width || null,
              ic_depth: p.ic_depth || null,
              ic_height: p.ic_height || null,
              include_mc: p.include_mc ?? null,
            };
          });
          allProducts.push(...products);
        }

        updateFileStatus(i, 'done');
      } catch (err: any) {
        console.error(`Failed to parse ${f.name}:`, err);
        updateFileStatus(i, 'error', err.message);
        failedFiles.push(f.name);
        // Continue with next file
      }
    }

    setParsePercent(100);

    if (failedFiles.length > 0) {
      toast.error(`Failed to parse: ${failedFiles.join(', ')}`);
    }

    if (allProducts.length > 0) {
      setParsedProducts(allProducts);
      setShowReview(true);
    } else {
      toast.error('No products found in uploaded files');
    }

    setParsing(false);
    setParseProgress('');
  };

  const updateParsed = (idx: number, field: string, value: any) => {
    setParsedProducts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const toggleExpanded = (idx: number) => {
    setParsedProducts(prev => prev.map((p, i) => i === idx ? { ...p, _expanded: !p._expanded } : p));
  };

  const selectedCount = parsedProducts.filter(p => p.selected).length;

  const handleImport = async () => {
    setImporting(true);
    try {
      const toImport = parsedProducts.filter(p => p.selected);
      let created = 0;

      // Use already-fetched hardware prices
      const hwPrices = hardwarePrices;

      for (const p of toImport) {
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
          finishing_difficulty: p.finishing_difficulty || 'Medium',
          percent_wood: p.percent_wood || 1,
          is_component: p.is_component || false,
          sourced_externally: p.sourced_externally || false,
          notes: [
            p.material_guess ? `Material: ${p.material_guess}` : '',
            p.construction_notes ? `Construction: ${p.construction_notes}` : '',
            p.notes || '',
          ].filter(Boolean).join('. '),
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

        // COGS: use structured cogs_rows if present, otherwise build defaults
        if (p.cogs_rows && p.cogs_rows.length > 0) {
          // Always include a Raw Piece row at the top if the intake sheet didn't have one
          const hasRawPiece = p.cogs_rows.some((cr: any) => (cr.cogs_type || '').toLowerCase().includes('raw piece'));
          const rawPieceRow = hasRawPiece ? [] : [{
            product_id: prod.id,
            cogs_type: 'Raw Piece',
            component_name: 'Raw Piece 1',
            include: 'Yes',
            units: 'cft',
            components_per_product: 0,
            unit_cost_inr: 0,
            waste_factor: 0.1,
            is_auto_calculated: false,
            sort_order: 0,
          }];
          const offset = rawPieceRow.length;
          const structuredCogs = p.cogs_rows.map((cr: any, idx: number) => ({
            product_id: prod.id,
            cogs_type: cr.cogs_type || 'Raw Piece',
            component_name: cr.component_name || null,
            include: cr.include ?? 'Yes',
            units: cr.units || 'pc',
            components_per_product: cr.components_per_product ?? 0,
            unit_cost_inr: cr.unit_cost_inr ?? 0,
            waste_factor: cr.waste_factor ?? 0,
            is_auto_calculated: false,
            sort_order: idx + offset,
          }));
          await supabase.from('cogs_items').insert([...rawPieceRow, ...structuredCogs] as any);
        } else {
          // Build hardware COGS from AI detection
          const hardwareCogs: any[] = [];
          const hardware = p.hardware_detected || [];
          hardware.forEach((hw, idx) => {
            const matchedPrice = hwPrices.find(hp =>
              hp.name.toLowerCase().includes(hw.item.toLowerCase()) ||
              hw.item.toLowerCase().includes(hp.name.toLowerCase())
            );
            hardwareCogs.push({
              product_id: prod.id,
              cogs_type: 'Hardware',
              component_name: hw.item + (hw.notes ? ` (${hw.notes})` : ''),
              components_per_product: hw.quantity_per_product || 1,
              unit_cost_inr: matchedPrice?.unit_cost_inr || 0,
              units: matchedPrice?.units || 'pc',
              waste_factor: 0.05,
              is_auto_calculated: !!matchedPrice,
              vendor_name: matchedPrice ? `Auto: ${matchedPrice.name}` : null,
              sort_order: 10 + idx,
            });
          });

          const hwRows = hardwareCogs.length > 0 ? hardwareCogs : [
            { product_id: prod.id, cogs_type: 'Hardware', component_name: 'Hardware 1', waste_factor: 0.05, sort_order: 10 },
            { product_id: prod.id, cogs_type: 'Hardware', component_name: 'Hardware 2', waste_factor: 0.05, sort_order: 11 },
          ];

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
            ...hwRows,
            { product_id: prod.id, cogs_type: 'Accessories', component_name: 'Accessory 1', waste_factor: 0.05, sort_order: 20 },
            { product_id: prod.id, cogs_type: 'Accessories', component_name: 'Accessory 2', waste_factor: 0.05, sort_order: 21 },
          ];
          await supabase.from('cogs_items').insert(defaultCogs as any);
        }

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

        // CBM estimates — include IC/MC data from structured intake if present
        const cbmData: any = { product_id: prod.id };
        if (p.ic_type) cbmData.ic_type = p.ic_type;
        if (p.products_per_ic != null) cbmData.products_per_ic = p.products_per_ic;
        if (p.ic_width != null) cbmData.ic_width = p.ic_width;
        if (p.ic_depth != null) cbmData.ic_depth = p.ic_depth;
        if (p.ic_height != null) cbmData.ic_height = p.ic_height;
        if (p.include_mc != null) cbmData.include_mc = p.include_mc;
        await supabase.from('cbm_estimates').insert(cbmData as any);

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

  const statusIcon = (status?: string) => {
    if (status === 'parsing') return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
    if (status === 'done') return <span className="text-green-500 text-xs">✓</span>;
    if (status === 'error') return <AlertTriangle className="h-3 w-3 text-red-500" />;
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] flex flex-col">
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
                Accepted: JPG, PNG, PDF, XLSX, XLS · Max 20MB per file · Up to 10 files
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
                    {statusIcon(f.status)}
                    {f.error && <span className="text-[10px] text-red-500 truncate max-w-[120px]" title={f.error}>{f.error}</span>}
                    {!parsing && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(i)}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Progress bar */}
            {parsing && (
              <div className="space-y-2">
                <Progress value={parsePercent} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">{parseProgress}</p>
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
                    Parsing...
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
            <p className="text-sm text-muted-foreground mb-3">
              Found {parsedProducts.length} products · Review and edit before importing · Click a row to see hardware details
            </p>
            <ScrollArea className="flex-1 border rounded-md">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2.5 text-left w-10">✓</th>
                      <th className="px-3 py-2.5 text-left min-w-[100px]">Source</th>
                      <th className="px-3 py-2.5 text-left min-w-[180px]">Name</th>
                      <th className="px-3 py-2.5 text-left w-24">SKU</th>
                      <th className="px-3 py-2.5 text-right w-16">W</th>
                      <th className="px-3 py-2.5 text-right w-16">D</th>
                      <th className="px-3 py-2.5 text-right w-16">H</th>
                      <th className="px-3 py-2.5 text-right w-16">Qty</th>
                      <th className="px-3 py-2.5 text-left min-w-[140px]">Type</th>
                      <th className="px-3 py-2.5 text-left w-24">Difficulty</th>
                      <th className="px-3 py-2.5 text-right w-20">Target $</th>
                      <th className="px-3 py-2.5 text-left w-32">Hardware</th>
                      <th className="px-3 py-2.5 text-center w-16">Conf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedProducts.map((p, i) => (
                      <>
                        <tr
                          key={`row-${i}`}
                          className={`border-t cursor-pointer hover:bg-muted/30 ${p.confidence === 'low' ? 'border-l-2 border-l-red-400' : p.confidence === 'medium' ? 'border-l-2 border-l-yellow-400' : ''}`}
                          onClick={() => toggleExpanded(i)}
                        >
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Checkbox checked={p.selected} onCheckedChange={v => updateParsed(i, 'selected', !!v)} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {fileIcon(p.source_file)}
                              <span className="truncate max-w-[90px] text-xs" title={p.source_file}>{p.source_file}</span>
                            </div>
                            {p.sourceFileData && (
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1 cursor-pointer" onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={p.useAsPhoto}
                                  onChange={e => updateParsed(i, 'useAsPhoto', e.target.checked)}
                                  className="h-3 w-3"
                                />
                                Use as photo
                              </label>
                            )}
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Input className="h-8 text-sm" value={p.name} onChange={e => updateParsed(i, 'name', e.target.value)} />
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Input className="h-8 text-sm" value={p.sku || ''} onChange={e => updateParsed(i, 'sku', e.target.value)} />
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Input className="h-8 text-sm text-right w-16" type="number" value={p.width_inch ?? ''} onChange={e => updateParsed(i, 'width_inch', e.target.value ? Number(e.target.value) : null)} />
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Input className="h-8 text-sm text-right w-16" type="number" value={p.depth_inch ?? ''} onChange={e => updateParsed(i, 'depth_inch', e.target.value ? Number(e.target.value) : null)} />
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Input className="h-8 text-sm text-right w-16" type="number" value={p.height_inch ?? ''} onChange={e => updateParsed(i, 'height_inch', e.target.value ? Number(e.target.value) : null)} />
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Input className="h-8 text-sm text-right w-16" type="number" value={p.quantity ?? ''} onChange={e => updateParsed(i, 'quantity', e.target.value ? parseInt(e.target.value) : null)} />
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Select value={p.product_type || ''} onValueChange={v => updateParsed(i, 'product_type', v)}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Type" /></SelectTrigger>
                              <SelectContent>
                                {productTypes.map(pt => (
                                  <SelectItem key={pt.id} value={pt.name}>{pt.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-sm">{p.finishing_difficulty || '—'}</span>
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <Input className="h-8 text-sm text-right w-20" type="number" value={p.target_price_usd ?? ''} onChange={e => updateParsed(i, 'target_price_usd', e.target.value ? Number(e.target.value) : null)} />
                          </td>
                          <td className="px-3 py-2">
                            {p.hardware_detected.length > 0 ? (
                              <div className="flex items-center gap-1.5">
                                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs">{p.hardware_detected.length} items</span>
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${p._expanded ? '' : '-rotate-90'}`} />
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">None</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {confidenceBadge(p.confidence)}
                          </td>
                        </tr>
                        {/* Expanded hardware & construction details */}
                        {p._expanded && (
                          <tr key={`detail-${i}`} className="bg-muted/20">
                            <td colSpan={13} className="p-3">
                              <div className="grid grid-cols-2 gap-4">
                                {/* Hardware */}
                                <div>
                                  <h4 className="text-[10px] font-semibold uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
                                    <Wrench className="h-3 w-3" /> Detected Hardware
                                  </h4>
                                  {p.hardware_detected.length > 0 ? (
                                    <table className="w-full text-[10px]">
                                      <thead>
                                        <tr className="text-muted-foreground">
                                          <th className="text-left pb-1">Item</th>
                                          <th className="text-right pb-1">Qty/Prod</th>
                                          <th className="text-left pb-1">Spec</th>
                                          <th className="text-right pb-1">Est. Cost (₹)</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {p.hardware_detected.map((hw, hi) => (
                                          <tr key={hi} className="border-t border-border/30">
                                            <td className="py-0.5">{hw.item}</td>
                                            <td className="text-right py-0.5">{hw.quantity_per_product}</td>
                                            <td className="py-0.5 text-muted-foreground">{hw.notes || '—'}</td>
                                            <td className="text-right py-0.5">
                                              {hw.matched_price ? (
                                                <span className="text-green-600">₹{hw.matched_price}/{hw.matched_units || 'pc'}</span>
                                              ) : (
                                                <span className="text-muted-foreground">—</span>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <p className="text-[10px] text-muted-foreground">No hardware detected</p>
                                  )}
                                </div>
                                {/* Construction & other details */}
                                <div className="space-y-2">
                                  {p.construction_notes && (
                                    <div>
                                      <h4 className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Construction Notes</h4>
                                      <p className="text-[10px] text-foreground">{p.construction_notes}</p>
                                    </div>
                                  )}
                                  <div className="flex gap-3">
                                    {p.finishing_difficulty && (
                                      <div>
                                        <span className="text-[9px] text-muted-foreground">Finishing:</span>{' '}
                                        <Badge variant="secondary" className="text-[9px] px-1 py-0">{p.finishing_difficulty}</Badge>
                                      </div>
                                    )}
                                    {p.percent_wood != null && (
                                      <div>
                                        <span className="text-[9px] text-muted-foreground">Wood:</span>{' '}
                                        <span className="text-[10px]">{Math.round(p.percent_wood * 100)}%</span>
                                      </div>
                                    )}
                                    {p.material_guess && (
                                      <div>
                                        <span className="text-[9px] text-muted-foreground">Material:</span>{' '}
                                        <span className="text-[10px]">{p.material_guess}</span>
                                      </div>
                                    )}
                                  </div>
                                  {p.notes && (
                                    <div>
                                      <h4 className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Notes</h4>
                                      <p className="text-[10px] text-foreground">{p.notes}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
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
