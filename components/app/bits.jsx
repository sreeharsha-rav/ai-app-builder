'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { catVar } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CatDot({ color, className }) {
  return <span className={cn('inline-block h-2.5 w-2.5 shrink-0', className)} style={{ background: catVar(color) }} />;
}

export function CategoryBadge({ name, color }) {
  if (!name) return <span className="text-muted-foreground text-xs">Uncategorized</span>;
  return (
    <span className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: catVar(color), color: catVar(color) }}>
      <CatDot color={color} />
      {name}
    </span>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 border border-dashed px-6 py-14 text-center">
      {Icon ? (
        <div className="flex h-12 w-12 items-center justify-center border bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      ) : null}
      <div>
        <p className="font-medium">{title}</p>
        {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = 'default', progress }) {
  const toneClass = tone === 'destructive' ? 'text-destructive' : tone === 'success' ? 'text-success' : 'text-foreground';
  return (
    <Card className="border">
      <CardHeader className="space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className={cn('text-2xl font-semibold tnum', toneClass)}>{value}</div>
        {progress != null ? (
          <div className="h-1.5 w-full bg-muted">
            <div className={cn('h-full', progress > 100 ? 'bg-destructive' : progress >= 80 ? 'bg-warning' : 'bg-primary')}
              style={{ width: Math.min(Math.max(progress, 0), 100) + '%' }} />
          </div>
        ) : null}
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export function SkeletonGrid({ cards = 4 }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <Card key={i}><CardContent className="space-y-3 p-5">
            <Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-32" /><Skeleton className="h-1.5 w-full" />
          </CardContent></Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3"><CardContent className="p-5"><Skeleton className="h-[240px] w-full" /></CardContent></Card>
        <Card className="lg:col-span-2"><CardContent className="p-5"><Skeleton className="h-[240px] w-full" /></CardContent></Card>
      </div>
      <Card><CardContent className="space-y-3 p-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </CardContent></Card>
    </div>
  );
}

export function TypeBadge({ type }) {
  return (
    <Badge variant="secondary" className={cn('border text-[11px] font-medium uppercase',
      type === 'income' ? 'border-success/40 text-success' : 'border-border text-muted-foreground')}>
      {type}
    </Badge>
  );
}

export function InlineError({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="flex items-center justify-between gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <span>{message}</span>
      {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}
