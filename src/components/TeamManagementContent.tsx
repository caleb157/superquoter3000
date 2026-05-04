import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { UserX } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';

type Row = {
  user_id: string;
  email: string;
  display_name: string | null;
  assignee_code: string | null;
  created_at: string;
  roles: string[];
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  team: 'bg-blue-100 text-blue-700 border-blue-200',
  guest: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function TeamManagementContent() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc('admin_list_users');
    if (error) { toast.error(error.message); setLoading(false); return; }
    setRows((data || []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const setRole = async (userId: string, role: string) => {
    setUpdatingId(userId);
    const { error } = await (supabase as any).rpc('admin_set_user_role', { _target_user_id: userId, _role: role });
    setUpdatingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Role updated');
    fetchUsers();
  };

  const removeRole = async (userId: string) => {
    if (!confirm('Remove all roles from this user? They will lose access.')) return;
    setUpdatingId(userId);
    const { error } = await (supabase as any).rpc('admin_remove_user_role', { _target_user_id: userId });
    setUpdatingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Roles removed');
    fetchUsers();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Assign roles to users. <b>Admin</b> = full access incl. settings & team. <b>Team</b> = full app access. <b>Guest</b> = restricted.
      </p>
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading users…</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Current role</TableHead>
                  <TableHead className="text-xs">Joined</TableHead>
                  <TableHead className="text-xs w-[260px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const currentRole = r.roles[0] || '';
                  const isSelf = r.user_id === user?.id;
                  return (
                    <TableRow key={r.user_id}>
                      <TableCell className="text-sm font-medium">
                        {r.email}
                        {isSelf && <span className="ml-2 text-[10px] text-muted-foreground">(you)</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.display_name || '—'}</TableCell>
                      <TableCell>
                        {currentRole ? (
                          <Badge variant="outline" className={`text-[10px] ${ROLE_COLORS[currentRole] || ''}`}>{currentRole}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">no role</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Select
                            value={currentRole}
                            onValueChange={(v) => setRole(r.user_id, v)}
                            disabled={updatingId === r.user_id || isSelf}
                          >
                            <SelectTrigger className="h-8 text-xs w-[140px]">
                              <SelectValue placeholder="Set role…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="team">Team</SelectItem>
                              <SelectItem value="guest">Guest</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={updatingId === r.user_id || isSelf || !currentRole}
                            onClick={() => removeRole(r.user_id)}
                            title="Remove all roles"
                          >
                            <UserX className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                        {isSelf && <p className="text-[10px] text-muted-foreground mt-1">Can't change your own role</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
