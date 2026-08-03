'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { del, get, post, put } from './api-client';
import { CatDot, EmptyState, InlineError, PageHeader } from './bits';
import { currencySymbol, fmtDate, money } from '@/lib/format';

const emptyForm = { category_id: 'overall', period: 'monthly', limit: '', rollover: false };

export default function BudgetsView({ ctx, workspaceId, refreshKey, categories }) {
  const currency = ctx.workspace.currency_code;
  const canWrite = !!ctx.caps.budget_write;
  const [budgets, setBudgets] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    let alive = true;
    setBudgets(null);
    (async () => {
      try {
        const d = await get('/workspaces/' + workspaceId + '/budgets');
        if (alive) { setBudgets(d); setErr(null); }
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [workspaceId, refreshKey, tick]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(b) {
    setEditing(b);
    setForm({
      category_id: b.category_id || 'overall',
      period: b.period,
      limit: String(b.limit_amount_minor / 100),
      rollover: !!b.rollover,
    });
    setOpen(true);
  }

  async function save() {
    const limit_amount_minor = Math.round(Number(form.limit) * 100);
    if (!Number.isFinite(limit_amount_minor) || limit_amount_minor <= 0) return toast.error('Enter a valid limit');
    setBusy(true);
    try {
      if (editing) {
        await put('/workspaces/' + workspaceId + '/budgets/' + editing.id, { limit_amount_minor, period: form.period, rollover: form.rollover });
        toast.success('Budget updated');
      } else {
        await post('/workspaces/' + workspaceId + '/budgets', {
          category_id: form.category_id === 'overall' ? null : form.category_id,
          period: form.period, limit_amount_minor, rollover: form.rollover,
        });
        toast.success('Budget created');
      }
      setOpen(false);
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirmDelete) return;
    try {
      await del('/workspaces/' + workspaceId + '/budgets/' + confirmDelete.id);
      toast.success('Budget deleted');
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setConfirmDelete(null);
    }
  }

  const usedCategoryIds = new Set((budgets || []).map((b) => b.category_id).filter(Boolean));
  const hasOverall = (budgets || []).some((b) => !b.category_id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Budgets"
        description={canWrite ? 'Set spend limits per category or overall.' : 'Budgets are read-only for your role.'}
        actions={canWrite ? <Button className="gap-1.5" onClick={openNew}><Plus className="h-4 w-4" /> New budget</Button> : null}
      />

      {err ? <InlineError message={err} onRetry={() => setTick((t) => t + 1)} /> : null}

      {!budgets ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : budgets.length === 0 ? (
        <EmptyState icon={Target} title="No budgets yet"
          description="Budgets turn raw spending into a signal. Start with an overall monthly limit."
          action={canWrite ? <Button className="gap-1.5" onClick={openNew}><Plus className="h-4 w-4" /> Create a budget</Button> : null} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((b) => {
            const pct = Math.min(Math.max(b.pct_used, 0), 100);
            const barClass = b.state === 'over' ? 'bg-destructive' : b.state === 'warning' ? 'bg-warning' : 'bg-primary';
            return (
              <Card key={b.id} className={b.state === 'over' ? 'border-destructive/50' : ''}>
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      {b.category_id ? <CatDot color={b.category_color} /> : <Target className="h-3.5 w-3.5 text-muted-foreground" />}
                      {b.category_name}
                    </CardTitle>
                    <Badge variant="secondary" className="border text-[10px] uppercase">{b.period}</Badge>
                  </div>
                  {canWrite ? (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(b)} aria-label="Edit budget"><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setConfirmDelete(b)} aria-label="Delete budget"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-semibold tnum">{money(b.spent_minor, currency)}</span>
                    <span className="text-xs text-muted-foreground tnum">of {money(b.limit_amount_minor, currency)}</span>
                  </div>
                  <div className="h-2 w-full bg-muted">
                    <div className={'h-full ' + barClass} style={{ width: pct + '%' }} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={b.state === 'over' ? 'font-medium text-destructive' : b.state === 'warning' ? 'font-medium text-warning' : 'text-muted-foreground'}>
                      {b.state === 'over'
                        ? money(Math.abs(b.remaining_minor), currency) + ' over budget'
                        : money(b.remaining_minor, currency) + ' remaining'}
                    </span>
                    <span className="text-muted-foreground tnum">{b.pct_used}%</span>
                  </div>
                  <p className="border-t pt-2 text-[11px] text-muted-foreground">
                    {fmtDate(b.period_window.from, { year: false })} &ndash; {fmtDate(b.period_window.to, { year: false })} &middot; {b.txn_count} transactions
                    {b.rollover ? ' \u00b7 rollover on' : ''}
                  </p>
                </CardContent>
              </Card>
            );
          })}

          {canWrite ? (
            <button type="button" onClick={openNew}
              className="flex min-h-[176px] flex-col items-center justify-center gap-2 border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
              <Plus className="h-5 w-5" />
              New budget
            </button>
          ) : null}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit budget' : 'New budget'}</DialogTitle>
            <DialogDescription>Spend is measured against the current {form.period === 'weekly' ? 'week' : 'month'}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editing ? (
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm((f) => ({ ...f, category_id: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="overall" disabled={hasOverall}>Overall (all categories)</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={usedCategoryIds.has(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="limit">Limit</Label>
              <div className="flex items-center border focus-within:ring-1 focus-within:ring-ring">
                <span className="px-3 text-sm text-muted-foreground">{currencySymbol(currency)}</span>
                <Input id="limit" inputMode="decimal" className="border-0 tnum focus-visible:ring-0" value={form.limit}
                  onChange={(e) => setForm((f) => ({ ...f, limit: e.target.value.replace(/[^\d.]/g, '') }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Period</Label>
              <Select value={form.period} onValueChange={(v) => setForm((f) => ({ ...f, period: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between border p-3">
              <div>
                <p className="text-sm font-medium">Rollover unused amount</p>
                <p className="text-xs text-muted-foreground">Carry leftover budget into the next period.</p>
              </div>
              <Switch checked={form.rollover} onCheckedChange={(v) => setForm((f) => ({ ...f, rollover: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this budget?</AlertDialogTitle>
            <AlertDialogDescription>
              The {confirmDelete?.period} budget for {confirmDelete?.category_name} will be removed. Transactions are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); remove(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
