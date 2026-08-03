'use client';

import { useEffect, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Receipt, X, Users2, TrendingDown, TrendingUp } from 'lucide-react';
import { get, post } from './api-client';
import { CategoryBadge, EmptyState, InlineError, SkeletonGrid, StatCard } from './bits';
import { catVar, fmtDate, money } from '@/lib/format';

const SEQ = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

function ChartTip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border bg-popover px-3 py-2 text-xs shadow-none">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="tnum text-muted-foreground">
          <span className="mr-1.5 inline-block h-2 w-2" style={{ background: p.color || p.fill }} />
          {p.name}: <span className="font-medium text-foreground">{money(p.value, currency)}</span>
        </p>
      ))}
    </div>
  );
}

export default function DashboardView({ ctx, workspaceId, refreshKey, openAdd, setView }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [days, setDays] = useState('30');
  const [prefs, setPrefs] = useState({});
  const currency = ctx.workspace.currency_code;

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    (async () => {
      try {
        const [d, p] = await Promise.all([
          get('/workspaces/' + workspaceId + '/dashboard?days=' + days),
          get('/workspaces/' + workspaceId + '/prefs').catch(() => ({})),
        ]);
        if (!alive) return;
        setData(d);
        setPrefs(p || {});
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [workspaceId, refreshKey, days]);

  if (err) return <InlineError message={err} onRetry={() => setDays(days)} />;
  if (!data) return <SkeletonGrid />;

  const k = data.kpis;
  const budgetPct = k.budget_limit_minor ? (k.budget_spent_minor / k.budget_limit_minor) * 100 : null;
  const trendData = data.trend.map((t) => ({ ...t, label: fmtDate(t.day, { year: false }) }));
  const donut = data.byCategory.filter((c) => c.expense_minor > 0);
  const isEmpty = k.txn_count === 0 && donut.length === 0;
  const deltaPct = k.prev_expense_minor ? Math.round(((k.expense_minor - k.prev_expense_minor) / k.prev_expense_minor) * 100) : null;

  const showInvitePrompt = ctx.workspace.type === 'organization' && ctx.caps.member_write && prefs.invite_prompt_dismissed !== '1';

  const dismiss = async () => {
    setPrefs((p) => ({ ...p, invite_prompt_dismissed: '1' }));
    try { await post('/workspaces/' + workspaceId + '/prefs', { key: 'invite_prompt_dismissed', value: '1' }); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.period.label} &middot; {ctx.scope === 'own_only' ? 'your transactions only' : 'all workspace transactions'}
          </p>
        </div>
        <Tabs value={days} onValueChange={setDays}>
          <TabsList>
            <TabsTrigger value="30">30 days</TabsTrigger>
            <TabsTrigger value="90">90 days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {showInvitePrompt ? (
        <Card className="border-primary/40 bg-accent/40">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Users2 className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Invite your teammates</p>
                <p className="text-xs text-muted-foreground">Shared budgets work better with the whole team. You can always do this later from Members.</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => setView('members')}>Invite</Button>
              <Button size="sm" variant="ghost" onClick={dismiss}><X className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isEmpty ? (
        <EmptyState
          icon={Receipt}
          title="No transactions yet"
          description="Log your first expense to start seeing spend trends, category breakdowns and budget progress."
          action={ctx.caps.txn_write ? <Button className="gap-1.5" onClick={() => openAdd(null)}><Plus className="h-4 w-4" /> Add your first expense</Button> : null}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total spend" value={money(k.expense_minor, currency)}
              sub={deltaPct == null ? data.period.label : (deltaPct >= 0 ? '+' : '') + deltaPct + '% vs last month'} />
            <StatCard label="Total income" value={money(k.income_minor, currency)} sub={k.txn_count + ' transactions this period'} />
            <StatCard label="Budget remaining" value={money(k.budget_remaining_minor, currency)}
              progress={budgetPct == null ? undefined : budgetPct}
              tone={k.budget_remaining_minor < 0 ? 'destructive' : 'default'}
              sub={k.budget_limit_minor ? money(k.budget_spent_minor, currency) + ' of ' + money(k.budget_limit_minor, currency) + ' used' : 'No budgets set'} />
            <StatCard label="Net" value={money(k.net_minor, currency)}
              tone={k.net_minor < 0 ? 'destructive' : 'success'}
              sub={k.net_minor < 0 ? 'Spending exceeds income' : 'Income exceeds spending'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Spend trend</CardTitle>
                <CardDescription>Daily expense over the last {days} days</CardDescription>
              </CardHeader>
              <CardContent className="pl-0">
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={54}
                        tickFormatter={(v) => money(v, currency, { compact: true })} />
                      <Tooltip content={<ChartTip currency={currency} />} />
                      <Area type="monotone" dataKey="expense_minor" name="Expense" stroke="var(--chart-4)" strokeWidth={2} fill="url(#spendFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">By category</CardTitle>
                <CardDescription>{data.period.label}</CardDescription>
              </CardHeader>
              <CardContent>
                {donut.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">No categorised spend this month.</p>
                ) : (
                  <>
                    <div className="h-[180px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donut} dataKey="expense_minor" nameKey="key" innerRadius={48} outerRadius={72} paddingAngle={1} stroke="var(--card)">
                            {donut.map((d) => <Cell key={d.key} fill={catVar(d.color)} />)}
                          </Pie>
                          <Tooltip content={<ChartTip currency={currency} />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1.5">
                      {donut.slice(0, 6).map((d) => (
                        <div key={d.key} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 truncate">
                            <span className="h-2.5 w-2.5 shrink-0" style={{ background: catVar(d.color) }} />
                            <span className="truncate">{d.key}</span>
                          </span>
                          <span className="tnum text-muted-foreground">{money(d.expense_minor, currency)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">Recent transactions</CardTitle>
                <CardDescription>Latest entries you can see</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setView('transactions')}>View all</Button>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Category</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead className="pr-6 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-6"><CategoryBadge name={r.category_name} color={r.category_color} /></TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm">{r.merchant || <span className="text-muted-foreground">&mdash;</span>}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(r.transaction_date)}</TableCell>
                      <TableCell className={'pr-6 text-right tnum font-medium ' + (r.type === 'income' ? 'text-success' : 'text-foreground')}>
                        {r.type === 'income' ? '+' : '\u2212'}{money(r.amount_minor, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Team spend exists only for org workspaces where scope = all. */}
          {data.teamSpend ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Team spend</CardTitle>
                <CardDescription>Per-member expense for {data.period.label}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.teamSpend} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="key" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={54}
                        tickFormatter={(v) => money(v, currency, { compact: true })} />
                      <Tooltip content={<ChartTip currency={currency} />} />
                      <Bar dataKey="expense_minor" name="Expense" maxBarSize={54}>
                        {data.teamSpend.map((m, i) => <Cell key={m.key} fill={'var(--cat-' + ((i % 8) + 1) + ')'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
