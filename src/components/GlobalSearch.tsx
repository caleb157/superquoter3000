import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import {
  Inbox, Users, ShoppingCart, CheckSquare, FileText, Package2, Truck, Settings,
  HelpCircle, ArrowRight,
} from 'lucide-react';

type Result = {
  type: 'inquiry' | 'customer' | 'product';
  id: string;
  label: string;
  sub?: string;
  to: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowHelp?: () => void;
};

export function GlobalSearch({ open, onOpenChange, onShowHelp }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  // Reset query when reopened
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const like = `%${q}%`;
        const [inq, cust, prod] = await Promise.all([
          supabase
            .from('customer_rfqs')
            .select('id, rfq_number, title')
            .or(`rfq_number.ilike.${like},title.ilike.${like}`)
            .limit(8),
          supabase
            .from('customers')
            .select('id, name, company')
            .or(`name.ilike.${like},company.ilike.${like}`)
            .limit(8),
          supabase
            .from('products')
            .select('id, name, sku')
            .or(`name.ilike.${like},sku.ilike.${like}`)
            .limit(8),
        ]);

        if (cancelled) return;

        const r: Result[] = [];
        (inq.data ?? []).forEach((i: any) => r.push({
          type: 'inquiry', id: i.id,
          label: i.rfq_number, sub: i.title ?? undefined,
          to: `/inquiry/${i.id}`,
        }));
        (cust.data ?? []).forEach((c: any) => r.push({
          type: 'customer', id: c.id,
          label: c.name || c.company || 'Unnamed',
          sub: c.name && c.company ? c.company : undefined,
          to: `/customers/${c.id}`,
        }));
        (prod.data ?? []).forEach((p: any) => r.push({
          type: 'product', id: p.id,
          label: p.name, sub: p.sku ?? undefined,
          to: `/product/${p.id}`,
        }));
        setResults(r);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => { cancelled = true; window.clearTimeout(t); };
  }, [query, open]);

  const grouped = useMemo(() => ({
    inquiry: results.filter(r => r.type === 'inquiry'),
    customer: results.filter(r => r.type === 'customer'),
    product: results.filter(r => r.type === 'product'),
  }), [results]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  const navItems: { label: string; to: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
    { label: 'Inquiries', to: '/', icon: Inbox, hint: 'g i' },
    { label: 'Customers', to: '/customers', icon: Users, hint: 'g c' },
    { label: 'Products', to: '/products', icon: ShoppingCart, hint: 'g p' },
    { label: 'Tasks', to: '/tasks', icon: CheckSquare, hint: 'g t' },
    { label: 'Quotes', to: '/quotes', icon: FileText, hint: 'g q' },
    { label: 'Samples', to: '/samples', icon: Package2, hint: 'g s' },
    { label: 'Vendors', to: '/vendors', icon: Truck, hint: 'g v' },
    { label: 'Settings', to: '/settings', icon: Settings, hint: '' },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search inquiries, customers, products… (⌘K)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? 'Searching…' : query ? 'No results.' : 'Type to search.'}
        </CommandEmpty>

        {grouped.inquiry.length > 0 && (
          <CommandGroup heading="Inquiries">
            {grouped.inquiry.map(r => (
              <CommandItem key={r.id} value={`inquiry-${r.id}-${r.label}-${r.sub ?? ''}`} onSelect={() => go(r.to)}>
                <Inbox className="text-muted-foreground" />
                <span className="font-mono text-xs">{r.label}</span>
                {r.sub && <span className="ml-2 truncate text-muted-foreground">{r.sub}</span>}
                <ArrowRight className="ml-auto opacity-40" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {grouped.customer.length > 0 && (
          <CommandGroup heading="Customers">
            {grouped.customer.map(r => (
              <CommandItem key={r.id} value={`customer-${r.id}-${r.label}-${r.sub ?? ''}`} onSelect={() => go(r.to)}>
                <Users className="text-muted-foreground" />
                <span>{r.label}</span>
                {r.sub && <span className="ml-2 truncate text-muted-foreground">{r.sub}</span>}
                <ArrowRight className="ml-auto opacity-40" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {grouped.product.length > 0 && (
          <CommandGroup heading="Products">
            {grouped.product.map(r => (
              <CommandItem key={r.id} value={`product-${r.id}-${r.label}-${r.sub ?? ''}`} onSelect={() => go(r.to)}>
                <ShoppingCart className="text-muted-foreground" />
                <span className="truncate">{r.label}</span>
                {r.sub && <span className="ml-2 font-mono text-xs text-muted-foreground">{r.sub}</span>}
                <ArrowRight className="ml-auto opacity-40" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.length > 0 && <CommandSeparator />}

        <CommandGroup heading="Go to">
          {navItems.map(n => (
            <CommandItem key={n.to} value={`nav-${n.label}`} onSelect={() => go(n.to)}>
              <n.icon className="text-muted-foreground" />
              <span>{n.label}</span>
              {n.hint && (
                <span className="ml-auto text-[10px] tracking-widest text-muted-foreground">{n.hint}</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        {onShowHelp && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Help">
              <CommandItem value="help-shortcuts" onSelect={() => { onOpenChange(false); onShowHelp(); }}>
                <HelpCircle className="text-muted-foreground" />
                <span>Keyboard shortcuts</span>
                <span className="ml-auto text-[10px] tracking-widest text-muted-foreground">?</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
