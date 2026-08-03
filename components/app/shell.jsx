'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  LayoutDashboard, ArrowLeftRight, Target, Sparkles, Tags, Users, ScrollText, Settings,
  ChevronsUpDown, Check, Plus, Building2, User, LogOut, Moon, Sun, BarChart3, Download, Loader2, MailPlus,
} from 'lucide-react';
import { get, post } from './api-client';
import TxnSheet from './txn-sheet';
import DashboardView from './dashboard-view';
import TransactionsView from './transactions-view';
import BudgetsView from './budgets-view';
import CategoriesView from './categories-view';
import MembersView from './members-view';
import InsightsView from './insights-view';
import AuditView from './audit-view';
import SettingsView from './settings-view';
import ProfileView from './profile-view';

const ICONS = { LayoutDashboard, ArrowLeftRight, Target, Sparkles, Tags, Users, ScrollText, Settings };
const LABELS = {
  dashboard: 'Dashboard', transactions: 'Transactions', budgets: 'Budgets', insights: 'Insights',
  categories: 'Categories', members: 'Members', audit: 'Audit log', settings: 'Workspace settings', profile: 'Profile',
};
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('ledger-theme', next ? 'dark' : 'light');
    setDark(next);
  };
  return { dark, toggle };
}

function InstallPrompt() {
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    const h = (e) => { e.preventDefault(); setEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (!evt) return null;
  return (
    <Button variant="outline" size="sm" className="gap-2"
      onClick={async () => { evt.prompt(); setEvt(null); }}>
      <Download className="h-4 w-4" /> Install
    </Button>
  );
}

export default function Shell({ session, setSession, onLogout }) {
  const workspaces = session.workspaces || [];
  const invites = session.invites || [];

  const [activeId, setActiveId] = useState(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('ledger-ws') : null;
    return workspaces.find((w) => w.id === stored)?.id || workspaces[0]?.id || null;
  });
  const [ctx, setCtx] = useState(null);
  const [switching, setSwitching] = useState(true);
  const [view, setView] = useState('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [categories, setCategories] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgForm, setOrgForm] = useState({ name: '', currency_code: 'INR' });
  const [creating, setCreating] = useState(false);
  const { dark, toggle } = useTheme();

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  /* Role + scope are re-fetched on every workspace switch, before page data. */
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    setSwitching(true);
    setCtx(null);
    localStorage.setItem('ledger-ws', activeId);
    (async () => {
      try {
        const [c, cats] = await Promise.all([
          get('/workspaces/' + activeId),
          get('/workspaces/' + activeId + '/categories'),
        ]);
        if (!alive) return;
        setCtx(c);
        setCategories(cats);
        setView((v) => (c.nav.some((n) => n.key === v) || v === 'profile' ? v : 'dashboard'));
        get('/workspaces/' + activeId + '/merchants').then((m) => alive && setMerchants(m)).catch(() => {});
      } catch (e) {
        toast.error(e.message || 'Could not open workspace');
      } finally {
        if (alive) setSwitching(false);
      }
    })();
    return () => { alive = false; };
  }, [activeId, refreshKey]);

  const active = workspaces.find((w) => w.id === activeId);
  const canWrite = !!ctx?.caps?.txn_write;

  const openAdd = (txn) => { setEditing(txn || null); setAddOpen(true); };

  async function createOrg() {
    setCreating(true);
    try {
      const res = await post('/workspaces', { name: orgForm.name, currency_code: orgForm.currency_code });
      setSession({ ...session, workspaces: res.workspaces, invites: res.invites });
      setOrgOpen(false);
      setOrgForm({ name: '', currency_code: 'INR' });
      setActiveId(res.workspace.id);
      toast.success('Organization created');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function acceptInvite(membershipId) {
    try {
      const res = await post('/invites/' + membershipId + '/accept');
      setSession({ ...session, workspaces: res.workspaces, invites: res.invites });
      setActiveId(res.workspace.id);
      toast.success('Joined ' + res.workspace.name);
    } catch (e) {
      toast.error(e.message);
    }
  }

  const viewProps = { ctx, workspaceId: activeId, refreshKey, bump, openAdd, categories, setCategories, setView };

  function renderView() {
    if (switching || !ctx) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-9 w-56" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
          <Skeleton className="h-[280px] w-full" />
        </div>
      );
    }
    switch (view) {
      case 'transactions': return <TransactionsView {...viewProps} merchants={merchants} />;
      case 'budgets': return <BudgetsView {...viewProps} />;
      case 'categories': return <CategoriesView {...viewProps} />;
      case 'members': return <MembersView {...viewProps} session={session} />;
      case 'insights': return <InsightsView {...viewProps} />;
      case 'audit': return <AuditView {...viewProps} />;
      case 'settings': return <SettingsView {...viewProps} session={session} setSession={setSession} setActiveId={setActiveId} />;
      case 'profile': return <ProfileView session={session} setSession={setSession} dark={dark} toggleTheme={toggle} onLogout={onLogout} />;
      default: return <DashboardView {...viewProps} invitesDismissible session={session} />;
    }
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                    <div className="flex aspect-square size-8 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">
                      {active?.type === 'organization' ? <Building2 className="size-4" /> : <User className="size-4" />}
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{active?.name || 'Workspace'}</span>
                      <span className="truncate text-xs capitalize text-muted-foreground">{active?.type}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
                  {workspaces.map((w) => (
                    <DropdownMenuItem key={w.id} onSelect={() => setActiveId(w.id)} className="gap-2">
                      {w.type === 'organization' ? <Building2 className="size-4" /> : <User className="size-4" />}
                      <span className="flex-1 truncate">{w.name}</span>
                      <Badge variant="secondary" className="border text-[10px] capitalize">{w.type === 'organization' ? 'Org' : 'Personal'}</Badge>
                      {w.id === activeId ? <Check className="size-4" /> : null}
                    </DropdownMenuItem>
                  ))}
                  {invites.length ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">Pending invitations</DropdownMenuLabel>
                      {invites.map((i) => (
                        <DropdownMenuItem key={i.membership_id} onSelect={() => acceptInvite(i.membership_id)} className="gap-2">
                          <MailPlus className="size-4" />
                          <span className="flex-1 truncate">{i.name}</span>
                          <span className="text-xs text-primary">Accept</span>
                        </DropdownMenuItem>
                      ))}
                    </>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setOrgOpen(true)} className="gap-2">
                    <Plus className="size-4" /> Create organization
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              {(ctx?.nav || []).map((item) => {
                const Icon = ICONS[item.icon] || LayoutDashboard;
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton isActive={view === item.key} tooltip={item.label} onClick={() => setView(item.key)}>
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg">
                    <div className="flex aspect-square size-8 items-center justify-center border bg-muted text-xs font-semibold">
                      {(session.user.display_name || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{session.user.display_name}</span>
                      <span className="truncate text-xs text-muted-foreground">{ctx ? ctx.role + (ctx.scope === 'own_only' ? ' \u00b7 own only' : '') : session.user.email}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-56">
                  <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{session.user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setView('profile')} className="gap-2"><User className="size-4" /> Profile</DropdownMenuItem>
                  <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggle(); }} className="gap-2">
                    {dark ? <Sun className="size-4" /> : <Moon className="size-4" />} {dark ? 'Light mode' : 'Dark mode'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onLogout} className="gap-2 text-destructive"><LogOut className="size-4" /> Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-5" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:block">
                <BreadcrumbLink asChild><button type="button" onClick={() => setView('dashboard')} className="truncate">{active?.name || 'Ledger'}</button></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem><BreadcrumbPage>{LABELS[view] || 'Dashboard'}</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <InstallPrompt />
            <div className="hidden items-center gap-1.5 border px-2 py-1 text-xs text-muted-foreground md:flex">
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="capitalize">{ctx?.role || '\u2026'}</span>
              {ctx?.scope === 'own_only' ? <span className="text-warning">own only</span> : null}
            </div>
            {canWrite ? (
              <Button size="sm" className="hidden gap-1.5 md:inline-flex" onClick={() => openAdd(null)}>
                <Plus className="h-4 w-4" /> Add transaction
              </Button>
            ) : null}
          </div>
        </header>

        <main className="min-w-0 flex-1 space-y-5 p-3 pb-24 sm:p-5 md:pb-8">{renderView()}</main>

        {canWrite ? (
          <button type="button" aria-label="Add transaction" onClick={() => openAdd(null)}
            className="fab-offset fixed right-5 z-30 flex h-14 w-14 items-center justify-center border border-primary bg-primary text-primary-foreground transition-transform active:scale-95 md:hidden">
            <Plus className="h-6 w-6" />
          </button>
        ) : null}
      </SidebarInset>

      {ctx ? (
        <TxnSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          workspaceId={activeId}
          currency={ctx.workspace.currency_code}
          categories={categories}
          merchants={merchants}
          editing={editing}
          onSettled={() => bump()}
        />
      ) : null}

      <Dialog open={orgOpen} onOpenChange={setOrgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>You will be the owner. Invite teammates from the Members screen.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org">Organization name</Label>
              <Input id="org" value={orgForm.name} onChange={(e) => setOrgForm((f) => ({ ...f, name: e.target.value }))} placeholder="Acme Inc." />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={orgForm.currency_code} onValueChange={(v) => setOrgForm((f) => ({ ...f, currency_code: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrgOpen(false)}>Cancel</Button>
            <Button onClick={createOrg} disabled={creating || orgForm.name.trim().length < 2}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
