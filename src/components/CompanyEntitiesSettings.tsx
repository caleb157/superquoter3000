import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Upload, Trash2, Building2 } from 'lucide-react';
import { toast } from 'sonner';

interface CompanyEntity {
  id: string;
  name: string;
  legal_name: string | null;
  entity_type: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  gst_number: string | null;
  ein_number: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  account_name: string | null;
  account_number: string | null;
  routing_number: string | null;
  ifsc_code: string | null;
  swift_code: string | null;
  logo_url: string | null;
}

const FIELDS_GENERAL: { key: keyof CompanyEntity; label: string; half?: boolean }[] = [
  { key: 'name', label: 'Display Name' },
  { key: 'legal_name', label: 'Legal Name' },
  { key: 'entity_type', label: 'Entity Type' },
  { key: 'address_line1', label: 'Address Line 1' },
  { key: 'address_line2', label: 'Address Line 2' },
  { key: 'city', label: 'City', half: true },
  { key: 'state', label: 'State', half: true },
  { key: 'country', label: 'Country', half: true },
  { key: 'postal_code', label: 'Postal Code', half: true },
  { key: 'phone', label: 'Phone', half: true },
  { key: 'email', label: 'Email', half: true },
  { key: 'website', label: 'Website' },
];

const FIELDS_TAX: { key: keyof CompanyEntity; label: string; entityType?: string }[] = [
  { key: 'gst_number', label: 'GST Number', entityType: 'India' },
  { key: 'ein_number', label: 'EIN Number', entityType: 'US' },
];

const FIELDS_BANK: { key: keyof CompanyEntity; label: string }[] = [
  { key: 'bank_name', label: 'Bank Name' },
  { key: 'bank_branch', label: 'Branch' },
  { key: 'account_name', label: 'Account Name' },
  { key: 'account_number', label: 'Account Number' },
  { key: 'routing_number', label: 'Routing Number (US)' },
  { key: 'ifsc_code', label: 'IFSC Code (India)' },
  { key: 'swift_code', label: 'SWIFT Code' },
];

export default function CompanyEntitiesSettings() {
  const [entities, setEntities] = useState<CompanyEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchEntities = async () => {
    const { data } = await (supabase as any).from('company_entities').select('*').order('name');
    if (data) {
      setEntities(data);
      if (!selectedId && data.length > 0) setSelectedId(data[0].id);
    }
  };

  useEffect(() => { fetchEntities(); }, []);

  const entity = entities.find(e => e.id === selectedId) || null;

  const updateField = async (field: keyof CompanyEntity, value: any) => {
    if (!entity) return;
    setEntities(prev => prev.map(e => e.id === entity.id ? { ...e, [field]: value } : e));
    const { error } = await (supabase as any).from('company_entities').update({ [field]: value }).eq('id', entity.id);
    if (error) toast.error(error.message);
  };

  const addEntity = async () => {
    const { data, error } = await (supabase as any).from('company_entities')
      .insert({ name: 'New Entity', entity_type: 'US', country: 'United States' })
      .select().single();
    if (error) { toast.error(error.message); return; }
    await fetchEntities();
    setSelectedId(data.id);
    toast.success('Entity added');
  };

  const deleteEntity = async () => {
    if (!entity || entities.length <= 1) { toast.error('Must keep at least one entity'); return; }
    const { error } = await (supabase as any).from('company_entities').delete().eq('id', entity.id);
    if (error) { toast.error(error.message); return; }
    setSelectedId(null);
    fetchEntities();
    toast.success('Entity deleted');
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !entity) return;
    const ext = file.name.split('.').pop();
    const path = `${entity.id}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from('entity-logos').upload(path, file, { upsert: true });
    if (uploadErr) { toast.error(uploadErr.message); return; }
    const { data: urlData } = supabase.storage.from('entity-logos').getPublicUrl(path);
    await updateField('logo_url', urlData.publicUrl);
    toast.success('Logo uploaded');
  };

  if (!entity) return <div className="py-8 text-center text-muted-foreground">Loading entities...</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Entity Selector */}
      <div className="flex items-center gap-3">
        <Select value={selectedId || ''} onValueChange={setSelectedId}>
          <SelectTrigger className="h-9 w-64">
            <SelectValue placeholder="Select entity..." />
          </SelectTrigger>
          <SelectContent>
            {entities.map(e => (
              <SelectItem key={e.id} value={e.id}>
                <span className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5" />
                  {e.name} ({e.entity_type || '?'})
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={addEntity}>+ Add Entity</Button>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={deleteEntity}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Logo */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Company Logo</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-4">
          {entity.logo_url ? (
            <img src={entity.logo_url} alt="Logo" className="h-16 w-auto max-w-[200px] object-contain border rounded p-1" />
          ) : (
            <div className="h-16 w-32 border border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">No logo</div>
          )}
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Upload Logo
            </Button>
            {entity.logo_url && (
              <Button variant="ghost" size="sm" className="text-destructive ml-2" onClick={() => updateField('logo_url', null)}>
                Remove
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* General Info */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">General Information</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS_GENERAL.map(f => {
              if (f.key === 'entity_type') {
                return (
                  <div key={f.key} className="col-span-2">
                    <Label className="text-xs">{f.label}</Label>
                    <Select value={entity.entity_type || 'US'} onValueChange={v => updateField('entity_type', v)}>
                      <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="US">US</SelectItem>
                        <SelectItem value="India">India</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              }
              return (
                <div key={f.key} className={f.half ? '' : 'col-span-2'}>
                  <Label className="text-xs">{f.label}</Label>
                  <Input
                    className="h-8 text-sm mt-1"
                    defaultValue={(entity as any)[f.key] || ''}
                    key={`${entity.id}-${f.key}`}
                    onBlur={e => {
                      const val = e.target.value || null;
                      if (val !== (entity as any)[f.key]) updateField(f.key, val);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Tax IDs */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Tax Identification</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {FIELDS_TAX.map(f => (
            <div key={f.key}>
              <Label className="text-xs">{f.label}</Label>
              <Input
                className="h-8 text-sm mt-1 max-w-xs"
                defaultValue={(entity as any)[f.key] || ''}
                key={`${entity.id}-${f.key}`}
                onBlur={e => {
                  const val = e.target.value || null;
                  if (val !== (entity as any)[f.key]) updateField(f.key, val);
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Bank Details */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Bank Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS_BANK.map(f => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                <Input
                  className="h-8 text-sm mt-1"
                  defaultValue={(entity as any)[f.key] || ''}
                  key={`${entity.id}-${f.key}`}
                  onBlur={e => {
                    const val = e.target.value || null;
                    if (val !== (entity as any)[f.key]) updateField(f.key, val);
                  }}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
