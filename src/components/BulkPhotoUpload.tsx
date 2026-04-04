import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ImagePlus, Upload, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Product {
  id: string;
  name: string;
  sku: string | null;
  photo_url: string | null;
}

interface FileMapping {
  file: File;
  previewUrl: string;
  productId: string | null;
  confidence: 'exact' | 'partial' | 'none';
}

interface BulkPhotoUploadProps {
  products: Product[];
  onPhotosUploaded: () => void;
  children: React.ReactNode;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchFileToProduct(fileName: string, products: Product[]): { productId: string | null; confidence: 'exact' | 'partial' | 'none' } {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const normFile = normalise(baseName);

  // Exact match on name or SKU
  for (const p of products) {
    if (normalise(p.name) === normFile) return { productId: p.id, confidence: 'exact' };
    if (p.sku && normalise(p.sku) === normFile) return { productId: p.id, confidence: 'exact' };
  }

  // Partial: file name contains product name or vice versa
  let bestMatch: { productId: string; score: number } | null = null;
  for (const p of products) {
    const normName = normalise(p.name);
    if (normFile.includes(normName) || normName.includes(normFile)) {
      const score = normName.length;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { productId: p.id, score };
      }
    }
    if (p.sku) {
      const normSku = normalise(p.sku);
      if (normFile.includes(normSku) || normSku.includes(normFile)) {
        const score = normSku.length + 100; // prefer SKU matches
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { productId: p.id, score };
        }
      }
    }
  }
  if (bestMatch) return { productId: bestMatch.productId, confidence: 'partial' };

  return { productId: null, confidence: 'none' };
}

export function BulkPhotoUpload({ products, onPhotosUploaded, children }: BulkPhotoUploadProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mappings, setMappings] = useState<FileMapping[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast.error('No image files found');
      return;
    }

    const newMappings: FileMapping[] = imageFiles.map(file => {
      const { productId, confidence } = matchFileToProduct(file.name, products);
      return {
        file,
        previewUrl: URL.createObjectURL(file),
        productId,
        confidence,
      };
    });

    setMappings(newMappings);
    setDialogOpen(true);
  }, [products]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  }, [processFiles]);

  const updateMapping = (index: number, productId: string | null) => {
    setMappings(prev => prev.map((m, i) => i === index ? { ...m, productId, confidence: productId ? 'exact' : 'none' } : m));
  };

  const removeMapping = (index: number) => {
    setMappings(prev => {
      const removed = prev[index];
      URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleUpload = async () => {
    const toUpload = mappings.filter(m => m.productId);
    if (toUpload.length === 0) {
      toast.error('No photos mapped to products');
      return;
    }

    setUploading(true);
    let successCount = 0;

    for (const mapping of toUpload) {
      try {
        const ext = mapping.file.name.split('.').pop() || 'jpg';
        const path = `${mapping.productId}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('product-photos')
          .upload(path, mapping.file, { contentType: mapping.file.type, upsert: true });

        if (uploadErr) {
          console.error(`Upload failed for ${mapping.file.name}:`, uploadErr);
          continue;
        }

        const { data: urlData } = supabase.storage.from('product-photos').getPublicUrl(path);
        // Add cache-busting param
        const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

        const { error: updateErr } = await supabase
          .from('products')
          .update({ photo_url: photoUrl })
          .eq('id', mapping.productId!);

        if (!updateErr) successCount++;
      } catch (err) {
        console.error(`Error uploading ${mapping.file.name}:`, err);
      }
    }

    // Cleanup preview URLs
    mappings.forEach(m => URL.revokeObjectURL(m.previewUrl));

    setUploading(false);
    setDialogOpen(false);
    setMappings([]);

    if (successCount > 0) {
      toast.success(`${successCount} photo${successCount > 1 ? 's' : ''} uploaded`);
      onPhotosUploaded();
    } else {
      toast.error('No photos were uploaded successfully');
    }
  };

  const handleClose = () => {
    mappings.forEach(m => URL.revokeObjectURL(m.previewUrl));
    setDialogOpen(false);
    setMappings([]);
  };

  const assignedCount = mappings.filter(m => m.productId).length;
  const assignedProductIds = new Set(mappings.filter(m => m.productId).map(m => m.productId));

  return (
    <>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer"
      >
        {children}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <ImagePlus className="h-4 w-4" />
              Assign Photos to Products
              <Badge variant="secondary" className="text-[10px]">
                {assignedCount}/{mappings.length} matched
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-2 py-2">
            {mappings.map((mapping, idx) => (
              <div key={idx} className="flex items-center gap-3 p-2 rounded-md border bg-card">
                {/* Thumbnail */}
                <img
                  src={mapping.previewUrl}
                  alt={mapping.file.name}
                  className="h-12 w-12 rounded object-cover border flex-shrink-0"
                />

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{mapping.file.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {(mapping.file.size / 1024).toFixed(0)} KB
                  </p>
                </div>

                {/* Match indicator */}
                {mapping.confidence === 'exact' && mapping.productId && (
                  <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                )}
                {mapping.confidence === 'partial' && mapping.productId && (
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                )}

                {/* Product selector */}
                <Select
                  value={mapping.productId || '__none__'}
                  onValueChange={(v) => updateMapping(idx, v === '__none__' ? null : v)}
                >
                  <SelectTrigger className="w-52 h-8 text-xs">
                    <SelectValue placeholder="Select product…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">— Skip —</span>
                    </SelectItem>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-1">
                          {p.name}
                          {p.sku && <span className="text-muted-foreground text-[10px]">({p.sku})</span>}
                          {assignedProductIds.has(p.id) && mapping.productId !== p.id && (
                            <span className="text-amber-500 text-[10px]">⚠️</span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Remove button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => removeMapping(idx)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {mappings.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">
                No images to upload.
              </p>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground flex-1">
              Tip: Name files to match product names or SKUs for auto-matching.
            </p>
            <Button variant="outline" size="sm" onClick={handleClose} disabled={uploading}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={uploading || assignedCount === 0}
              className="gap-1.5"
            >
              {uploading ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Uploading…</>
              ) : (
                <><Upload className="h-3 w-3" /> Upload {assignedCount} Photo{assignedCount !== 1 ? 's' : ''}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
