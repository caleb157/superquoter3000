import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { fmt } from '@/lib/formatters';
import type { HardwareSyncPlan, ConflictResolution, HardwareConflict } from '@/lib/hardware-sync';

type Props = {
  open: boolean;
  plan: HardwareSyncPlan | null;
  onCancel: () => void;
  onConfirm: (resolved: Array<HardwareConflict & { resolution: ConflictResolution }>) => void;
};

export function HardwareSyncDialog({ open, plan, onCancel, onConfirm }: Props) {
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});

  useEffect(() => {
    if (!plan) return;
    // Default every conflict to "keep existing" so we never silently overwrite.
    const init: Record<string, ConflictResolution> = {};
    plan.conflicts.forEach(c => { init[c.id] = 'keep'; });
    setResolutions(init);
  }, [plan]);

  if (!plan) return null;

  const handleConfirm = () => {
    const resolved = plan.conflicts.map(c => ({
      ...c,
      resolution: resolutions[c.id] ?? 'keep',
    }));
    onConfirm(resolved);
  };

  const nothing = plan.newItems.length === 0 && plan.conflicts.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Sync hardware library</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Generating this quote will update the shared hardware list with the prices used on these products.
          </p>
        </DialogHeader>

        <div className="space-y-4 max-h-[55vh] overflow-y-auto">
          {nothing && (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No hardware changes detected — library is already in sync.
            </div>
          )}

          {plan.newItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                New items to add ({plan.newItems.length})
              </div>
              <div className="border rounded-md divide-y">
                {plan.newItems.map(item => (
                  <div key={item.name} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate">{item.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {fmt.inr(item.unit_cost_inr)} / {item.units}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.conflicts.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Price conflicts ({plan.conflicts.length})
              </div>
              <div className="space-y-2">
                {plan.conflicts.map(c => {
                  const value = resolutions[c.id] ?? 'keep';
                  return (
                    <div key={c.id} className="border rounded-md px-3 py-2 text-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium truncate">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">/{c.units}</span>
                      </div>
                      <RadioGroup
                        value={value}
                        onValueChange={(v) => setResolutions(prev => ({ ...prev, [c.id]: v as ConflictResolution }))}
                        className="flex gap-4"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="keep" id={`keep-${c.id}`} />
                          <Label htmlFor={`keep-${c.id}`} className="text-xs cursor-pointer">
                            Keep <span className="font-mono">{fmt.inr(c.existing_price_inr)}</span>
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="update" id={`update-${c.id}`} />
                          <Label htmlFor={`update-${c.id}`} className="text-xs cursor-pointer">
                            Update to <span className="font-mono">{fmt.inr(c.new_price_inr)}</span>
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleConfirm}>
            {nothing ? 'Continue' : 'Apply & generate quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
