import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, FolderOpen, Search } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  costing: 'bg-amber-100 text-amber-700',
  quoted: 'bg-blue-100 text-blue-700',
  po_confirmed: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-gray-200 text-gray-500',
};

const Dashboard = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCustomer, setNewCustomer] = useState('');

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (data) setProjects(data);
    if (error) toast.error(error.message);
    setLoading(false);
  };

  useEffect(() => { fetchProjects(); }, []);

  const createProject = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from('projects').insert({
      name: newName.trim(),
      customer_name: newCustomer.trim() || null,
      created_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Project created');
    setNewName(''); setNewCustomer(''); setShowCreate(false);
    fetchProjects();
  };

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.customer_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: projects.length,
    active: projects.filter(p => ['costing', 'quoted'].includes(p.status)).length,
    confirmed: projects.filter(p => p.status === 'po_confirmed').length,
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total Projects</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-amber-600">{stats.active}</div>
            <div className="text-xs text-muted-foreground">Active</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-emerald-600">{stats.confirmed}</div>
            <div className="text-xs text-muted-foreground">PO Confirmed</div>
          </CardContent></Card>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Project</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Project name" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                <Input placeholder="Customer name (optional)" value={newCustomer} onChange={e => setNewCustomer(e.target.value)} />
                <Button onClick={createProject} className="w-full">Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Project list */}
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No projects yet. Create your first one!</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {filtered.map(p => (
              <Link key={p.id} to={`/project/${p.id}`}>
                <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                  <CardContent className="py-3 px-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{p.name}</div>
                      {p.customer_name && (
                        <div className="text-xs text-muted-foreground">{p.customer_name}</div>
                      )}
                    </div>
                    <Badge className={STATUS_COLORS[p.status] || ''} variant="secondary">
                      {p.status.replace('_', ' ')}
                    </Badge>
                    <div className="text-xs text-muted-foreground w-24 text-right">
                      {new Date(p.updated_at).toLocaleDateString()}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
