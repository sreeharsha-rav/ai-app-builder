'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, MailPlus, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import { del, get, post, put } from './api-client';
import { EmptyState, InlineError, PageHeader } from './bits';
import { fmtDate, initials } from '@/lib/format';

export default function MembersView({ ctx, workspaceId, refreshKey, session }) {
  const [members, setMembers] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'member', member_scope: 'all' });
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);

  useEffect(() => {
    let alive = true;
    setMembers(null);
    (async () => {
      try {
        const d = await get('/workspaces/' + workspaceId + '/members');
        if (alive) { setMembers(d); setErr(null); }
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [workspaceId, refreshKey, tick]);

  const isPersonal = ctx.workspace.type === 'personal';

  async function invite() {
    setBusy(true);
    try {
      await post('/workspaces/' + workspaceId + '/members', form);
      toast.success('Invite created for ' + form.email);
      setOpen(false);
      setForm({ email: '', role: 'member', member_scope: 'all' });
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(m, body) {
    try {
      await put('/workspaces/' + workspaceId + '/members/' + m.id, body);
      toast.success('Member updated');
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e.message);
      setTick((t) => t + 1);
    }
  }

  async function remove() {
    if (!confirmRemove) return;
    try {
      await del('/workspaces/' + workspaceId + '/members/' + confirmRemove.id);
      toast.success('Member removed');
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setConfirmRemove(null);
    }
  }

  async function resend(m) {
    try {
      const r = await post('/workspaces/' + workspaceId + '/members/' + m.id + '/resend');
      toast.success(r.note || 'Invite resent');
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <PageHeader title="Members & roles"
          description={isPersonal ? 'Personal workspaces have a single owner.' : 'Roles and data scope are enforced on the server for every request.'}
          actions={!isPersonal ? <Button className="gap-1.5" onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" /> Invite member</Button> : null} />

        {err ? <InlineError message={err} onRetry={() => setTick((t) => t + 1)} /> : null}

        {!members ? (
          <Card><CardContent className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</CardContent></Card>
        ) : members.length <= 1 && isPersonal ? (
          <EmptyState icon={Users} title="Just you" description="Create an organization workspace to collaborate with a team." />
        ) : (
          <Card>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Joined</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => {
                      const isSelf = m.user_id === session.user.id;
                      const isOwner = m.role === 'owner';
                      const pending = m.status === 'pending';
                      const roleLocked = isOwner || isSelf || !ctx.caps.role_change;
                      return (
                        <TableRow key={m.id} className={pending ? 'bg-muted/50' : ''}>
                          <TableCell className="pl-6">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center border bg-muted text-xs font-semibold">
                                {initials(m.display_name || m.invited_email)}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{m.display_name || m.invited_email}{isSelf ? ' (you)' : ''}</p>
                                <p className="truncate text-xs text-muted-foreground">{m.email || m.invited_email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {roleLocked ? (
                              isSelf ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div>
                                      <Select value={m.role} disabled>
                                        <SelectTrigger className="h-8 w-[110px] capitalize"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value={m.role} className="capitalize">{m.role}</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>You cannot change your own role.</TooltipContent>
                                </Tooltip>
                              ) : (
                                <Badge variant="secondary" className="border capitalize">{m.role}</Badge>
                              )
                            ) : (
                              <Select value={m.role} onValueChange={(v) => patch(m, { role: v })}>
                                <SelectTrigger className="h-8 w-[110px] capitalize"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">Admin</SelectItem>
                                  <SelectItem value="member">Member</SelectItem>
                                  <SelectItem value="viewer">Viewer</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>
                            {isOwner ? <span className="text-xs text-muted-foreground">All</span> : (
                              <div className="flex items-center gap-2">
                                <Switch checked={m.member_scope === 'all'} disabled={isSelf}
                                  onCheckedChange={(v) => patch(m, { member_scope: v ? 'all' : 'own_only' })} />
                                <span className="text-xs text-muted-foreground">{m.member_scope === 'all' ? 'All' : 'Own only'}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={'border capitalize ' + (pending ? 'border-warning/50 text-warning' : 'border-success/50 text-success')}>
                              {m.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                            {m.joined_at ? fmtDate(m.joined_at) : '\u2014'}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex justify-end gap-1">
                              {pending ? (
                                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => resend(m)}>
                                  <RefreshCw className="h-3.5 w-3.5" /> Resend
                                </Button>
                              ) : null}
                              {!isOwner ? (
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Remove member"
                                  onClick={() => setConfirmRemove(m)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>
                The invite appears in their workspace switcher when they sign in or sign up with this email. Email delivery is not enabled in this build.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" value={form.email} placeholder="teammate@company.com"
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin &mdash; manage budgets and members</SelectItem>
                    <SelectItem value="member">Member &mdash; add and edit transactions</SelectItem>
                    <SelectItem value="viewer">Viewer &mdash; read only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between border p-3">
                <div>
                  <p className="text-sm font-medium">Can see all transactions</p>
                  <p className="text-xs text-muted-foreground">Turn off to restrict them to their own entries.</p>
                </div>
                <Switch checked={form.member_scope === 'all'}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, member_scope: v ? 'all' : 'own_only' }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={invite} disabled={busy || !form.email.includes('@')} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />} Send invite
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this member?</AlertDialogTitle>
              <AlertDialogDescription>
                {(confirmRemove?.display_name || confirmRemove?.invited_email) + ' will lose access to this workspace immediately. Their transactions stay in the ledger.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); remove(); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
