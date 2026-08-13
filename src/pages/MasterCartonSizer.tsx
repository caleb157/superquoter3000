import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Box, RotateCcw } from 'lucide-react';
import { calcMCPacking } from '@/lib/calculations';
import { useDocumentTitle } from '@/hooks/use-document-title';

const DEFAULTS = {
  ic_w: 12,
  ic_d: 12,
  ic_h: 6,
  products_per_ic: 1,
  ic_qty: 1000,
  product_weight_kg: 1,
  mc_max_width: 25,
  mc_max_depth: 25,
  mc_max_height: 25,
  mc_buffer_inch: 1,
  mc_height_buffer_inch: 2.5,
  mc_weight_limit_kg: 20,
  mc_empty_weight_kg: 1.5,
};

type Fields = typeof DEFAULTS;

function NumField({
  id, label, value, onChange, suffix, step = 0.25,
}: { id: keyof Fields; label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}{suffix ? ` (${suffix})` : ''}
      </Label>
      <Input
        id={id}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-8 text-sm"
      />
    </div>
  );
}

export default function MasterCartonSizer() {
  useDocumentTitle('Master Carton Sizer');
  const [f, setF] = useState<Fields>({ ...DEFAULTS });
  const set = (k: keyof Fields) => (v: number) => setF(prev => ({ ...prev, [k]: Number.isNaN(v) ? 0 : v }));

  const result = useMemo(() => {
    const icsPerMcCap = Math.max(1, Math.round(f.ic_qty || 1));
    return calcMCPacking({
      include_mc: true,
      mc_type: 'MC',
      mc_max_width: f.mc_max_width,
      mc_max_depth: f.mc_max_depth,
      mc_max_height: f.mc_max_height,
      mc_buffer_inch: f.mc_buffer_inch,
      mc_height_buffer_inch: f.mc_height_buffer_inch,
      mc_weight_limit_kg: f.mc_weight_limit_kg,
      mc_empty_weight_kg: f.mc_empty_weight_kg,
      product_weight_kg: f.product_weight_kg,
      quantity: icsPerMcCap * Math.max(1, f.products_per_ic || 1),
      products_per_ic: Math.max(1, f.products_per_ic || 1),
      ic_width: f.ic_w,
      ic_depth: f.ic_d,
      ic_height: f.ic_h,
      ic_od_width: f.ic_w,
      ic_od_depth: f.ic_d,
      ic_od_height: f.ic_h,
    });
  }, [f]);

  const icsPerMc = result.packed_ics;
  const piecesPerMc = result.products_per_mc;
  const grossWeight = f.mc_empty_weight_kg + piecesPerMc * (f.product_weight_kg || 0);
  const valid = f.ic_w > 0 && f.ic_d > 0 && f.ic_h > 0;


  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '—');

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Link to="/tools">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" /> Tools
            </Button>
          </Link>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Box className="h-4 w-4" /> Master Carton Sizer
          </h1>
          <Button
            variant="outline"
            size="sm"
            className="h-8 ml-auto gap-1.5"
            onClick={() => setF({ ...DEFAULTS })}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Inner carton (OD)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <NumField id="ic_w" label="Width" suffix="in" value={f.ic_w} onChange={set('ic_w')} />
                <NumField id="ic_d" label="Depth" suffix="in" value={f.ic_d} onChange={set('ic_d')} />
                <NumField id="ic_h" label="Height" suffix="in" value={f.ic_h} onChange={set('ic_h')} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <NumField id="products_per_ic" label="Pcs / IC" value={f.products_per_ic} onChange={set('products_per_ic')} step={1} />
                <NumField id="product_weight_kg" label="Pc weight" suffix="kg" value={f.product_weight_kg} onChange={set('product_weight_kg')} step={0.1} />
                <NumField id="ic_qty" label="Max ICs" value={f.ic_qty} onChange={set('ic_qty')} step={1} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Constraints</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <NumField id="mc_max_width" label="Max W" suffix="in" value={f.mc_max_width} onChange={set('mc_max_width')} />
                <NumField id="mc_max_depth" label="Max D" suffix="in" value={f.mc_max_depth} onChange={set('mc_max_depth')} />
                <NumField id="mc_max_height" label="Max H" suffix="in" value={f.mc_max_height} onChange={set('mc_max_height')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumField id="mc_buffer_inch" label="W/D buffer" suffix="in" value={f.mc_buffer_inch} onChange={set('mc_buffer_inch')} />
                <NumField id="mc_height_buffer_inch" label="Height buffer" suffix="in" value={f.mc_height_buffer_inch} onChange={set('mc_height_buffer_inch')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumField id="mc_weight_limit_kg" label="Weight limit" suffix="kg" value={f.mc_weight_limit_kg} onChange={set('mc_weight_limit_kg')} step={0.5} />
                <NumField id="mc_empty_weight_kg" label="Empty MC weight" suffix="kg" value={f.mc_empty_weight_kg} onChange={set('mc_empty_weight_kg')} step={0.1} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Result</CardTitle>
          </CardHeader>
          <CardContent>
            {!valid ? (
              <p className="text-sm text-muted-foreground">Enter inner carton dimensions to size a master carton.</p>
            ) : (
              <div className="space-y-4">
                <div className="text-2xl font-semibold tabular-nums">
                  {fmt(result.mc_width)} × {fmt(result.mc_depth)} × {fmt(result.mc_height)} in
                </div>
                <Separator />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Layout (W × D × H)</div>
                    <div className="tabular-nums font-medium">
                      {result.mc_ics_along_w} × {result.mc_ics_along_d} × {result.mc_ics_along_h}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">ICs per MC</div>
                    <div className="tabular-nums font-medium">{icsPerMc}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Pieces per MC</div>
                    <div className="tabular-nums font-medium">{result.products_per_mc}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Volume</div>
                    <div className="tabular-nums font-medium">{result.mc_volume_cbm.toFixed(4)} CBM</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Gross weight</div>
                    <div className="tabular-nums font-medium">{grossWeight.toFixed(2)} kg</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Same math as the costing sheet: complete rows/layers only, buffers added once per axis,
                  and the weight limit caps the count when it bites before the dimensional fit does.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
