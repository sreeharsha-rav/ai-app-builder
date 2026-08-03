'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { del, get, post, put } from './api-client';
import { EmptyState, PageHeader, InlineError } from './bits';
import { CAT_TOKENS, catVar } from '@/lib/format';

export default function CategoriesView({ ctx, workspaceId, refreshKey, setCategories }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', color: 'cat-1', parent_id: 'none' });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    try {
      const d = await get('/workspaces/' + workspaceId + '/categories');
      setItems(d);
      setCategories?.(d);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => { setItems(null); load(); /* eslint-disable-next-line */ }, [workspaceId, refreshKey, tick]);

  const parents = (items || []).filter((c) => !c.parent_id);
  const childrenOf = (id) => (items || []).filter((c) => c.parent_id === id);

  function openNew() {
    setEditing(null);
    setForm({ name: '', color: CAT_TOKENS[(items?.length || 0) % 8], parent_id: 'none' });
    setOpen(true);
  }

  function openEdit(c) {
    setEditing(c);
    setForm({ name: c.name, color: c.color, parent_id: c.parent_id || 'none' });
    setOpen(true);
  }

  async function save() {
    if (form.name.trim().length < 1) return toast.error('Enter a category name');
    setBusy(true);
    try {
      if (editing) {
        await put('/workspaces/' + workspaceId + '/categories/' + editing.id, { name: form.name.trim(), color: form.color });
        toast.success('Category updated');
      } else {
        await post('/workspaces/' + workspaceId + '/categories', {
          name: form.name.trim(), color: form.color,
          parent_id: form.parent_id === 'none' ? null : form.parent_id,
        });
        toast.success('Category created');
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
      const r = await del('/workspaces/' + workspaceId + '/categories/' + confirmDelete.id);
      toast.success(r.reassigned ? r.reassigned + ' transactions moved to Uncategorized' : 'Category deleted');
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setConfirmDelete(null);
    }
  }

  const Row = ({ c, child }) => (
    <div className={'flex items-center gap-3 border-b px-4 py-3 last:border-b-0 ' + (child ? 'pl-10' : '')}>
      <span className="h-4 w-4 shrink-0 border" style={{ background: catVar(c.color) }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{c.name}</p>
        <p className="text-xs text-muted-foreground">{c.txn_count} transactions{c.is_default ? ' \u00b7 default' : ''}</p>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)} aria-label="Edit category"><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmDelete(c)} aria-label="Delete category"><Trash2 className="h-4 w-4" /></Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Categories" description="Organise spending. Colors come from the categorical chart palette."
        actions={<Button className="gap-1.5" onClick={openNew}><Plus className="h-4 w-4" /> New category</Button>} />

      {err ? <InlineError message={err} onRetry={() => setTick((t) => t + 1)} /> : null}

      {!items ? (
        <Card><CardContent className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      ) : items.length === 0 ? (
        <EmptyState icon={Tags} title="No categories" description="Create categories so spend can be grouped and budgeted."
          action={<Button onClick={openNew}>New category</Button>} />
      ) : (
        <Card>
          <CardContent className="p-0">
            {parents.map((p) => (
              <div key={p.id}>
                <Row c={p} />
                {childrenOf(p.id).map((ch) => <Row key={ch.id} c={ch} child />)}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit category' : 'New category'}</DialogTitle>
            <DialogDescription>Pick a swatch from the fixed categorical palette.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input id="cat-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Groceries" />
            </div>
            {!editing ? (
              <div className="space-y-2">
                <Label>Parent category</Label>
                <Select value={form.parent_id} onValueChange={(v) => setForm((f) => ({ ...f, parent_id: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (top level)</SelectItem>
                    {parents.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="grid grid-cols-8 gap-2">
                {CAT_TOKENS.map((t) => (
                  <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, color: t }))}
                    className={'h-9 w-full border-2 ' + (form.color === t ? 'border-foreground' : 'border-transparent')}
                    style={{ background: catVar(t) }} aria-label={t} />
                ))}
              </div>
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
            <AlertDialogTitle>Delete &ldquo;{confirmDelete?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.txn_count
                ? confirmDelete.txn_count + " transactions use this category \u2014 they'll be moved to 'Uncategorized'."
                : 'No transactions use this category.'}
              {' '}Budgets tied to it become overall budgets. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); remove(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete category</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
