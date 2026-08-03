import { all, one, run } from './db';
import { uid, nowIso } from './auth';
import { require_, notFound } from './rbac';

/**
 * THE ONLY data path for transactions / budgets / categories / audit.
 * Every query here interpolates ctx.workspaceId. The AI agent tools call these
 * same functions, so the agent structurally cannot bypass RBAC.
 */

/* ---------- helpers ---------- */
export const toDate = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

export function monthWindow(offset = 0) {
  const n = new Date();
  const start = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset + 1, 0));
  return { from: toDate(start), to: toDate(end), label: start.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) };
}

export function weekWindow() {
  const n = new Date();
  const day = (n.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - day));
  const end = new Date(start.getTime() + 6 * 864e5);
  return { from: toDate(start), to: toDate(end) };
}

export function daysWindow(days) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 864e5);
  return { from: toDate(from), to: toDate(to) };
}

/** Mandatory scope predicate. NEVER build a transactions query without it. */
function scoped(ctx, alias = 't') {
  const sql = [`${alias}.workspace_id = ?`, `${alias}.is_deleted = 0`];
  const params = [ctx.workspaceId];
  if (ctx.scope === 'own_only') {
    sql.push(`${alias}.created_by = ?`);
    params.push(ctx.userId);
  }
  return { sql: sql.join(' AND '), params };
}

export function writeAudit(ctx, action, entityType, entityId, diff, summary) {
  run(
    'INSERT INTO audit_log (id, workspace_id, actor_id, action, entity_type, entity_id, diff, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [uid(), ctx.workspaceId, ctx.userId, action, entityType, entityId || null, JSON.stringify(diff || {}), summary || '', nowIso()]
  );
}

const parseTags = (r) => ({ ...r, tags: r.tags ? JSON.parse(r.tags) : [], is_deleted: !!r.is_deleted });

/* ---------- categories ---------- */
export function listCategories(ctx) {
  return all(
    `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.workspace_id = c.workspace_id AND t.is_deleted = 0) AS txn_count
       FROM categories c WHERE c.workspace_id = ? ORDER BY c.name`,
    [ctx.workspaceId]
  ).map((c) => ({ ...c, is_default: !!c.is_default }));
}

export function createCategory(ctx, { name, color, parent_id }) {
  require_(ctx, 'category_write');
  if (parent_id) {
    const p = one('SELECT id FROM categories WHERE id = ? AND workspace_id = ?', [parent_id, ctx.workspaceId]);
    if (!p) throw notFound();
  }
  const id = uid();
  run('INSERT INTO categories (id, workspace_id, name, parent_id, color, is_default) VALUES (?,?,?,?,?,0)', [
    id, ctx.workspaceId, name, parent_id || null, color || 'cat-1',
  ]);
  writeAudit(ctx, 'create', 'category', id, { after: { name, color } }, `Created category "${name}"`);
  return one('SELECT * FROM categories WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
}

export function updateCategory(ctx, id, patch) {
  require_(ctx, 'category_write');
  const before = one('SELECT * FROM categories WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
  if (!before) throw notFound();
  const name = patch.name ?? before.name;
  const color = patch.color ?? before.color;
  run('UPDATE categories SET name = ?, color = ? WHERE id = ? AND workspace_id = ?', [name, color, id, ctx.workspaceId]);
  writeAudit(ctx, 'update', 'category', id, { before: { name: before.name, color: before.color }, after: { name, color } }, `Renamed category "${before.name}" to "${name}"`);
  return one('SELECT * FROM categories WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
}

export function deleteCategory(ctx, id) {
  require_(ctx, 'category_write');
  const before = one('SELECT * FROM categories WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
  if (!before) throw notFound();
  const moved = one('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ? AND workspace_id = ? AND is_deleted = 0', [id, ctx.workspaceId]).c;
  run('UPDATE transactions SET category_id = NULL, updated_at = ? WHERE category_id = ? AND workspace_id = ?', [nowIso(), id, ctx.workspaceId]);
  run('UPDATE budgets SET category_id = NULL WHERE category_id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
  run('UPDATE categories SET parent_id = NULL WHERE parent_id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
  run('DELETE FROM categories WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
  writeAudit(ctx, 'delete', 'category', id, { before }, `Deleted category "${before.name}" (${moved} transactions moved to Uncategorized)`);
  return { reassigned: moved };
}

/* ---------- transactions ---------- */
export function listTransactions(ctx, f = {}) {
  const s = scoped(ctx);
  const where = [s.sql];
  const params = [...s.params];

  if (f.from) { where.push('t.transaction_date >= ?'); params.push(f.from); }
  if (f.to) { where.push('t.transaction_date <= ?'); params.push(f.to); }
  if (f.type && f.type !== 'all') { where.push('t.type = ?'); params.push(f.type); }
  if (f.categoryIds?.length) {
    where.push(`t.category_id IN (${f.categoryIds.map(() => '?').join(',')})`);
    params.push(...f.categoryIds);
  }
  if (f.createdBy) { where.push('t.created_by = ?'); params.push(f.createdBy); }
  if (f.q) {
    where.push('(lower(coalesce(t.merchant,\'\')) LIKE ? OR lower(coalesce(t.notes,\'\')) LIKE ? OR lower(coalesce(t.tags,\'\')) LIKE ?)');
    const like = `%${String(f.q).toLowerCase()}%`;
    params.push(like, like, like);
  }
  const W = where.join(' AND ');
  const total = one(`SELECT COUNT(*) AS c FROM transactions t WHERE ${W}`, params).c;
  const sums = one(
    `SELECT COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_minor ELSE 0 END),0) AS expense,
            COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_minor ELSE 0 END),0) AS income
       FROM transactions t WHERE ${W}`, params);

  const sortable = { transaction_date: 't.transaction_date', amount_minor: 't.amount_minor', merchant: 't.merchant', created_at: 't.created_at' };
  const sortCol = sortable[f.sortBy] || 't.transaction_date';
  const dir = f.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(f.pageSize) || 25, 200);
  const offset = ((Math.max(Number(f.page) || 1, 1)) - 1) * limit;

  const rows = all(
    `SELECT t.*, c.name AS category_name, c.color AS category_color, u.display_name AS created_by_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.workspace_id = t.workspace_id
       LEFT JOIN users u ON u.id = t.created_by
      WHERE ${W} ORDER BY ${sortCol} ${dir}, t.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map(parseTags);

  return { rows, total, page: Math.max(Number(f.page) || 1, 1), pageSize: limit, totals: sums };
}

export function getTransaction(ctx, id) {
  const s = scoped(ctx);
  const row = one(`SELECT t.* FROM transactions t WHERE t.id = ? AND ${s.sql}`, [id, ...s.params]);
  if (!row) throw notFound();
  return parseTags(row);
}

export function createTransaction(ctx, b) {
  require_(ctx, 'txn_write');
  if (b.category_id) {
    const c = one('SELECT id FROM categories WHERE id = ? AND workspace_id = ?', [b.category_id, ctx.workspaceId]);
    if (!c) throw notFound();
  }
  const id = uid();
  const ts = nowIso();
  const amount = Math.round(Number(b.amount_minor));
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('amount_minor must be a positive integer'), { status: 400 });
  run(
    `INSERT INTO transactions (id, workspace_id, created_by, type, amount_minor, currency_code, category_id, merchant, notes, tags, transaction_date, created_at, updated_at, is_deleted)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    [id, ctx.workspaceId, ctx.userId, b.type === 'income' ? 'income' : 'expense', amount,
      b.currency_code || ctx.workspace.currency_code, b.category_id || null, b.merchant || null,
      b.notes || null, JSON.stringify(b.tags || []), b.transaction_date || toDate(new Date()), ts, ts]
  );
  writeAudit(ctx, 'create', 'transaction', id, { after: { amount_minor: amount, type: b.type, merchant: b.merchant } },
    `Added ${b.type} of ${amount / 100} ${b.merchant ? `at ${b.merchant}` : ''}`.trim());
  return getTransaction(ctx, id);
}

export function updateTransaction(ctx, id, b) {
  require_(ctx, 'txn_write');
  const before = getTransaction(ctx, id); // enforces workspace + scope, 404 otherwise
  const next = {
    type: b.type || before.type,
    amount_minor: b.amount_minor != null ? Math.round(Number(b.amount_minor)) : before.amount_minor,
    category_id: b.category_id !== undefined ? b.category_id : before.category_id,
    merchant: b.merchant !== undefined ? b.merchant : before.merchant,
    notes: b.notes !== undefined ? b.notes : before.notes,
    tags: b.tags !== undefined ? b.tags : before.tags,
    transaction_date: b.transaction_date || before.transaction_date,
  };
  if (next.category_id) {
    const c = one('SELECT id FROM categories WHERE id = ? AND workspace_id = ?', [next.category_id, ctx.workspaceId]);
    if (!c) throw notFound();
  }
  run(
    `UPDATE transactions SET type=?, amount_minor=?, category_id=?, merchant=?, notes=?, tags=?, transaction_date=?, updated_at=?
      WHERE id=? AND workspace_id=?`,
    [next.type, next.amount_minor, next.category_id, next.merchant, next.notes, JSON.stringify(next.tags), next.transaction_date, nowIso(), id, ctx.workspaceId]
  );
  writeAudit(ctx, 'update', 'transaction', id, { before, after: next }, `Updated transaction`);
  return getTransaction(ctx, id);
}

/** Soft delete only — the ledger is never destroyed. */
export function deleteTransaction(ctx, id) {
  require_(ctx, 'txn_write');
  const before = getTransaction(ctx, id);
  run('UPDATE transactions SET is_deleted = 1, updated_at = ? WHERE id = ? AND workspace_id = ?', [nowIso(), id, ctx.workspaceId]);
  writeAudit(ctx, 'delete', 'transaction', id, { before, after: { is_deleted: true } },
    `Deleted transaction of ${before.amount_minor / 100}${before.merchant ? ` at ${before.merchant}` : ''}`);
  return { ok: true };
}

export function listMerchants(ctx) {
  const s = scoped(ctx);
  return all(
    `SELECT DISTINCT t.merchant FROM transactions t WHERE ${s.sql} AND t.merchant IS NOT NULL AND t.merchant <> '' ORDER BY t.merchant LIMIT 100`,
    s.params
  ).map((r) => r.merchant);
}

/* ---------- aggregates (shared by dashboard + agent) ---------- */
export function spendSummary(ctx, { group_by = 'category', from, to } = {}) {
  const w = from && to ? { from, to } : monthWindow(0);
  const s = scoped(ctx);
  const base = `${s.sql} AND t.transaction_date >= ? AND t.transaction_date <= ?`;
  const params = [...s.params, w.from, w.to];

  let rows;
  if (group_by === 'member') {
    rows = all(
      `SELECT COALESCE(u.display_name,'Unknown') AS key, u.id AS key_id, NULL AS color,
              COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_minor ELSE 0 END),0) AS expense_minor,
              COUNT(*) AS txn_count
         FROM transactions t LEFT JOIN users u ON u.id = t.created_by
        WHERE ${base} GROUP BY t.created_by ORDER BY expense_minor DESC`, params);
  } else if (group_by === 'day' || group_by === 'month') {
    const expr = group_by === 'day' ? 't.transaction_date' : "substr(t.transaction_date,1,7)";
    rows = all(
      `SELECT ${expr} AS key, NULL AS key_id, NULL AS color,
              COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_minor ELSE 0 END),0) AS expense_minor,
              COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount_minor ELSE 0 END),0) AS income_minor,
              COUNT(*) AS txn_count
         FROM transactions t WHERE ${base} GROUP BY ${expr} ORDER BY key ASC`, params);
  } else {
    rows = all(
      `SELECT COALESCE(c.name,'Uncategorized') AS key, c.id AS key_id, c.color AS color,
              COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_minor ELSE 0 END),0) AS expense_minor,
              COUNT(*) AS txn_count
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id AND c.workspace_id = t.workspace_id
        WHERE ${base} AND t.type='expense' GROUP BY t.category_id ORDER BY expense_minor DESC`, params);
  }
  const totals = one(
    `SELECT COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_minor ELSE 0 END),0) AS expense_minor,
            COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_minor ELSE 0 END),0) AS income_minor,
            COUNT(*) AS txn_count FROM transactions t WHERE ${base}`, params);
  return { group_by, date_range: w, rows, totals };
}

export function categoryTrends(ctx, months = 3) {
  const m = Math.min(Math.max(Number(months) || 3, 1), 12);
  const start = monthWindow(-(m - 1)).from;
  const end = monthWindow(0).to;
  const s = scoped(ctx);
  const rows = all(
    `SELECT COALESCE(c.name,'Uncategorized') AS category, c.color AS color,
            substr(t.transaction_date,1,7) AS month,
            COALESCE(SUM(t.amount_minor),0) AS expense_minor, COUNT(*) AS txn_count
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id AND c.workspace_id = t.workspace_id
      WHERE ${s.sql} AND t.type='expense' AND t.transaction_date >= ? AND t.transaction_date <= ?
      GROUP BY category, month ORDER BY month ASC, expense_minor DESC`,
    [...s.params, start, end]
  );
  const byCat = {};
  for (const r of rows) {
    byCat[r.category] = byCat[r.category] || { category: r.category, color: r.color, months: {}, total_minor: 0 };
    byCat[r.category].months[r.month] = r.expense_minor;
    byCat[r.category].total_minor += r.expense_minor;
  }
  const monthKeys = [...new Set(rows.map((r) => r.month))].sort();
  const series = Object.values(byCat).map((c) => {
    const first = c.months[monthKeys[0]] || 0;
    const last = c.months[monthKeys[monthKeys.length - 1]] || 0;
    return { ...c, change_minor: last - first, change_pct: first ? Math.round(((last - first) / first) * 1000) / 10 : null };
  }).sort((a, b) => b.total_minor - a.total_minor);
  return { months: monthKeys, date_range: { from: start, to: end }, series, txn_count: rows.reduce((a, r) => a + r.txn_count, 0) };
}

export function budgetStatus(ctx, { category, period } = {}) {
  const budgets = all(
    `SELECT b.*, c.name AS category_name, c.color AS category_color
       FROM budgets b LEFT JOIN categories c ON c.id = b.category_id AND c.workspace_id = b.workspace_id
      WHERE b.workspace_id = ? ORDER BY c.name IS NULL DESC, c.name`,
    [ctx.workspaceId]
  );
  const s = scoped(ctx);
  const out = [];
  for (const b of budgets) {
    if (period && b.period !== period) continue;
    if (category && (b.category_name || '').toLowerCase() !== String(category).toLowerCase()) continue;
    const w = b.period === 'weekly' ? weekWindow() : monthWindow(0);
    const where = [s.sql, "t.type = 'expense'", 't.transaction_date >= ?', 't.transaction_date <= ?'];
    const params = [...s.params, w.from, w.to];
    if (b.category_id) { where.push('t.category_id = ?'); params.push(b.category_id); }
    const agg = one(`SELECT COALESCE(SUM(t.amount_minor),0) AS spent, COUNT(*) AS n FROM transactions t WHERE ${where.join(' AND ')}`, params);
    const pct = b.limit_amount_minor ? Math.round((agg.spent / b.limit_amount_minor) * 1000) / 10 : 0;
    out.push({
      ...b,
      rollover: !!b.rollover,
      category_name: b.category_name || 'Overall',
      spent_minor: agg.spent,
      txn_count: agg.n,
      remaining_minor: b.limit_amount_minor - agg.spent,
      pct_used: pct,
      state: pct > 100 ? 'over' : pct >= 80 ? 'warning' : 'ok',
      period_window: w,
    });
  }
  return out;
}

export function createBudget(ctx, b) {
  require_(ctx, 'budget_write');
  if (b.category_id) {
    const c = one('SELECT id FROM categories WHERE id = ? AND workspace_id = ?', [b.category_id, ctx.workspaceId]);
    if (!c) throw notFound();
  }
  const id = uid();
  run('INSERT INTO budgets (id, workspace_id, category_id, period, limit_amount_minor, start_date, rollover, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, ctx.workspaceId, b.category_id || null, b.period === 'weekly' ? 'weekly' : 'monthly',
      Math.round(Number(b.limit_amount_minor)), b.start_date || monthWindow(0).from, b.rollover ? 1 : 0, ctx.userId, nowIso()]);
  writeAudit(ctx, 'create', 'budget', id, { after: b }, `Created ${b.period || 'monthly'} budget of ${Math.round(Number(b.limit_amount_minor)) / 100}`);
  return one('SELECT * FROM budgets WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
}

export function updateBudget(ctx, id, b) {
  require_(ctx, 'budget_write');
  const before = one('SELECT * FROM budgets WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
  if (!before) throw notFound();
  const lim = b.limit_amount_minor != null ? Math.round(Number(b.limit_amount_minor)) : before.limit_amount_minor;
  const period = b.period || before.period;
  const rollover = b.rollover != null ? (b.rollover ? 1 : 0) : before.rollover;
  run('UPDATE budgets SET limit_amount_minor=?, period=?, rollover=? WHERE id=? AND workspace_id=?', [lim, period, rollover, id, ctx.workspaceId]);
  writeAudit(ctx, 'update', 'budget', id, { before: { limit_amount_minor: before.limit_amount_minor }, after: { limit_amount_minor: lim } },
    `Changed budget limit from ${before.limit_amount_minor / 100} to ${lim / 100}`);
  return one('SELECT * FROM budgets WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
}

export function deleteBudget(ctx, id) {
  require_(ctx, 'budget_write');
  const before = one('SELECT * FROM budgets WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
  if (!before) throw notFound();
  run('DELETE FROM budgets WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
  writeAudit(ctx, 'delete', 'budget', id, { before }, `Deleted budget`);
  return { ok: true };
}

/* ---------- dashboard ---------- */
export function dashboard(ctx, days = 30) {
  const cur = monthWindow(0);
  const prev = monthWindow(-1);
  const s = scoped(ctx);

  const period = one(
    `SELECT COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_minor ELSE 0 END),0) AS expense_minor,
            COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_minor ELSE 0 END),0) AS income_minor,
            COUNT(*) AS txn_count FROM transactions t
      WHERE ${s.sql} AND t.transaction_date >= ? AND t.transaction_date <= ?`,
    [...s.params, cur.from, cur.to]);
  const prevAgg = one(
    `SELECT COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_minor ELSE 0 END),0) AS expense_minor
       FROM transactions t WHERE ${s.sql} AND t.transaction_date >= ? AND t.transaction_date <= ?`,
    [...s.params, prev.from, prev.to]);

  const win = daysWindow(Number(days) || 30);
  const trendRows = all(
    `SELECT t.transaction_date AS day,
            COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_minor ELSE 0 END),0) AS expense_minor,
            COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_minor ELSE 0 END),0) AS income_minor
       FROM transactions t WHERE ${s.sql} AND t.transaction_date >= ? AND t.transaction_date <= ?
      GROUP BY t.transaction_date ORDER BY t.transaction_date ASC`,
    [...s.params, win.from, win.to]);

  const trend = [];
  for (let i = 0; i < (Number(days) || 30); i++) {
    const d = toDate(new Date(new Date(win.from).getTime() + i * 864e5));
    const hit = trendRows.find((r) => r.day === d);
    trend.push({ day: d, expense_minor: hit?.expense_minor || 0, income_minor: hit?.income_minor || 0 });
  }

  const byCategory = spendSummary(ctx, { group_by: 'category', ...cur }).rows;
  const budgets = budgetStatus(ctx);
  // Aggregate must not double-count: an overall budget already covers every
  // category, so prefer it and fall back to summing per-category budgets.
  const overall = budgets.find((b) => !b.category_id);
  const budgetTotals = overall
    ? { limit: overall.limit_amount_minor, spent: overall.spent_minor }
    : budgets.reduce((a, b) => ({ limit: a.limit + b.limit_amount_minor, spent: a.spent + b.spent_minor }), { limit: 0, spent: 0 });
  const recent = listTransactions(ctx, { pageSize: 8, sortBy: 'transaction_date', sortDir: 'desc' }).rows;

  // Team spend only exists for org workspaces where the viewer may see all rows.
  const teamSpend = ctx.workspace.type === 'organization' && ctx.scope === 'all'
    ? spendSummary(ctx, { group_by: 'member', ...cur }).rows
    : null;

  return {
    period: cur,
    kpis: {
      expense_minor: period.expense_minor,
      income_minor: period.income_minor,
      net_minor: period.income_minor - period.expense_minor,
      prev_expense_minor: prevAgg.expense_minor,
      budget_limit_minor: budgetTotals.limit,
      budget_spent_minor: budgetTotals.spent,
      budget_remaining_minor: budgetTotals.limit - budgetTotals.spent,
      txn_count: period.txn_count,
    },
    trend,
    byCategory,
    budgets,
    recent,
    teamSpend,
  };
}

/* ---------- audit ---------- */
export function listAudit(ctx, f = {}) {
  require_(ctx, 'audit_read');
  const where = ['a.workspace_id = ?'];
  const params = [ctx.workspaceId];
  if (f.actor) { where.push('a.actor_id = ?'); params.push(f.actor); }
  if (f.action && f.action !== 'all') { where.push('a.action = ?'); params.push(f.action); }
  if (f.from) { where.push('a.created_at >= ?'); params.push(f.from); }
  if (f.to) { where.push('a.created_at <= ?'); params.push(`${f.to}T23:59:59.999Z`); }
  const rows = all(
    `SELECT a.*, u.display_name AS actor_name, u.email AS actor_email FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id WHERE ${where.join(' AND ')}
      ORDER BY a.created_at DESC LIMIT 300`, params);
  return rows.map((r) => ({ ...r, diff: r.diff ? JSON.parse(r.diff) : null }));
}
