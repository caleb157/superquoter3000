import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown, ImagePlus, Loader2, X, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { TaskContext, TaskPriority } from '@/lib/task-types';
import { useAuth } from '@/contexts/AuthContext';
import { SignedImg, resolveDisplayUrl } from '@/lib/storage-urls';
import { customerSecondary } from '@/lib/customer-name';
import { ASSOCIATION_TYPES, type AssociationType, associationMeta } from '@/lib/task-association';
import { parseRule, ruleLabel, type RecurrenceRule, type RecurrenceFreq } from '@/lib/task-recurrence';

type TaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  context?: TaskContext;
  onSaved?: () => void;
};

type Inquiry = { id: string; rfq_number: string; title: string | null; updated_at: string };
type Customer = { id: string; name: string; company: string | null };
type AssocKind = 'none' | AssociationType;

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function TaskDialog({ open, onOpenChange, taskId, context, onSaved }: TaskDialogProps) {
  const { assigneeCode } = useAuth();
  const isEdit = !!taskId;

  const [assocType, setAssocType] = useState<AssocKind>('none');
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [extId, setExtId] = useState('');        // SO / MO number
  const [extDetail, setExtDetail] = useState(''); // customer/ref or SKU
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState<string>('unassigned');
  const [dueDate, setDueDate] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const [rule, setRule] = useState<RecurrenceRule | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [iRes, cRes, pRes, tRes] = await Promise.all([
        supabase.from('customer_rfqs').select('id, rfq_number, title, updated_at').order('updated_at', { ascending: false }),
        (supabase as any).from('customers').select('id, name, company').order('name'),
        (supabase as any).from('profiles').select('assignee_code'),
        supabase.from('tasks').select('assignee'),
      ]);
      if (iRes.data) setInquiries(iRes.data as any);
      if (cRes.data) setCustomers(cRes.data as any);
      const set = new Set<string>();
      ((pRes.data as any[]) || []).forEach(r => { if (r.assignee_code) set.add(r.assignee_code); });
      ((tRes.data as any[]) || []).forEach(r => { if (r.assignee) set.add(r.assignee); });
      setAssigneeOptions(Array.from(set).sort());
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      if (isEdit && taskId) {
        const { data } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (data) {
          const d: any = data;
          const t: AssocKind = d.association_type
            ?? (d.inquiry_id ? 'inquiry' : d.customer_id ? 'customer' : 'none');
          setAssocType(t);
          setInquiryId(d.inquiry_id);
          setCustomerId(d.customer_id);
          setExtId(t === 'odoo_so' || t === 'odoo_mo' ? (d.association_id ?? '') : '');
          setExtDetail(t === 'odoo_so' || t === 'odoo_mo' ? (d.association_label ?? '') : '');
          setTitle(d.title);
          setDescription(d.description ?? '');
          setAssignee(d.assignee ?? 'unassigned');
          setDueDate(d.due_date ?? '');
          setPriority((d.priority as TaskPriority) ?? 'normal');
          setStatus((d.status as 'open' | 'done') ?? 'open');
          setRule(parseRule(d.recurrence_rule));
          setPhotoUrls(Array.isArray(d.photo_urls) ? d.photo_urls : []);
        }
        return;
      }
      resetForm();
      if (context?.productId) {
        const { data: p } = await supabase
          .from('products').select('customer_rfq_id').eq('id', context.productId).maybeSingle();
        if (p?.customer_rfq_id) { setAssocType('inquiry'); setInquiryId(p.customer_rfq_id); }
      } else if (context?.inquiryId) {
        setAssocType('inquiry'); setInquiryId(context.inquiryId);
      } else if (context?.customerId) {
        setAssocType('customer'); setCustomerId(context.customerId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  const resetForm = () => {
    setAssocType('none');
    setInquiryId(null); setCustomerId(null); setExtId(''); setExtDetail('');
    setTitle(''); setDescription(''); setAssignee(assigneeCode || 'unassigned');
    setDueDate(''); setPriority('normal'); setStatus('open'); setRule(null);
    setPhotoUrls([]);
  };

  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (list.length === 0) { toast.error('Only image files are supported'); return; }
    setUploadingPhoto(true);
    try {
      const uploaded: string[] = [];
      for (const file of list) {
        if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} is over 10MB`); continue; }
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('task-photos').upload(path, file, {
          cacheControl: '3600', upsert: false, contentType: file.type,
        });
        if (upErr) { toast.error(upErr.message); continue; }
        const { data } = supabase.storage.from('task-photos').getPublicUrl(path);
        uploaded.push(data.publicUrl);
      }
      if (uploaded.length > 0) {
        setPhotoUrls(prev => [...prev, ...uploaded]);
        toast.success(`${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} attached`);
      }
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const changeAssocType = (t: AssocKind) => {
    setAssocType(t);
    setInquiryId(null); setCustomerId(null); setExtId(''); setExtDetail('');
  };

  const setFreq = (v: string) => {
    if (v === 'none') { setRule(null); return; }
    setRule(r => ({ freq: v as RecurrenceFreq, interval: r?.interval ?? 1, mode: r?.mode ?? 'due', weekdays: v === 'weekly' ? (r?.weekdays ?? []) : undefined }));
  };

  const handleSave = async (addAnother = false) => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (assocType === 'inquiry' && !inquiryId) { toast.error('Pick an inquiry or remove the link'); return; }
    if (assocType === 'customer' && !customerId) { toast.error('Pick a customer or remove the link'); return; }
    if ((assocType === 'odoo_so' || assocType === 'odoo_mo') && !extId.trim()) {
      toast.error(`Enter the ${associationMeta(assocType)?.idLabel} or remove the link`); return;
    }
    if (rule && !dueDate) { toast.error('Repeating tasks need a first due date'); return; }

    const inq = inquiries.find(i => i.id === inquiryId);
    const cust = customers.find(c => c.id === customerId);
    let association_id: string | null = null;
    let association_label: string | null = null;
    if (assocType === 'inquiry') { association_id = inquiryId; association_label = inq ? `${inq.rfq_number} ${inq.title ?? ''}`.trim() : null; }
    if (assocType === 'customer') { association_id = customerId; association_label = cust?.name ?? null; }
    if (assocType === 'odoo_so' || assocType === 'odoo_mo') { association_id = extId.trim(); association_label = extDetail.trim() || null; }

    setSaving(true);
    const payload: any = {
      title: title.trim(),
      description: description.trim() || null,
      assignee: assignee === 'unassigned' ? null : assignee,
      due_date: dueDate || null,
      priority,
      photo_urls: photoUrls,
      association_type: assocType === 'none' ? null : assocType,
      association_id,
      association_label,
      inquiry_id: assocType === 'inquiry' ? inquiryId : null,
      customer_id: assocType === 'customer' ? customerId : null,
      product_id: null,
      recurrence_rule: rule,
    };

    let error;
    if (isEdit && taskId) {
      payload.status = status;
      ({ error } = await supabase.from('tasks').update(payload).eq('id', taskId));
    } else {
      ({ error } = await supabase.from('tasks').insert(payload));
    }
    setSaving(false);

    if (error) { toast.error(error.message); return; }
    toast.success(isEdit ? 'Task updated' : 'Task created');
    onSaved?.();
    if (addAnother && !isEdit) {
      setTitle(''); setDescription(''); setPhotoUrls([]);
    } else {
      onOpenChange(false);
    }
  };

  const selectedInquiry = inquiries.find(i => i.id === inquiryId);
  const selectedCustomer = customers.find(c => c.id === customerId);
  const meta = associationMeta(assocType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto mx-2 sm:mx-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit task' : 'New task'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1 h-9" autoFocus={!isEdit} />
          </div>

          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} className="mt-1 text-sm" rows={2} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Assignee</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {Array.from(new Set([...assigneeOptions, assignee].filter(v => v && v !== 'unassigned'))).sort().map(code => (
                    <SelectItem key={code} value={code}>{code}{code === assigneeCode ? ' (you)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Due date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Repeat className="h-3 w-3" />Repeat</Label>
              <Select value={rule?.freq ?? 'none'} onValueChange={setFreq}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Does not repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {rule && (
            <div className="rounded-md border bg-muted/30 p-2.5 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span>Every</span>
                <Input
                  type="number" min={1} value={rule.interval}
                  onChange={e => setRule({ ...rule, interval: Math.max(1, Number(e.target.value) || 1) })}
                  className="h-7 w-14 text-xs"
                />
                <span>{{ daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[rule.freq]}</span>
                {rule.freq === 'monthly' && (
                  <>
                    <span>on day</span>
                    <Input
                      type="number" min={1} max={31} placeholder={dueDate ? String(Number(dueDate.slice(8, 10))) : '—'}
                      value={rule.monthDay ?? ''}
                      onChange={e => setRule({ ...rule, monthDay: e.target.value ? Math.min(31, Math.max(1, Number(e.target.value))) : undefined })}
                      className="h-7 w-14 text-xs"
                    />
                  </>
                )}
              </div>
              {rule.freq === 'weekly' && (
                <div className="flex gap-1">
                  {WEEKDAYS.map((w, i) => {
                    const on = rule.weekdays?.includes(i);
                    return (
                      <button key={i} type="button"
                        onClick={() => setRule({ ...rule, weekdays: on ? rule.weekdays!.filter(d => d !== i) : [...(rule.weekdays ?? []), i] })}
                        className={cn('h-7 w-7 rounded-full text-[11px] border transition',
                          on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground')}
                      >{w}</button>
                    );
                  })}
                </div>
              )}
              <Select value={rule.mode} onValueChange={(v) => setRule({ ...rule, mode: v as any })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="due">Schedule from the due date</SelectItem>
                  <SelectItem value="completion">Schedule from when I complete it</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{ruleLabel(rule, dueDate)}</p>
            </div>
          )}

          {/* Single optional association */}
          <div>
            <Label className="text-xs">Associate with (optional)</Label>
            <Select value={assocType} onValueChange={(v) => changeAssocType(v as AssocKind)}>
              <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nothing — general task</SelectItem>
                {ASSOCIATION_TYPES.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {(assocType === 'inquiry' || assocType === 'customer') && (
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal mt-1.5">
                    <span className="truncate">
                      {assocType === 'inquiry'
                        ? (selectedInquiry ? `${selectedInquiry.rfq_number} — ${selectedInquiry.title || 'Untitled'}` : 'Select inquiry...')
                        : (selectedCustomer ? selectedCustomer.name : 'Select customer...')}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={assocType === 'inquiry' ? 'Search inquiries...' : 'Search customers...'} />
                    <CommandList>
                      <CommandEmpty>Nothing found.</CommandEmpty>
                      <CommandGroup>
                        {assocType === 'inquiry'
                          ? inquiries.map(i => (
                            <CommandItem key={i.id} value={`${i.rfq_number} ${i.title ?? ''}`}
                              onSelect={() => { setInquiryId(i.id); setPickerOpen(false); }}>
                              <Check className={cn('mr-2 h-4 w-4', inquiryId === i.id ? 'opacity-100' : 'opacity-0')} />
                              <span className="truncate">{i.rfq_number} — {i.title || 'Untitled'}</span>
                            </CommandItem>
                          ))
                          : customers.map(c => (
                            <CommandItem key={c.id} value={`${c.name} ${c.company ?? ''}`}
                              onSelect={() => { setCustomerId(c.id); setPickerOpen(false); }}>
                              <Check className={cn('mr-2 h-4 w-4', customerId === c.id ? 'opacity-100' : 'opacity-0')} />
                              <div className="flex flex-col">
                                <span>{c.name}</span>
                                {customerSecondary(c) && <span className="text-xs text-muted-foreground">{customerSecondary(c)}</span>}
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}

            {(assocType === 'odoo_so' || assocType === 'odoo_mo') && meta && (
              <div className="grid grid-cols-[1fr_1.4fr] gap-2 mt-1.5">
                <Input value={extId} onChange={e => setExtId(e.target.value)} placeholder={meta.idPlaceholder} className="h-9 text-sm" aria-label={meta.idLabel} />
                <Input value={extDetail} onChange={e => setExtDetail(e.target.value)} placeholder={meta.detailPlaceholder} className="h-9 text-sm" aria-label={meta.detailLabel} />
              </div>
            )}
          </div>

          {isEdit && (
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'open' | 'done')}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Photos</Label>
              <Button
                type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
                onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}
              >
                {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                {uploadingPhoto ? 'Uploading…' : 'Add photo'}
              </Button>
            </div>
            <input
              ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => handlePhotoFiles(e.target.files)}
            />
            {photoUrls.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">No photos attached.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {photoUrls.map(url => (
                  <div key={url} className="relative group aspect-square rounded-md overflow-hidden border bg-muted">
                    <button
                      type="button"
                      onClick={async () => { const u = await resolveDisplayUrl(url); window.open(u, '_blank', 'noreferrer'); }}
                      className="block w-full h-full"
                    >
                      <SignedImg src={url} alt="Task attachment" className="w-full h-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPhotoUrls(prev => prev.filter(u => u !== url))}
                      className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-background/90 border shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground transition"
                      aria-label="Remove photo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!isEdit && (
            <Button variant="secondary" onClick={() => handleSave(true)} disabled={saving}>
              {saving ? 'Saving…' : 'Save & add another'}
            </Button>
          )}
          <Button onClick={() => handleSave(false)} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
