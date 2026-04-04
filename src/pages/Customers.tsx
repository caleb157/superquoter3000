import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Users, FolderOpen, ArrowLeft, Mail, Building2 } from 'lucide-react';
import { toast } from 'sonner';

const Customers = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  const fetchAll = async () => {
    const [custRes, projRes] = await Promise.all([
      (supabase as any).from('customers').select('*').order('name'),
      supabase.from('projects').select('id, name, status, customer_id, customer_name, updated_at').order('updated_at', { ascending: false }),
    ]);
    setCustomers(custRes.data || []);
    setProjects(projRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const projectsByCustomer = useMemo(() => {
    const map: Record<string, any[]> = {};
    projects.forEach(p => {
      if (p.customer_id) {
        if (!map[p.customer_id]) map[p.customer_id] = [];
        map[p.customer_id].push(p);
      }
    });
    return map;
  }, [projects]);

  const filtered = customers.filter((c: any) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.company || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const createCustomer = async () => {
    if (!newName.trim()) return;
    const { error } = await (supabase as any).from('customers').insert({
      name: newName.trim(),
      email: newEmail.trim() || null,
      company: newCompany.trim() || null,
      phone: newPhone.trim() || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Customer created');
    setNewName(''); setNewEmail(''); setNewCompany(''); setNewPhone('');
    setShowCreate(false);
    fetchAll();
  };

  const STATUS_COLORS: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    costing: 'bg-amber-100 text-amber-700',
    quoted: 'bg-blue-100 text-blue-700',
    po_confirmed: 'bg-emerald-100 text-emerald-700',
    archived: 'bg-gray-200 text-gray-500',
  };

  // Detail view for a selected customer
  if (selectedCustomer) {
    const custProjects = projectsByCustomer[selectedCustomer.id] || [];
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto space-y-4">
          <Button variant="ghost" size="sm" className="gap-1.5 mb-2" onClick={() => setSelectedCustomer(null)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Customers
          </Button>

          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{selectedCustomer.name}</h1>
              <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                {selectedCustomer.company && (
                  <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{selectedCustomer.company}</span>
                )}
                {selectedCustomer.email && (
                  <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{selectedCustomer.email}</span>
                )}
              </div>
            </div>
          </div>

          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mt-6">
            Projects ({custProjects.length})
          </h2>

          {custProjects.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              No projects for this customer yet.
            </CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Project</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {custProjects.map((p: any) => (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/project/${p.id}`)}>
                        <TableCell className="font-medium text-sm">{p.name}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[p.status] || ''} variant="secondary">
                            {p.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          {new Date(p.updated_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">Customers</h1>
          <div className="relative flex-1 max-w-sm ml-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="ml-auto">
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Customer</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Name *" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                  <Input placeholder="Company" value={newCompany} onChange={e => setNewCompany(e.target.value)} />
                  <Input placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                  <Input placeholder="Phone" value={newPhone} onChange={e => setNewPhone(e.target.value)} />
                  <Button onClick={createCustomer} className="w-full">Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No customers yet.</p>
          </CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Name</TableHead>
                    <TableHead className="text-xs">Company</TableHead>
                    <TableHead className="text-xs">Email</TableHead>
                    <TableHead className="text-xs text-right">Projects</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c: any) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedCustomer(c)}>
                      <TableCell className="font-medium text-sm">{c.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.company || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.email || '—'}</TableCell>
                      <TableCell className="text-xs text-right">
                        {(projectsByCustomer[c.id] || []).length}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default Customers;
