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
import { Check, ChevronsUpDown, ImagePlus, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { TaskContext, TaskPriority } from '@/lib/task-types';

type Mode = 'inquiry' | 'customer';

type TaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  context?: TaskContext;
  onSaved?: () => void;
};

type Inquiry = { id: string; rfq_number: string; title: string | null; updated_at: string };
type Product = { id: string; name: string; customer_rfq_id: string | null };
type Customer = { id: string; name: string; company: string | null };

export function TaskDialog({ open, onOpenChange, taskId, context, onSaved }: TaskDialogProps) {
  const isEdit = !!taskId;

  const [mode, setMode] = useState<Mode>('inquiry');
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState<string>('unassigned');
  const [dueDate, setDueDate] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load reference data when dialog opens
  useEffect(() => {
    if (!open) return;
    (async () => {
      const [iRes, cRes] = await Promise.all([
        supabase.from('customer_rfqs').select('id, rfq_number, title, updated_at').order('updated_at', { ascending: false }),
        (supabase as any).from('customers').select('id, name, company').order('name'),
      ]);
      if (iRes.data) setInquiries(iRes.data as any);
      if (cRes.data) setCustomers(cRes.data as any);
    })();
  }, [open]);

  // Initialize fields when opening (edit or context-driven create)
  useEffect(() => {
    if (!open) return;
    (async () => {
      if (isEdit && taskId) {
        const { data } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (data) {
          if (data.customer_id) setMode('customer'); else setMode('inquiry');
          setInquiryId(data.inquiry_id);
          setCustomerId(data.customer_id);
          setProductId(data.product_id);
          setTitle(data.title);
          setDescription(data.description ?? '');
          setAssignee(data.assignee ?? 'unassigned');
          setDueDate(data.due_date ?? '');
          setPriority((data.priority as TaskPriority) ?? 'normal');
          setStatus((data.status as 'open' | 'done') ?? 'open');
        }
        return;
      }
      // create mode — apply context
      resetForm();
      if (context?.productId) {
        const { data: p } = await supabase
          .from('products').select('id, name, customer_rfq_id').eq('id', context.productId).maybeSingle();
        if (p) {
          setMode('inquiry');
          setInquiryId(p.customer_rfq_id ?? null);
          setProductId(p.id);
        }
      } else if (context?.inquiryId) {
        setMode('inquiry');
        setInquiryId(context.inquiryId);
      } else if (context?.customerId) {
        setMode('customer');
        setCustomerId(context.customerId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  // Load products when inquiry changes
  useEffect(() => {
    if (!inquiryId) { setProducts([]); return; }
    (async () => {
      const { data } = await supabase
        .from('products').select('id, name, customer_rfq_id').eq('customer_rfq_id', inquiryId).order('name');
      setProducts((data as any) ?? []);
    })();
  }, [inquiryId]);

  const resetForm = () => {
    setMode('inquiry');
    setInquiryId(null); setProductId(null); setCustomerId(null);
    setTitle(''); setDescription(''); setAssignee('unassigned');
    setDueDate(''); setPriority('normal'); setStatus('open');
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === 'inquiry') { setCustomerId(null); }
    else { setInquiryId(null); setProductId(null); }
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (mode === 'inquiry' && !inquiryId) { toast.error('Inquiry is required'); return; }
    if (mode === 'customer' && !customerId) { toast.error('Customer is required'); return; }

    setSaving(true);
    const payload: any = {
      title: title.trim(),
      description: description.trim() || null,
      assignee: assignee === 'unassigned' ? null : assignee,
      due_date: dueDate || null,
      priority,
      inquiry_id: mode === 'inquiry' ? inquiryId : null,
      customer_id: mode === 'customer' ? customerId : null,
      product_id: mode === 'inquiry' ? productId : null,
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
    onOpenChange(false);
  };

  const selectedInquiry = inquiries.find(i => i.id === inquiryId);
  const selectedProduct = products.find(p => p.id === productId);
  const selectedCustomer = customers.find(c => c.id === customerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto mx-2 sm:mx-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit task' : 'New task'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Mode toggle */}
          <div className="flex rounded-md border p-0.5 bg-muted/30">
            <button
              type="button"
              onClick={() => switchMode('inquiry')}
              className={cn('flex-1 text-xs py-1.5 rounded-sm transition',
                mode === 'inquiry' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground')}
            >Inquiry</button>
            <button
              type="button"
              onClick={() => switchMode('customer')}
              className={cn('flex-1 text-xs py-1.5 rounded-sm transition',
                mode === 'customer' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground')}
            >Customer</button>
          </div>

          {mode === 'inquiry' && (
            <>
              <div>
                <Label className="text-xs">Inquiry *</Label>
                <Popover open={inquiryOpen} onOpenChange={setInquiryOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal mt-1">
                      <span className="truncate">
                        {selectedInquiry ? `${selectedInquiry.rfq_number} — ${selectedInquiry.title || 'Untitled'}` : 'Select inquiry...'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search inquiries..." />
                      <CommandList>
                        <CommandEmpty>No inquiries.</CommandEmpty>
                        <CommandGroup>
                          {inquiries.map(i => (
                            <CommandItem key={i.id} value={`${i.rfq_number} ${i.title ?? ''}`}
                              onSelect={() => {
                                if (inquiryId !== i.id) setProductId(null);
                                setInquiryId(i.id); setInquiryOpen(false);
                              }}>
                              <Check className={cn('mr-2 h-4 w-4', inquiryId === i.id ? 'opacity-100' : 'opacity-0')} />
                              <span className="truncate">{i.rfq_number} — {i.title || 'Untitled'}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {inquiryId && (
                <div>
                  <Label className="text-xs">Product (optional)</Label>
                  <Popover open={productOpen} onOpenChange={setProductOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal mt-1">
                        <span className="truncate">{selectedProduct ? selectedProduct.name : 'No product'}</span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search products..." />
                        <CommandList>
                          <CommandEmpty>No products in this inquiry.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem value="__none__" onSelect={() => { setProductId(null); setProductOpen(false); }}>
                              <Check className={cn('mr-2 h-4 w-4', !productId ? 'opacity-100' : 'opacity-0')} />
                              <span className="text-muted-foreground">No product</span>
                            </CommandItem>
                            {products.map(p => (
                              <CommandItem key={p.id} value={p.name}
                                onSelect={() => { setProductId(p.id); setProductOpen(false); }}>
                                <Check className={cn('mr-2 h-4 w-4', productId === p.id ? 'opacity-100' : 'opacity-0')} />
                                <span className="truncate">{p.name}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </>
          )}

          {mode === 'customer' && (
            <div>
              <Label className="text-xs">Customer *</Label>
              <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal mt-1">
                    <span className="truncate">{selectedCustomer ? selectedCustomer.name : 'Select customer...'}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search customers..." />
                    <CommandList>
                      <CommandEmpty>No customers.</CommandEmpty>
                      <CommandGroup>
                        {customers.map(c => (
                          <CommandItem key={c.id} value={`${c.name} ${c.company ?? ''}`}
                            onSelect={() => { setCustomerId(c.id); setCustomerOpen(false); }}>
                            <Check className={cn('mr-2 h-4 w-4', customerId === c.id ? 'opacity-100' : 'opacity-0')} />
                            <div className="flex flex-col">
                              <span>{c.name}</span>
                              {c.company && <span className="text-xs text-muted-foreground">{c.company}</span>}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

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
                  <SelectItem value="CQ">CQ</SelectItem>
                  <SelectItem value="PH">PH</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Due date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 h-9 text-sm" />
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
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
