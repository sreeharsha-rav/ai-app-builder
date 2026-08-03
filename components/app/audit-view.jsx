'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollText } from 'lucide-react';
import { get } from './api-client';
import { EmptyState, InlineError, PageHeader } from './bits';
import { fmtDateTime, initials } from '@/lib/format';

const ACTIONS = ['all', 'create', 'update', 'delete', 'invite', 'role_change'];
const TONE = {
  create: 'border-success/50 text-success',
  update: 'border-border text-muted-foreground',
  delete: 'border-destructive/50 text-destructive',
  invite: 'border-primary/50 text-primary',
  role_change: 'border-warning/50 text-warning',
};

export default function AuditView({ workspaceId, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ action: 'all', actor: 'all', from: '', to: '' });

  useEffect(() => {
    let alive = true;
    setRows(null);
    const qs = new URLSearchParams();
    if (f.action !== 'all') qs.set('action', f.action);
    if (f.actor !== 'all') qs.set('actor', f.actor);
    if (f.from) qs.set('from', f.from);
    if (f.to) qs.set('to', f.to);
    (async () => {
      try {
        const d = await get('/workspaces/' + workspaceId + '/audit?' + qs.toString());
        if (alive) { setRows(d); setErr(null); }
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [workspaceId, refreshKey, f]);

  const actors = [...new Map((rows || []).map((r) => [r.actor_id, r.actor_name])).entries()];

  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" description="Every mutation in this workspace, newest first. Read-only." />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Select value={f.action} onValueChange={(v) => setF((x) => ({ ...x, action: v }))}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTIONS.map((a) => <SelectItem key={a} value={a} className="capitalize">{a === 'all' ? 'All actions' : a.replace('_', ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={f.actor} onValueChange={(v) => setF((x) => ({ ...x, actor: v }))}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Actor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actors</SelectItem>
              {actors.map(([id, name]) => <SelectItem key={id} value={id}>{name || 'Unknown'}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" className="w-[150px]" value={f.from} onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} />
          <span className="text-muted-foreground">&ndash;</span>
          <Input type="date" className="w-[150px]" value={f.to} onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} />
        </CardContent>
      </Card>

      {err ? <InlineError message={err} /> : null}

      {!rows ? (
        <Card><CardContent className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</CardContent></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" description="Actions will appear here as soon as someone changes data in this workspace." />
      ) : (
        <Card>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead className="pr-6">Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap pl-6 text-xs text-muted-foreground">{fmtDateTime(r.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center border bg-muted text-[10px] font-semibold">{initials(r.actor_name)}</span>
                          <span className="whitespace-nowrap text-sm">{r.actor_name || 'Unknown'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={'border text-[10px] uppercase ' + (TONE[r.action] || '')}>{r.action.replace('_', ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-sm capitalize text-muted-foreground">{r.entity_type}</TableCell>
                      <TableCell className="pr-6 text-sm">{r.summary || '\u2014'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
