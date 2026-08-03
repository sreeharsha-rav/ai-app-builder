import OpenAI from 'openai';
import { run, all, one } from './db';
import { uid, nowIso } from './auth';
import * as svc from './service';

/**
 * Read-only insights agent.
 * - Fixed allowlist of 4 read tools. No create/update/delete tool is registered.
 * - workspace_id and member_scope come from the server session; anything the
 *   model supplies for them is discarded.
 * - Tools are thin wrappers over lib/service.js — the same permission-checked
 *   layer the REST API uses.
 */

const MODEL = 'gpt-5';
const MAX_TURNS = 6;

function client() {
  const apiKey = process.env.EMERGENT_LLM_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing EMERGENT_LLM_KEY');
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || 'https://integrations.emergentagent.com/llm',
    timeout: 90000,
    maxRetries: 1,
  });
}

const nn = (t) => ({ type: [t, 'null'] });

export const TOOL_SPECS = [
  {
    type: 'function',
    function: {
      name: 'get_transactions',
      description: 'Read-only list of transactions in the current workspace. Use for questions about specific spends, merchants or counts.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { ...nn('string'), description: 'YYYY-MM-DD inclusive. null = start of current month.' },
          date_to: { ...nn('string'), description: 'YYYY-MM-DD inclusive. null = today.' },
          category: { ...nn('string'), description: 'Category name, case-insensitive. null = all categories.' },
          type: { type: ['string', 'null'], enum: ['income', 'expense', null] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['date_from', 'date_to', 'category', 'type', 'limit'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_budget_status',
      description: 'Read-only budget vs actual spend for the current period. Use for "am I over budget" questions.',
      parameters: {
        type: 'object',
        properties: {
          category: nn('string'),
          period: { type: ['string', 'null'], enum: ['weekly', 'monthly', null] },
        },
        required: ['category', 'period'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_spend_summary',
      description: 'Read-only aggregated spend grouped by category, member, day or month over a date range.',
      parameters: {
        type: 'object',
        properties: {
          group_by: { type: 'string', enum: ['category', 'member', 'day', 'month'] },
          date_from: nn('string'),
          date_to: nn('string'),
        },
        required: ['group_by', 'date_from', 'date_to'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_category_trends',
      description: 'Read-only month-over-month spend per category for the last N months. Use for growth/decline questions.',
      parameters: {
        type: 'object',
        properties: { months: { type: 'integer', minimum: 1, maximum: 12 } },
        required: ['months'],
        additionalProperties: false,
      },
    },
  },
];

const money = (m) => (m || 0) / 100;

function resolveCategoryId(ctx, name) {
  if (!name) return null;
  const c = one('SELECT id FROM categories WHERE workspace_id = ? AND lower(name) = lower(?)', [ctx.workspaceId, name]);
  return c?.id || '__no_match__';
}

/** Executes an allowlisted tool. ctx (workspace + scope) is server-supplied. */
function execTool(ctx, name, args) {
  switch (name) {
    case 'get_transactions': {
      const w = args.date_from && args.date_to ? { from: args.date_from, to: args.date_to } : svc.monthWindow(0);
      const catId = resolveCategoryId(ctx, args.category);
      const res = svc.listTransactions(ctx, {
        from: w.from, to: w.to, type: args.type || 'all',
        categoryIds: args.category ? [catId] : undefined,
        pageSize: Math.min(args.limit || 50, 100),
      });
      return {
        date_range: w,
        matched_count: res.total,
        total_expense: money(res.totals.expense),
        total_income: money(res.totals.income),
        currency: ctx.workspace.currency_code,
        transactions: res.rows.map((r) => ({
          date: r.transaction_date, type: r.type, amount: money(r.amount_minor),
          category: r.category_name || 'Uncategorized', merchant: r.merchant, notes: r.notes,
          added_by: ctx.workspace.type === 'organization' ? r.created_by_name : undefined,
        })),
      };
    }
    case 'get_budget_status': {
      const rows = svc.budgetStatus(ctx, { category: args.category || undefined, period: args.period || undefined });
      return {
        currency: ctx.workspace.currency_code,
        budgets: rows.map((b) => ({
          category: b.category_name, period: b.period, limit: money(b.limit_amount_minor),
          spent: money(b.spent_minor), remaining: money(b.remaining_minor), pct_used: b.pct_used,
          state: b.state, transactions_counted: b.txn_count, window: b.period_window,
        })),
      };
    }
    case 'get_spend_summary': {
      const r = svc.spendSummary(ctx, {
        group_by: args.group_by,
        from: args.date_from || undefined,
        to: args.date_to || undefined,
      });
      return {
        group_by: r.group_by, date_range: r.date_range, currency: ctx.workspace.currency_code,
        total_expense: money(r.totals.expense_minor), total_income: money(r.totals.income_minor),
        transactions_counted: r.totals.txn_count,
        rows: r.rows.map((x) => ({ key: x.key, expense: money(x.expense_minor), income: x.income_minor != null ? money(x.income_minor) : undefined, transactions: x.txn_count, color: x.color })),
      };
    }
    case 'get_category_trends': {
      const r = svc.categoryTrends(ctx, args.months || 3);
      return {
        months: r.months, date_range: r.date_range, currency: ctx.workspace.currency_code,
        transactions_counted: r.txn_count,
        series: r.series.map((s) => ({
          category: s.category, total: money(s.total_minor),
          by_month: Object.fromEntries(Object.entries(s.months).map(([k, v]) => [k, money(v)])),
          change: money(s.change_minor), change_pct: s.change_pct, color: s.color,
        })),
      };
    }
    default:
      throw new Error('Tool not allowed');
  }
}

const WRITE_INTENT = /\b(add|create|log|record|insert|enter|delete|remove|erase|update|edit|change|modify|set|increase|decrease|raise|lower|categori[sz]e|recategori[sz]e|rename|invite|assign|transfer|pay|move)\b/i;
const QUESTIONY = /\b(how much|how many|what|which|why|when|compare|trend|show|list|summar|breakdown|am i|are we|did i|do i|over budget|top|most|least|average)\b/i;

export function isWriteRequest(text) {
  const t = String(text || '');
  if (!WRITE_INTENT.test(t)) return false;
  // "how much did I spend" contains no write verb; "add a 500 expense" does.
  if (QUESTIONY.test(t) && !/\b(add|delete|remove|create|log|insert|update|edit|set)\b/i.test(t)) return false;
  return true;
}

/** Derive deterministic citation + chart payload from the tool results. */
function buildStructured(ctx, toolRuns) {
  const citations = [];
  let chart = null;
  const stats = [];

  for (const { name, result } of toolRuns) {
    const dr = result?.date_range;
    const count = result?.matched_count ?? result?.transactions_counted;
    if (dr && count != null) citations.push({ from: dr.from, to: dr.to, count });

    if (name === 'get_spend_summary' && result?.rows?.length && !chart) {
      chart = {
        kind: result.group_by === 'day' || result.group_by === 'month' ? 'sequential' : 'categorical',
        group_by: result.group_by,
        data: result.rows.slice(0, 8).map((r) => ({ label: r.key, value: r.expense, color: r.color })),
      };
      stats.push({ label: 'Total spend', value: result.total_expense, currency: ctx.workspace.currency_code });
    }
    if (name === 'get_category_trends' && result?.series?.length && !chart) {
      chart = {
        kind: 'categorical', group_by: 'category',
        data: result.series.slice(0, 8).map((s) => ({ label: s.category, value: s.total, color: s.color })),
      };
    }
    if (name === 'get_budget_status' && result?.budgets?.length) {
      const over = result.budgets.filter((b) => b.state !== 'ok');
      stats.push({ label: 'Budgets tracked', value: result.budgets.length, plain: true });
      stats.push({ label: 'At risk / over', value: over.length, plain: true, tone: over.length ? 'destructive' : 'ok' });
      const froms = result.budgets.map((b) => b.window.from).sort();
      const tos = result.budgets.map((b) => b.window.to).sort();
      citations.push({
        from: froms[0], to: tos[tos.length - 1],
        count: result.budgets.reduce((a, b) => a + b.transactions_counted, 0),
      });
    }
    if (name === 'get_transactions' && result?.matched_count != null) {
      stats.push({ label: 'Spend in range', value: result.total_expense, currency: ctx.workspace.currency_code });
    }
  }

  // Prefer the widest-evidence citation so we never cite "0 transactions"
  // when another tool in the same turn actually read rows.
  const citation = citations.sort((a, b) => b.count - a.count)[0] || null;

  // Dedupe repeated stat labels (the model often calls one tool twice).
  const seen = new Set();
  const unique = stats.filter((s) => (seen.has(s.label) ? false : seen.add(s.label)));
  return { citation, chart, stats: unique.slice(0, 4) };
}

function systemPrompt(ctx, member) {
  return [
    'You are the read-only insights analyst inside a multi-workspace expense tracker.',
    `Workspace: "${ctx.workspace.name}" (${ctx.workspace.type}), currency ${ctx.workspace.currency_code}. Today is ${svc.toDate(new Date())}.`,
    `The asking user is ${member.display_name} with role "${ctx.role}" and data scope "${ctx.scope}".`,
    ctx.scope === 'own_only'
      ? 'IMPORTANT: this user may only see their OWN transactions. Never speculate about other members\' spending; the tools already return only their own rows.'
      : '',
    ctx.workspace.type === 'personal' ? 'This is a personal workspace, so per-member breakdowns are meaningless.' : '',
    '',
    'RULES:',
    '1. Use ONLY the provided read-only tools for any number. Never invent or estimate figures.',
    '2. You cannot create, edit, delete or categorize anything. If asked, decline and say you provide insights only.',
    '3. Be concise: 2-5 short sentences or a compact markdown list. No headings, no tables.',
    `4. Format money as ${ctx.workspace.currency_code} amounts with thousands separators.`,
    '5. Always ground statements in the tool data (counts, date ranges). If a tool returns nothing, say there is no data for that range.',
  ].filter(Boolean).join('\n');
}

export function threadFor(ctx) {
  return all('SELECT id, role, payload, created_at FROM agent_messages WHERE workspace_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 100',
    [ctx.workspaceId, ctx.userId]).map((m) => ({ id: m.id, role: m.role, created_at: m.created_at, ...JSON.parse(m.payload) }));
}

function saveMessage(ctx, role, payload) {
  const id = uid();
  run('INSERT INTO agent_messages (id, workspace_id, user_id, role, payload, created_at) VALUES (?,?,?,?,?,?)',
    [id, ctx.workspaceId, ctx.userId, role, JSON.stringify(payload), nowIso()]);
  return { id, role, created_at: nowIso(), ...payload };
}

export function clearThread(ctx) {
  run('DELETE FROM agent_messages WHERE workspace_id = ? AND user_id = ?', [ctx.workspaceId, ctx.userId]);
  return { ok: true };
}

function logTurn(ctx, queryText, toolRuns, summary) {
  run('INSERT INTO agent_query_log (id, workspace_id, user_id, query_text, resolved_scope, response_summary, tool_calls, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [uid(), ctx.workspaceId, ctx.userId, queryText,
      JSON.stringify({ workspace_id: ctx.workspaceId, role: ctx.role, member_scope: ctx.scope, user_id: ctx.userId }),
      String(summary || '').slice(0, 800),
      JSON.stringify(toolRuns.map((t) => ({ name: t.name, arguments: t.args }))), nowIso()]);
}

export async function ask(ctx, member, queryText) {
  saveMessage(ctx, 'user', { text: queryText });

  // Governance boundary: write requests never reach the model's tool loop.
  if (isWriteRequest(queryText)) {
    const text = 'I provide read-only insights only. I cannot add, edit, delete or re-categorize transactions, budgets or members. You can make that change yourself from the Transactions or Budgets screen.';
    logTurn(ctx, queryText, [], 'Declined: write request');
    return saveMessage(ctx, 'assistant', { kind: 'refusal', text });
  }

  const history = threadFor(ctx).slice(-12).filter((m) => m.text).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.text).slice(0, 2000),
  }));

  const messages = [{ role: 'system', content: systemPrompt(ctx, member) }, ...history];
  const toolRuns = [];
  const openai = client();

  let finalText = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOL_SPECS,
      tool_choice: 'auto',
    });
    const msg = res.choices?.[0]?.message;
    if (!msg) break;
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      finalText = msg.content || '';
      break;
    }
    for (const call of calls) {
      let out;
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
        // Server-side scope injection: discard anything the model sends here.
        delete args.workspace_id; delete args.scope; delete args.member_scope; delete args.user_id;
        out = execTool(ctx, call.function.name, args);
      } catch (e) {
        out = { error: 'Tool call failed or arguments were invalid' };
      }
      toolRuns.push({ name: call.function.name, args, result: out });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 20000) });
    }
  }

  if (!finalText) finalText = 'I could not complete that analysis. Try rephrasing your question.';
  const structured = buildStructured(ctx, toolRuns);
  logTurn(ctx, queryText, toolRuns, finalText);

  return saveMessage(ctx, 'assistant', {
    kind: 'answer',
    text: finalText,
    citation: structured.citation,
    chart: structured.chart,
    stats: structured.stats,
    tools_used: toolRuns.map((t) => t.name),
    scope: { role: ctx.role, member_scope: ctx.scope },
  });
}
