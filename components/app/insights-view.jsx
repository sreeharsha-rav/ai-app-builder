'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldAlert, Send, Sparkles, Trash2, Database } from 'lucide-react';
import { del, get, post } from './api-client';
import { PageHeader } from './bits';
import { catVar, fmtDate, money } from '@/lib/format';

const SUGGESTIONS = [
  'How am I doing on budget?',
  'Spending trend this month',
  'Compare this month to last month',
  'Which category grew the most in the last 3 months?',
];

function MiniChart({ chart, currency }) {
  if (!chart?.data?.length) return null;
  const sequential = chart.kind === 'sequential';
  return (
    <div className="mt-3 border p-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {sequential ? 'Trend' : 'By ' + chart.group_by}
      </p>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart.data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} interval={0} height={28} />
            <Tooltip
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', fontSize: 12 }}
              formatter={(v) => money(Math.round(v * 100), currency)} />
            <Bar dataKey="value" maxBarSize={40}>
              {chart.data.map((d, i) => (
                <Cell key={d.label}
                  fill={sequential ? 'var(--chart-' + ((i % 5) + 1) + ')' : (d.color ? catVar(d.color) : 'var(--cat-' + ((i % 8) + 1) + ')')} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AgentMessage({ m, currency }) {
  if (m.kind === 'refusal') {
    return (
      <Alert className="max-w-[92%] border-warning/50 bg-muted">
        <ShieldAlert className="h-4 w-4 text-warning" />
        <AlertTitle className="text-sm">Outside what this agent can do</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">{m.text}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Card className="max-w-[92%]">
      <CardContent className="p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>

        {m.stats?.length ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {m.stats.map((s, i) => (
              <div key={i} className="border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className={'text-sm font-semibold tnum ' + (s.tone === 'destructive' ? 'text-destructive' : '')}>
                  {s.plain ? s.value : money(Math.round((s.value || 0) * 100), s.currency || currency)}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <MiniChart chart={m.chart} currency={currency} />

        {m.citation ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5 text-[11px] text-muted-foreground">
            <Database className="h-3 w-3" />
            Based on {m.citation.count} transaction{m.citation.count === 1 ? '' : 's'}, {fmtDate(m.citation.from)} &ndash; {fmtDate(m.citation.to)}
            {m.scope ? <Badge variant="secondary" className="ml-1 border text-[10px] capitalize">{m.scope.role}{m.scope.member_scope === 'own_only' ? ' \u00b7 own only' : ''}</Badge> : null}
            {m.tools_used?.length ? <span className="ml-auto font-mono text-[10px]">{m.tools_used.join(', ')}</span> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function InsightsView({ ctx, workspaceId, refreshKey }) {
  const currency = ctx.workspace.currency_code;
  const [messages, setMessages] = useState(null);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setMessages(null);
    (async () => {
      try {
        const d = await get('/workspaces/' + workspaceId + '/insights');
        if (alive) setMessages(d.messages || []);
      } catch {
        if (alive) setMessages([]);
      }
    })();
    return () => { alive = false; };
  }, [workspaceId, refreshKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking]);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || thinking) return;
    setInput('');
    setMessages((m) => [...(m || []), { id: 'u-' + Date.now(), role: 'user', text: q }]);
    setThinking(true);
    try {
      const res = await post('/workspaces/' + workspaceId + '/insights', { query: q });
      setMessages((m) => [...m, res.message]);
    } catch (e) {
      toast.error(e.message || 'The agent could not answer that');
    } finally {
      setThinking(false);
    }
  }

  async function clear() {
    try {
      await del('/workspaces/' + workspaceId + '/insights');
      setMessages([]);
    } catch (e) {
      toast.error(e.message);
    }
  }

  const empty = messages && messages.length === 0;

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[460px] flex-col gap-4 md:h-[calc(100dvh-8.5rem)]">
      <PageHeader
        title="Insights"
        description={'Read-only analysis of ' + ctx.workspace.name + '. ' + (ctx.scope === 'own_only' ? 'Scoped to your own transactions.' : 'Scoped to what your role can see.')}
        actions={messages?.length ? <Button variant="outline" size="sm" className="gap-1.5" onClick={clear}><Trash2 className="h-3.5 w-3.5" /> Clear thread</Button> : null}
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {messages === null ? (
          <div className="space-y-3">
            <Skeleton className="ml-auto h-12 w-2/3" />
            <Skeleton className="h-24 w-4/5" />
          </div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 border border-dashed p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center border bg-muted">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Ask about your spending</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                The agent reads only the data your role permits and cites the transactions behind every answer. It cannot change anything.
              </p>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={'flex animate-fade-in ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'user' ? (
                <Card className="max-w-[88%] border-primary/40 bg-accent">
                  <CardContent className="p-3"><p className="whitespace-pre-wrap text-sm">{m.text}</p></CardContent>
                </Card>
              ) : (
                <AgentMessage m={m} currency={currency} />
              )}
            </div>
          ))
        )}

        {thinking ? (
          <div className="flex justify-start">
            <Card className="w-[70%] max-w-sm">
              <CardContent className="space-y-2 p-4">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-2/3" />
                <p className="pt-1 text-[11px] text-muted-foreground">Querying your workspace&hellip;</p>
              </CardContent>
            </Card>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="space-y-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={thinking} onClick={() => send(s)}
              className="shrink-0 border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 border bg-card p-2">
          <Textarea
            rows={1}
            value={input}
            disabled={thinking}
            placeholder="Ask about spending, budgets or trends..."
            className="min-h-[40px] resize-none border-0 focus-visible:ring-0"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <Button size="icon" disabled={thinking || !input.trim()} onClick={() => send()} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
