import { all, one, run, getDb } from './db';
import { uid, nowIso, hashPassword } from './auth';
import { createWorkspace } from './workspaces';

const PASSWORD = 'demo1234';

// Deterministic PRNG so the demo dataset is stable across restarts.
let seed = 987654321;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const iRnd = (min, max) => Math.floor(min + rnd() * (max - min + 1));
const dateBack = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

const MERCHANTS = {
  Food: ['Swiggy', 'Zomato', 'Blue Tokai', 'Third Wave Coffee', 'Nature\u2019s Basket', 'Chai Point'],
  Transport: ['Uber', 'Ola', 'Indian Oil', 'Metro Card', 'Rapido'],
  Bills: ['Airtel', 'Tata Power', 'ACT Fibernet', 'Jio Postpaid', 'Gas Bill'],
  Shopping: ['Amazon', 'Myntra', 'Decathlon', 'IKEA', 'Croma'],
  Other: ['Cult.fit', 'Apollo Pharmacy', 'PVR Cinemas', 'Udemy'],
};
const TAGS = [['essential'], ['recurring'], ['team'], [], [], ['reimbursable']];

function addUser(email, name) {
  const existing = one('SELECT * FROM users WHERE email = ?', [email]);
  if (existing) return existing;
  const id = uid();
  run('INSERT INTO users (id, email, password_hash, display_name, avatar_url, created_at) VALUES (?,?,?,?,NULL,?)',
    [id, email, hashPassword(PASSWORD), name, nowIso()]);
  return one('SELECT * FROM users WHERE id = ?', [id]);
}

function addMember(wsId, userId, role, scope, invitedBy, status = 'active') {
  run('INSERT INTO workspace_members (id, workspace_id, user_id, invited_email, role, member_scope, status, invited_by, joined_at) VALUES (?,?,?,NULL,?,?,?,?,?)',
    [uid(), wsId, userId, role, scope, status, invitedBy, status === 'active' ? nowIso() : null]);
}

/**
 * Spreads entries across the current + 2 previous calendar months, weighted
 * towards the current month so the dashboard is never empty early in a month.
 */
function demoDate() {
  const now = new Date();
  const r = rnd();
  const monthOffset = r < 0.2 ? 0 : r < 0.6 ? -1 : -2;
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  const lastDay = monthOffset === 0
    ? now.getUTCDate()
    : new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(iRnd(1, Math.max(lastDay, 1)));
  return base.toISOString().slice(0, 10);
}

function seedTxns(wsId, currency, authors, count) {
  const cats = all('SELECT * FROM categories WHERE workspace_id = ?', [wsId]);
  for (let i = 0; i < count; i++) {
    const cat = pick(cats);
    const author = pick(authors);
    const isIncome = rnd() < 0.08;
    const amount = isIncome ? iRnd(4000000, 9000000) : iRnd(9900, 850000);
    const d = demoDate();
    run(`INSERT INTO transactions (id, workspace_id, created_by, type, amount_minor, currency_code, category_id, merchant, notes, tags, transaction_date, created_at, updated_at, is_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [uid(), wsId, author, isIncome ? 'income' : 'expense', amount, currency,
        isIncome ? null : cat.id, isIncome ? 'Monthly salary' : pick(MERCHANTS[cat.name] || ['General Store']),
        rnd() < 0.3 ? 'Auto-generated demo entry' : null, JSON.stringify(pick(TAGS)),
        d, new Date().toISOString(), new Date().toISOString()]);
  }
}

function seedBudgets(wsId, ownerId, specs) {
  const cats = all('SELECT * FROM categories WHERE workspace_id = ?', [wsId]);
  const start = new Date();
  start.setUTCDate(1);
  for (const s of specs) {
    const cat = s.category ? cats.find((c) => c.name === s.category) : null;
    run('INSERT INTO budgets (id, workspace_id, category_id, period, limit_amount_minor, start_date, rollover, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [uid(), wsId, cat?.id || null, s.period || 'monthly', s.limit, start.toISOString().slice(0, 10), s.rollover ? 1 : 0, ownerId, nowIso()]);
  }
}

/** Idempotent: runs only when the users table is empty. */
export function ensureSeed() {
  const g = globalThis;
  if (g.__ledgerSeeded) return;
  g.__ledgerSeeded = true;
  getDb();
  const count = one('SELECT COUNT(*) AS c FROM users').c;
  if (count > 0) return;

  const owner = addUser('owner@demo.com', 'Aarav Sharma');
  const admin = addUser('admin@demo.com', 'Priya Nair');
  const member = addUser('member@demo.com', 'Rohan Gupta');
  const ownOnly = addUser('own@demo.com', 'Sara Khan');
  const viewer = addUser('viewer@demo.com', 'Vikram Rao');

  // ---- personal workspace ----
  const personal = createWorkspace({ name: 'Aarav — Personal', type: 'personal', ownerId: owner.id, currency: 'INR' });
  seedTxns(personal.id, 'INR', [owner.id], 32, 90);
  seedBudgets(personal.id, owner.id, [
    { category: null, limit: 6000000, period: 'monthly' },
    { category: 'Food', limit: 1500000, period: 'monthly' },
    { category: 'Transport', limit: 600000, period: 'monthly', rollover: true },
  ]);

  // ---- organization workspace ----
  const org = createWorkspace({ name: 'Nimbus Labs', type: 'organization', ownerId: owner.id, currency: 'INR' });
  addMember(org.id, admin.id, 'admin', 'all', owner.id);
  addMember(org.id, member.id, 'member', 'all', owner.id);
  addMember(org.id, ownOnly.id, 'member', 'own_only', owner.id);
  addMember(org.id, viewer.id, 'viewer', 'all', owner.id);
  run("INSERT INTO workspace_members (id, workspace_id, user_id, invited_email, role, member_scope, status, invited_by, joined_at) VALUES (?,?,NULL,?,'member','all','pending',?,NULL)",
    [uid(), org.id, 'newhire@demo.com', owner.id]);

  seedTxns(org.id, 'INR', [owner.id, admin.id, member.id, ownOnly.id], 64, 90);
  seedBudgets(org.id, owner.id, [
    { category: null, limit: 20000000, period: 'monthly' },
    { category: 'Food', limit: 4000000, period: 'monthly' },
    { category: 'Transport', limit: 2500000, period: 'monthly' },
    { category: 'Bills', limit: 3000000, period: 'monthly' },
    { category: 'Shopping', limit: 1500000, period: 'weekly' },
  ]);

  run('INSERT INTO audit_log (id, workspace_id, actor_id, action, entity_type, entity_id, diff, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [uid(), org.id, owner.id, 'create', 'workspace', org.id, JSON.stringify({ after: { name: 'Nimbus Labs' } }), 'Created workspace "Nimbus Labs"', nowIso()]);

  const trail = [
    [owner.id, 'invite', 'member', 'Invited admin@demo.com as admin', 5],
    [owner.id, 'invite', 'member', 'Invited newhire@demo.com as member', 4],
    [owner.id, 'role_change', 'member', 'Changed role from member to admin', 4],
    [owner.id, 'create', 'budget', 'Created monthly budget of 200000', 3],
    [admin.id, 'update', 'budget', 'Changed budget limit from 30,000 to 40,000', 2],
    [admin.id, 'role_change', 'member', 'Changed scope to own_only', 2],
    [member.id, 'create', 'transaction', 'Added expense of 3,681 at Nature\u2019s Basket', 1],
    [ownOnly.id, 'delete', 'transaction', 'Deleted transaction of 1,240 at Uber', 1],
  ];
  for (const [actor, action, entity, summary, daysAgo] of trail) {
    run('INSERT INTO audit_log (id, workspace_id, actor_id, action, entity_type, entity_id, diff, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [uid(), org.id, actor, action, entity, null, JSON.stringify({ before: {}, after: {} }), summary,
        new Date(Date.now() - daysAgo * 864e5).toISOString()]);
  }
}
