import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { recostProduct } from '@/lib/costing-seed';

type Location = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedProductIds: string[];
  onApplied: () => void;
};

const INHOUSE = '__inhouse__';

export function BulkSetSourceLocationDialog({ open, onOpenChange, selectedProductIds, onApplied }: Props) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [value, setValue] = useState<string>(INHOUSE);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!open) { setValue(INHOUSE); setProgress(null); return; }
    (async () => {
      const { data, error } = await (supabase as any)
        .from('local_transport_locations')
        .select('id, name')
        .order('name');
      if (error) { toast.error('Could not load locations: ' + error.message); return; }
      setLocations((data || []) as Location[]);
    })();
  }, [open]);

  const apply = async () => {
    if (selectedProductIds.length === 0) return;
    setApplying(true);
    const newLocId = value === INHOUSE ? null : value;
    const { error } = await (supabase as any)
      .from('products')
      .update({ source_location_id: newLocId, updated_at: new Date().toISOString() })
      .in('id', selectedProductIds);
    if (error) {
      setApplying(false);
      toast.error('Failed to update: ' + error.message);
      return;
    }

    // Recost each so Domestic Freight COGS is seeded/refreshed and prices update.
    setProgress({ done: 0, total: selectedProductIds.length });
    let done = 0;
    for (const pid of selectedProductIds) {
      try { await recostProduct(pid); } catch (e) { /* non-blocking */ }
      done += 1;
      setProgress({ done, total: selectedProductIds.length });
    }

    setApplying(false);
    const label = newLocId
      ? (locations.find(l => l.id === newLocId)?.name || 'location')
      : 'In-house';
    toast.success(`Set source to ${label} on ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'}.`);
    onOpenChange(false);
    onApplied();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!applying) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set source location for {selectedProductIds.length} products</DialogTitle>
          <DialogDescription>
            Updates the source on each product and recomputes Domestic Freight COGS. Pick "In-house" to clear the source and remove freight.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs">Source location</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={INHOUSE}>In-house (no domestic freight)</SelectItem>
              {locations.map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {progress && (
          <p className="text-[11px] text-muted-foreground">
            Recosting {progress.done} / {progress.total}…
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
          <Button onClick={apply} disabled={applying}>
            {applying ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
