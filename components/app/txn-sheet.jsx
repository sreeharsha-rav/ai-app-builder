'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { CalendarIcon, Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { catVar, currencySymbol, fmtDate, todayIso } from '@/lib/format';
import { CatDot } from './bits';
import { post, put } from './api-client';

const blank = (currency) => ({
  type: 'expense', amount: '', category_id: null, merchant: '', notes: '', tags: [],
  transaction_date: todayIso(), currency_code: currency,
});

export default function TxnSheet({ open, onOpenChange, workspaceId, currency, categories = [], merchants = [], editing, onOptimistic, onSettled }) {
  const [form, setForm] = useState(blank(currency));
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTagInput('');
    if (editing) {
      setForm({
        type: editing.type,
        amount: String((editing.amount_minor || 0) / 100),
        category_id: editing.category_id || null,
        merchant: editing.merchant || '',
        notes: editing.notes || '',
        tags: editing.tags || [],
        transaction_date: editing.transaction_date,
        currency_code: editing.currency_code || currency,
      });
    } else {
      setForm(blank(currency));
    }
  }, [open, editing, currency]);

  const selectedCat = useMemo(() => categories.find((c) => c.id === form.category_id), [categories, form.category_id]);
  const amountMinor = Math.round(Number(String(form.amount).replace(/,/g, '')) * 100);
  const valid = Number.isFinite(amountMinor) && amountMinor > 0 && !!form.transaction_date;

  const addTag = () => {
    const v = tagInput.trim().replace(/^#/, '');
    if (v && !form.tags.includes(v)) setForm((f) => ({ ...f, tags: [...f.tags, v] }));
    setTagInput('');
  };

  async function save() {
    if (!valid) return;
    const body = {
      type: form.type,
      amount_minor: amountMinor,
      category_id: form.category_id,
      merchant: form.merchant || null,
      notes: form.notes || null,
      tags: form.tags,
      transaction_date: form.transaction_date,
    };
    const tempId = editing?.id || 'temp-' + Math.random().toString(36).slice(2);
    const cat = categories.find((c) => c.id === form.category_id);

    // Optimistic: the row appears immediately with a saving indicator.
    onOptimistic?.({
      ...body, id: tempId, _pending: true, currency_code: currency,
      category_name: cat?.name || null, category_color: cat?.color || null,
    }, !!editing);
    onOpenChange(false);
    setBusy(true);
    try {
      const saved = editing
        ? await put('/workspaces/' + workspaceId + '/transactions/' + editing.id, body)
        : await post('/workspaces/' + workspaceId + '/transactions', body);
      onSettled?.(tempId, saved, null);
      toast.success(editing ? 'Transaction updated' : 'Transaction saved');
    } catch (e) {
      onSettled?.(tempId, null, e);
      toast.error(e.message || 'Could not save transaction');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="space-y-1 border-b pb-4">
          <SheetTitle>{editing ? 'Edit transaction' : 'Add transaction'}</SheetTitle>
          <SheetDescription>Amounts are recorded in {currency}.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 py-5">
          <Tabs value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="expense">Expense</TabsTrigger>
              <TabsTrigger value="income">Income</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <div className="flex items-center border focus-within:ring-1 focus-within:ring-ring">
              <span className="px-3 text-sm text-muted-foreground">{currencySymbol(currency)}</span>
              <Input id="amount" inputMode="decimal" placeholder="0" value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') }))}
                className="border-0 text-lg tnum focus-visible:ring-0" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Popover open={catOpen} onOpenChange={setCatOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  <span className="flex items-center gap-2">
                    {selectedCat ? <><CatDot color={selectedCat.color} />{selectedCat.name}</> : <span className="text-muted-foreground">Select category</span>}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search categories..." />
                  <CommandList>
                    <CommandEmpty>No category found.</CommandEmpty>
                    <CommandGroup>
                      {categories.map((c) => (
                        <CommandItem key={c.id} value={c.name} onSelect={() => { setForm((f) => ({ ...f, category_id: c.id })); setCatOpen(false); }}>
                          <CatDot color={c.color} className="mr-2" />
                          {c.name}
                          {form.category_id === c.id ? <Check className="ml-auto h-4 w-4" /> : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start gap-2 font-normal">
                  <CalendarIcon className="h-4 w-4 opacity-70" />
                  {form.transaction_date ? fmtDate(form.transaction_date) : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={form.transaction_date ? new Date(form.transaction_date + 'T00:00:00Z') : undefined}
                  onSelect={(d) => {
                    if (d) setForm((f) => ({ ...f, transaction_date: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10) }));
                    setDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="merchant">Merchant <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="merchant" value={form.merchant} list="merchant-options" placeholder="Where did you spend?"
              onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))} />
            <datalist id="merchant-options">{merchants.map((m) => <option key={m} value={m} />)}</datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="tags" value={tagInput} placeholder="Type and press Enter"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }} />
            {form.tags.length ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {form.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1 border">
                    {t}
                    <button type="button" onClick={() => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }))}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <SheetFooter className="flex-row gap-2 border-t pt-4">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={save} disabled={!valid || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
