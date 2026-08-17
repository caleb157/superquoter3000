import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Vendor = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleIds: string[];
  onSaved: () => void;
};

const CLEAR = '__clear__';

export function BulkEditSamplesDialog({ open, onOpenChange, sampleIds, onSaved }: Props) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [saving, setSaving] = useState(false);

  // Each field has an explicit "apply" toggle so untouched fields are left alone.
  const [applyStatus, setApplyStatus] = useState(false);
  const [status, setStatus] = useState('pending');
  const [applyVendor, setApplyVendor] = useState(false);
  const [vendorId, setVendorId] = useState<string>(CLEAR);
  const [applyRequested, setApplyRequested] = useState(false);
  const [requestedDate, setRequestedDate] = useState('');
  const [applyRequiredBy, setApplyRequiredBy] = useState(false);
  const [requiredByDate, setRequiredByDate] = useState('');
  const [applyCompleted, setApplyCompleted] = useState(false);
  const [completedDate, setCompletedDate] = useState('');

  useEffect(() => {
    if (!open) return;
    setApplyStatus(false); setApplyVendor(false); setApplyRequested(false);
    setApplyRequiredBy(false); setApplyCompleted(false);
    supabase.from('vendors').select('id, name').order('name').then(({ data }) => {
      setVendors((data || []) as Vendor[]);
    });
  }, [open]);

  const nothingSelected = !applyStatus && !applyVendor && !applyRequested && !applyRequiredBy && !applyCompleted;

  const save = async () => {
    if (nothingSelected || sampleIds.length === 0) return;
    setSaving(true);

    const base: Record<string, any> = {};
    if (applyStatus) base.status = status;
    if (applyVendor) base.vendor_id = vendorId === CLEAR ? null : vendorId;
    if (applyRequested) base.requested_date = requestedDate || null;
    if (applyRequiredBy) base.required_by_date = requiredByDate || null;

    let error: any = null;
    if (Object.keys(base).length > 0) {
      const res = await (supabase as any).from('samples').update(base).in('id', sampleIds);
      error = res.error;
    }

    // completed_at is stamped by a database trigger when status flips to
    // "completed", so an explicit date must be written in a second pass.
    if (!error && applyCompleted) {
      const res = await (supabase as any)
        .from('samples')
        .update({ completed_at: completedDate ? new Date(`${completedDate}T00:00:00`).toISOString() : null })
        .in('id', sampleIds);
      error = res.error;
    }

    setSaving(false);
    if (error) {
      toast.error(`Bulk update failed: ${error.message}`);
      return;
    }
    toast.success(`Updated ${sampleIds.length} sample${sampleIds.length === 1 ? '' : 's'}`);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk edit samples</DialogTitle>
          <DialogDescription>
            Tick a field to apply it to all {sampleIds.length} selected sample{sampleIds.length === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Checkbox id="bes-status" checked={applyStatus} onCheckedChange={v => setApplyStatus(!!v)} />
            <Label htmlFor="bes-status" className="w-28 text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus} disabled={!applyStatus}>
              <SelectTrigger className="h-9 flex-1 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox id="bes-vendor" checked={applyVendor} onCheckedChange={v => setApplyVendor(!!v)} />
            <Label htmlFor="bes-vendor" className="w-28 text-xs">Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId} disabled={!applyVendor}>
              <SelectTrigger className="h-9 flex-1 text-sm"><SelectValue placeholder="Vendor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={CLEAR}>— No vendor —</SelectItem>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox id="bes-req" checked={applyRequested} onCheckedChange={v => setApplyRequested(!!v)} />
            <Label htmlFor="bes-req" className="w-28 text-xs">Requested</Label>
            <Input type="date" className="h-9 flex-1 text-sm" value={requestedDate}
              disabled={!applyRequested} onChange={e => setRequestedDate(e.target.value)} />
          </div>

          <div className="flex items-center gap-3">
            <Checkbox id="bes-reqby" checked={applyRequiredBy} onCheckedChange={v => setApplyRequiredBy(!!v)} />
            <Label htmlFor="bes-reqby" className="w-28 text-xs">Required by</Label>
            <Input type="date" className="h-9 flex-1 text-sm" value={requiredByDate}
              disabled={!applyRequiredBy} onChange={e => setRequiredByDate(e.target.value)} />
          </div>

          <div className="flex items-center gap-3">
            <Checkbox id="bes-comp" checked={applyCompleted} onCheckedChange={v => setApplyCompleted(!!v)} />
            <Label htmlFor="bes-comp" className="w-28 text-xs">Completed</Label>
            <Input type="date" className="h-9 flex-1 text-sm" value={completedDate}
              disabled={!applyCompleted} onChange={e => setCompletedDate(e.target.value)} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Leave a date empty (with its box ticked) to clear it. Completed dates only stick on samples marked completed.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || nothingSelected}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Apply to {sampleIds.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
