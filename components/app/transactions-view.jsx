'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  flexRender, getCoreRowModel, useReactTable,
} from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Filter, Loader2, Pencil, Plus, Receipt, Search, Trash2 } from 'lucide-react';
import { del, get } from './api-client';
import { CategoryBadge, EmptyState, PageHeader, InlineError } from './bits';
import { fmtDate, money, monthStartIso, todayIso } from '@/lib/format';
import TxnSheet from './txn-sheet';

export default function TransactionsView({ ctx, workspaceId, refreshKey, categories, merchants }) {
  const currency = ctx.workspace.currency_code;
  const isOrg = ctx.workspace.type === 'organization';
  const canWrite = !!ctx.caps.txn_write;

  const [filters, setFilters] = useState({ from: new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10), to: todayIso(), type: 'all', q: '', categories: [] });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState({ by: 'transaction_date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 350);
    return () => clearTimeout(t);
  }, [filters.q]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({
      from: filters.from, to: filters.to, type: filters.type, q: debouncedQ,
      page: String(page), pageSize: '25', sortBy: sort.by, sortDir: sort.dir,
    });
    if (filters.categories.length) qs.set('categories', filters.categories.join(','));
    (async () => {
      try {
        const d = await get('/workspaces/' + workspaceId + '/transactions?' + qs.toString());
        if (!alive) return;
        setData(d);
        setRows(d.rows);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [workspaceId, refreshKey, tick, filters.from, filters.to, filters.type, filters.categories, debouncedQ, page, sort.by, sort.dir]);

  const toggleSort = (by) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'desc' ? 'asc' : 'desc' }));

  const columns = useMemo(() => {
    const cols = [
      {
        id: 'transaction_date', header: 'Date', sortable: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(row.original.transaction_date)}</span>
        ),
      },
      {
        id: 'merchant', header: 'Merchant', sortable: true,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {row.original.merchant || <span className="font-normal text-muted-foreground">&mdash;</span>}
              {row.original._pending ? <span className="ml-2 text-xs text-muted-foreground">saving&hellip;</span> : null}
            </p>
            {row.original.notes ? <p className="truncate text-xs text-muted-foreground">{row.original.notes}</p> : null}
          </div>
        ),
      },
      {
        id: 'category', header: 'Category',
        cell: ({ row }) => <CategoryBadge name={row.original.category_name} color={row.original.category_color} />,
      },
    ];
    if (isOrg) {
      cols.push({
        id: 'created_by_name', header: 'Added by',
        cell: ({ row }) => <span className="whitespace-nowrap text-sm text-muted-foreground">{row.original.created_by_name || '\u2014'}</span>,
      });
    }
    cols.push({
      id: 'amount_minor', header: 'Amount', sortable: true, align: 'right',
      cell: ({ row }) => (
        <span className={'tnum whitespace-nowrap font-medium ' + (row.original.type === 'income' ? 'text-success' : 'text-foreground')}>
          {row.original.type === 'income' ? '+' : '\u2212'}{money(row.original.amount_minor, currency)}
        </span>
      ),
    });
    if (canWrite) {
      cols.push({
        id: 'actions', header: '', align: 'right',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit"
              onClick={() => { setEditing(row.original); setSheetOpen(true); }}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Delete"
              onClick={() => setConfirmDelete(row.original)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      });
    }
    return cols;
  }, [isOrg, canWrite, currency]);

  const table = useReactTable({
    data: rows,
    columns: columns.map((c) => ({ ...c, accessorKey: c.id })),
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
  });

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    const id = confirmDelete.id;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      await del('/workspaces/' + workspaceId + '/transactions/' + id);
      toast.success('Transaction deleted');
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e.message);
      setTick((t) => t + 1);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;
  const selectedCatNames = categories.filter((c) => filters.categories.includes(c.id)).map((c) => c.name);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transactions"
        description={ctx.scope === 'own_only' ? 'You can see only the transactions you created.' : 'All transactions in this workspace.'}
        actions={canWrite ? (
          <Button className="gap-1.5" onClick={() => { setEditing(null); setSheetOpen(true); }}>
            <Plus className="h-4 w-4" /> Add transaction
          </Button>
        ) : null}
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search merchant, notes or tags" value={filters.q}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, q: e.target.value })); }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="w-[150px]" value={filters.from}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, from: e.target.value })); }} />
            <span className="text-muted-foreground">&ndash;</span>
            <Input type="date" className="w-[150px]" value={filters.to}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, to: e.target.value })); }} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-1.5">
                  <Filter className="h-4 w-4" />
                  {selectedCatNames.length ? selectedCatNames.length + ' categories' : 'Category'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Filter by category</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {categories.map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={filters.categories.includes(c.id)}
                    onCheckedChange={(v) => {
                      setPage(1);
                      setFilters((f) => ({ ...f, categories: v ? [...f.categories, c.id] : f.categories.filter((x) => x !== c.id) }));
                    }}>
                    {c.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tabs value={filters.type} onValueChange={(v) => { setPage(1); setFilters((f) => ({ ...f, type: v })); }}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="income">Income</TabsTrigger>
                <TabsTrigger value="expense">Expense</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {err ? <InlineError message={err} onRetry={() => setTick((t) => t + 1)} /> : null}

      <Card>
        <CardContent className="px-0 py-0">
          {loading && !rows.length ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={Receipt} title="No transactions match these filters"
                description="Try widening the date range or clearing the category filter."
                action={<Button variant="outline" onClick={() => { setPage(1); setFilters({ from: new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10), to: todayIso(), type: 'all', q: '', categories: [] }); }}>Reset filters</Button>} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col.id} className={(col.align === 'right' ? 'text-right ' : '') + 'whitespace-nowrap'}>
                      {col.sortable ? (
                        <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(col.id)}>
                          {col.header}
                          {sort.by === col.id ? (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : null}
                        </button>
                      ) : col.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className={row.original._pending ? 'opacity-60' : ''}>
                    {row.getVisibleCells().map((cell) => {
                      const col = columns.find((c) => c.id === cell.column.id);
                      return (
                        <TableCell key={cell.id} className={col?.align === 'right' ? 'text-right' : ''}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && data.total > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {data.total} transactions &middot; spend {money(data.totals.expense, currency)} &middot; income {money(data.totals.income, currency)}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : null}

      <TxnSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        workspaceId={workspaceId}
        currency={currency}
        categories={categories}
        merchants={merchants}
        editing={editing}
        onOptimistic={(draft, isEdit) => {
          setRows((r) => (isEdit
            ? r.map((x) => (x.id === draft.id ? { ...x, ...draft } : x))
            : [{ ...draft, created_by_name: 'You' }, ...r]));
        }}
        onSettled={() => setTick((t) => t + 1)}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? money(confirmDelete.amount_minor, currency) + (confirmDelete.merchant ? ' at ' + confirmDelete.merchant : '') + ' on ' + fmtDate(confirmDelete.transaction_date) + '. ' : ''}
              It will be removed from all reports and agent answers, but stays in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); doDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
