import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, FileText, FolderOpen, Package2, ListChecks, Plus, Link2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { NewRfsDialog } from '@/components/NewRfsDialog';

const STATUS_OPTIONS = ['open', 'costing', 'quoted', 'sample', 'po', 'closed'];
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'];

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  costing: 'bg-amber-100 text-amber-700',
  quoted: 'bg-purple-100 text-purple-700',
  sample: 'bg-cyan-100 text-cyan-700',
  po: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-200 text-gray-600',
};

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inquiry, setInquiry] = useState<any | null>(null);
  const [customer, setCustomer] = useState<any | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [rfsItems, setRfsItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkProjectId, setLinkProjectId] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewRfs, setShowNewRfs] = useState(false);

  const fetchAll = async () => {
    if (!id) return;
    const { data: inq } = await (supabase as any).from('customer_rfqs').select('*').eq('id', id).single();
    setInquiry(inq);
    if (inq?.customer_id) {
      const { data: c } = await (supabase as any).from('customers').select('*').eq('id', inq.customer_id).single();
      setCustomer(c);
    }
    const [pRes, allPRes, qRes, rfsRes] = await Promise.all([
      supabase.from('projects').select('*').eq('customer_rfq_id' as any, id),
      supabase.from('projects').select('id, name, customer_id, customer_rfq_id, status').order('updated_at', { ascending: false }).limit(200),
      (supabase as any).from('quote_snapshots').select('id, quote_number, status, created_at, project_id, totals'),
      (supabase as any).from('rfs').select('*').eq('customer_rfq_id', id).order('requested_date', { ascending: false }),
    ]);
    setProjects(pRes.data || []);
    setAllProjects(allPRes.data || []);
    // quotes that match any of our linked projects
    const projIds = new Set((pRes.data || []).map((p: any) => p.id));
    setQuotes((qRes.data || []).filter((q: any) => projIds.has(q.project_id)));
    setRfsItems(rfsRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [id]);

  const update = (patch: any) => { setInquiry((i: any) => ({ ...i, ...patch })); setDirty(true); };

  const save = async () => {
    if (!inquiry) return;
    const { error } = await (supabase as any).from('customer_rfqs').update({
      title: inquiry.title, status: inquiry.status, priority: inquiry.priority,
      assigned_to: inquiry.assigned_to, target_completion_date: inquiry.target_completion_date,
      requirements: inquiry.requirements, notes: inquiry.notes,
    }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Saved');
    setDirty(false);
  };

  const linkProject = async () => {
    if (!linkProjectId) return;
    const { error } = await supabase.from('projects').update({ customer_rfq_id: id, customer_id: inquiry.customer_id } as any).eq('id', linkProjectId);
    if (error) { toast.error(error.message); return; }
    toast.success('Project linked');
    setShowLink(false);
    setLinkProjectId('');
    fetchAll();
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    const { data, error } = await supabase.from('projects').insert({
      name: newProjectName.trim(),
      customer_id: inquiry.customer_id,
      customer_name: customer?.name || null,
      customer_email: customer?.email || null,
      customer_rfq_id: id,
      status: 'costing',
    } as any).select().single();
    if (error) { toast.error(error.message); return; }
    toast.success('Project created');
    setShowNewProject(false);
    setNewProjectName('');
    if (data) navigate(`/project/${data.id}`);
  };

  if (loading || !inquiry) {
    return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading...</div></AppLayout>;
  }

  const unlinkedProjects = allProjects.filter(p => !p.customer_rfq_id || p.customer_rfq_id === id);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/inquiries')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Inquiries
        </Button>

        <div className="flex items-start gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm text-muted-foreground">{inquiry.rfq_number}</span>
              <Badge className={STATUS_COLOR[inquiry.status] || ''} variant="secondary">{inquiry.status}</Badge>
              <Badge variant="outline" className="text-[10px] capitalize">{inquiry.priority}</Badge>
            </div>
            <h1 className="text-xl font-bold">{inquiry.title || 'Untitled Inquiry'}</h1>
            {customer && (
              <button className="text-sm text-muted-foreground hover:text-foreground mt-1" onClick={() => navigate('/customers')}>
                {customer.name}{customer.company ? ` · ${customer.company}` : ''}
              </button>
            )}
          </div>
          {dirty && (
            <Button size="sm" className="ml-auto gap-1.5" onClick={save}>
              <Save className="h-4 w-4" /> Save changes
            </Button>
          )}
        </div>

        <Card><CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={inquiry.title || ''} onChange={e => update({ title: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={inquiry.status} onValueChange={v => update({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={inquiry.priority} onValueChange={v => update({ priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Assigned to</Label>
            <Input value={inquiry.assigned_to || ''} onChange={e => update({ assigned_to: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Received</Label>
            <Input type="date" value={inquiry.received_date || ''} disabled />
          </div>
          <div>
            <Label className="text-xs">Target completion</Label>
            <Input type="date" value={inquiry.target_completion_date || ''} onChange={e => update({ target_completion_date: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs">Requirements</Label>
            <Textarea rows={3} value={inquiry.requirements || ''} onChange={e => update({ requirements: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={inquiry.notes || ''} onChange={e => update({ notes: e.target.value })} />
          </div>
        </CardContent></Card>

        <Tabs defaultValue="projects">
          <TabsList>
            <TabsTrigger value="projects" className="text-xs gap-1.5"><FolderOpen className="h-3.5 w-3.5" /> Projects ({projects.length})</TabsTrigger>
            <TabsTrigger value="quotes" className="text-xs gap-1.5"><FileText className="h-3.5 w-3.5" /> Quotes ({quotes.length})</TabsTrigger>
            <TabsTrigger value="samples" className="text-xs gap-1.5"><Package2 className="h-3.5 w-3.5" /> Samples ({rfsItems.length})</TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Tasks</TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="mt-3 space-y-2">
            <div className="flex gap-2">
              <Dialog open={showLink} onOpenChange={setShowLink}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5"><Link2 className="h-3.5 w-3.5" /> Link existing project</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Link Project</DialogTitle></DialogHeader>
                  <Select value={linkProjectId} onValueChange={setLinkProjectId}>
                    <SelectTrigger><SelectValue placeholder="Pick a project..." /></SelectTrigger>
                    <SelectContent>
                      {unlinkedProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button onClick={linkProject} disabled={!linkProjectId} className="w-full">Link</Button>
                </DialogContent>
              </Dialog>

              <Dialog open={showNewProject} onOpenChange={setShowNewProject}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New project from this inquiry</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
                  <Input placeholder="Project name" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} autoFocus />
                  <Button onClick={createProject} className="w-full">Create</Button>
                </DialogContent>
              </Dialog>
            </div>
            {projects.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No projects linked yet.</CardContent></Card>
            ) : (
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Project</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Updated</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {projects.map(p => (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/project/${p.id}`)}>
                        <TableCell className="font-medium text-sm">{p.name}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{p.status?.replace('_', ' ')}</Badge></TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="quotes" className="mt-3">
            {quotes.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No quotes yet for the linked projects.</CardContent></Card>
            ) : (
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Quote #</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Created</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {quotes.map((q: any) => (
                      <TableRow key={q.id}>
                        <TableCell className="font-mono text-xs">{q.quote_number || q.id.slice(0, 8)}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{q.status}</Badge></TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{new Date(q.created_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="samples" className="mt-3 space-y-2">
            <Button size="sm" className="gap-1.5" onClick={() => setShowNewRfs(true)}>
              <Plus className="h-3.5 w-3.5" /> New RFS for this inquiry
            </Button>
            {rfsItems.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No sample requests yet.</CardContent></Card>
            ) : (
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">RFS</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Required by</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rfsItems.map((r: any) => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate('/samples')}>
                        <TableCell className="font-mono text-xs">{r.rfs_number}</TableCell>
                        <TableCell className="text-sm">{r.title || '—'}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{r.status?.replace('_', ' ')}</Badge></TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{r.required_by_date ? new Date(r.required_by_date).toLocaleDateString() : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="tasks" className="mt-3">
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              Task linking to inquiries will arrive in the next phase. For now, manage tasks from the Pipeline page.
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <NewRfsDialog open={showNewRfs} onOpenChange={setShowNewRfs} inquiryId={id} onCreated={fetchAll} />
    </AppLayout>
  );
}
