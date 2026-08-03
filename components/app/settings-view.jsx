'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShieldAlert } from 'lucide-react';
import { del, get, put } from './api-client';
import { PageHeader } from './bits';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

export default function SettingsView({ ctx, workspaceId, bump, session, setSession, setActiveId }) {
  const [name, setName] = useState(ctx.workspace.name);
  const [currency, setCurrency] = useState(ctx.workspace.currency_code);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await put('/workspaces/' + workspaceId, { name, currency_code: currency });
      const s = await get('/auth/me');
      setSession(s);
      bump();
      toast.success('Workspace updated');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    setDeleting(true);
    try {
      await del('/workspaces/' + workspaceId, { confirm_name: confirmName });
      const s = await get('/auth/me');
      setSession(s);
      setActiveId(s.workspaces[0]?.id || null);
      toast.success('Workspace deleted');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  }

  const isPersonal = ctx.workspace.type === 'personal';

  return (
    <div className="space-y-4">
      <PageHeader title="Workspace settings" description="Only the owner can change these values." />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">General</CardTitle>
              <CardDescription>
                Workspace type <Badge variant="secondary" className="border capitalize">{ctx.workspace.type}</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ws-name">Workspace name</Label>
                <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-md" />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Currency locks once the workspace has transactions, so historical amounts can never become ambiguous.
                </p>
              </div>
              <Button onClick={save} disabled={busy || name.trim().length < 2}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger" className="mt-4">
          <Card className="border-destructive/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <ShieldAlert className="h-4 w-4" /> Delete workspace
              </CardTitle>
              <CardDescription>
                {isPersonal
                  ? 'Your personal workspace cannot be deleted.'
                  : 'This permanently removes all transactions, budgets, categories, members and audit history.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="confirm">Type <span className="font-mono font-semibold">{ctx.workspace.name}</span> to confirm</Label>
                <Input id="confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
                  className="max-w-md" disabled={isPersonal} placeholder={ctx.workspace.name} />
              </div>
              <Button variant="destructive" disabled={isPersonal || deleting || confirmName !== ctx.workspace.name} onClick={destroy}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete this workspace'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
