import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { Download, FileText, FileSpreadsheet } from 'lucide-react';

interface ProjectSettingsTabProps {
  projectId: string;
}

const ProjectSettingsTab = ({ projectId }: ProjectSettingsTabProps) => {
  const [settings, setSettings] = useState<any>(null);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const [settingsRes, gsRes, stRes] = await Promise.all([
        supabase.from('project_settings').select('*').eq('project_id', projectId).maybeSingle(),
        supabase.from('global_settings').select('*').limit(1).single(),
        supabase.from('shipping_types').select('*').order('name'),
      ]);

      setGlobalSettings(gsRes.data);
      setShippingTypes(stRes.data || []);

      if (settingsRes.data) {
        setSettings(settingsRes.data);
      } else {
        // Create default settings
        const { data } = await supabase.from('project_settings').insert({
          project_id: projectId,
        } as any).select().single();
        if (data) setSettings(data);
      }
      setLoading(false);
    };
    fetchData();
  }, [projectId]);

  const updateSetting = async (field: string, value: any) => {
    if (!settings) return;
    setSettings((s: any) => ({ ...s, [field]: value }));
    const { error } = await supabase.from('project_settings').update({ [field]: value } as any).eq('id', settings.id);
    if (error) toast.error('Failed to save setting');
  };

  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading settings...</div>;
  if (!settings) return <div className="py-12 text-center text-muted-foreground">Error loading settings.</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Pricing & Currency */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pricing & Currency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Exchange Rate</Label>
              <p className="text-[10px] text-muted-foreground">
                Global rate: ₹{globalSettings?.exchange_rate || 90}/USD
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={!settings.use_global_exchange_rate}
                onCheckedChange={(v) => updateSetting('use_global_exchange_rate', !v)}
              />
              <span className="text-xs">{settings.use_global_exchange_rate ? 'Using global' : 'Custom'}</span>
            </div>
          </div>
          {!settings.use_global_exchange_rate && (
            <Input
              className="h-8 text-sm w-32"
              type="number"
              value={settings.exchange_rate_override || ''}
              onChange={e => updateSetting('exchange_rate_override', Number(e.target.value) || null)}
              placeholder="₹/USD"
            />
          )}

          <div>
            <Label className="text-xs">Quote Currency</Label>
            <RadioGroup
              value={settings.quote_currency || 'USD'}
              onValueChange={v => updateSetting('quote_currency', v)}
              className="flex gap-4 mt-1"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="USD" id="usd" />
                <Label htmlFor="usd" className="text-xs">USD ($)</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="INR" id="inr" />
                <Label htmlFor="inr" className="text-xs">INR (₹)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Default Markup</Label>
              <p className="text-[10px] text-muted-foreground">Override per-product markups with a uniform value</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={settings.apply_uniform_markup || false}
                onCheckedChange={(v) => updateSetting('apply_uniform_markup', v)}
              />
              <span className="text-xs">{settings.apply_uniform_markup ? 'Uniform' : 'Per-product'}</span>
            </div>
          </div>
          {settings.apply_uniform_markup && (
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-sm w-24"
                type="number"
                value={settings.default_markup_override != null ? (settings.default_markup_override * 100) : ''}
                onChange={e => updateSetting('default_markup_override', Number(e.target.value) / 100 || null)}
                placeholder="%"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shipping */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Shipping</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Shipping Type</Label>
              <p className="text-[10px] text-muted-foreground">
                Global default: {globalSettings?.default_shipping_type || 'FOB Jodhpur'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={!settings.use_global_shipping}
                onCheckedChange={(v) => updateSetting('use_global_shipping', !v)}
              />
              <span className="text-xs">{settings.use_global_shipping ? 'Using global' : 'Custom'}</span>
            </div>
          </div>
          {!settings.use_global_shipping && (
            <Select value={settings.shipping_type_override || ''} onValueChange={v => updateSetting('shipping_type_override', v)}>
              <SelectTrigger className="h-8 text-sm w-64">
                <SelectValue placeholder="Select shipping type..." />
              </SelectTrigger>
              <SelectContent>
                {shippingTypes.map(st => (
                  <SelectItem key={st.id} value={st.name}>{st.name} — {fmt.inr(st.cost_inr)}/{st.per_unit}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* RFQ Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">RFQ Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">RFQ Discount %</Label>
            <p className="text-[10px] text-muted-foreground mb-1">
              When generating RFQs, target prices will be set this % below our cost estimate
            </p>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-sm w-24"
                type="number"
                value={((settings.rfq_discount_percent || 0.1) * 100).toFixed(0)}
                onChange={e => updateSetting('rfq_discount_percent', Number(e.target.value) / 100)}
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quote Appearance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Quote Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Quote Title</Label>
            <Input
              className="h-8 text-sm"
              value={settings.quote_title || ''}
              onChange={e => updateSetting('quote_title', e.target.value)}
              placeholder="e.g. Spring 2026 Collection"
            />
          </div>
          <div>
            <Label className="text-xs">Quote Notes / Terms</Label>
            <Textarea
              className="text-sm min-h-[80px]"
              value={settings.quote_notes || ''}
              onChange={e => updateSetting('quote_notes', e.target.value)}
              placeholder="Payment terms, shipping terms, validity..."
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Quote Validity (days)</Label>
            <Input
              className="h-8 text-sm w-20"
              type="number"
              value={settings.quote_validity_days || 30}
              onChange={e => updateSetting('quote_validity_days', parseInt(e.target.value) || 30)}
            />
          </div>
          <div>
            <Label className="text-xs mb-2 block">Show on Quote</Label>
            <div className="flex flex-wrap gap-4">
              {[
                { key: 'show_photos_on_quote', label: 'Photos' },
                { key: 'show_sku_on_quote', label: 'SKU' },
                { key: 'show_dimensions_on_quote', label: 'Dimensions' },
                { key: 'show_cbm_on_quote', label: 'CBM' },
                { key: 'show_weight_on_quote', label: 'Weight' },
              ].map(opt => (
                <label key={opt.key} className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={settings[opt.key] ?? true}
                    onCheckedChange={v => updateSetting(opt.key, !!v)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" className="gap-1.5" disabled>
            <Download className="h-3.5 w-3.5" /> Download Summary PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" disabled>
            <FileText className="h-3.5 w-3.5" /> Generate Customer Quote
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" disabled>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Export to Excel
          </Button>
          <p className="text-[10px] text-muted-foreground w-full mt-1">Export features coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectSettingsTab;
